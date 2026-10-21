// Scénario de bout en bout : marché (devis → marché → acomptes → dépenses → marge).
import { readFileSync } from "fs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const raw = typeof body === "string";
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": raw ? "text/csv" : "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  }
  return { req, reset: () => { csrf = ""; } };
}
// Le serveur limite les connexions par adresse (20 par minute) : sur un 429,
// le scénario attend le délai annoncé puis réessaie.
async function login(email, pw) {
  for (let attempt = 0; ; attempt++) {
    const s = session();
    const r = await s.req("POST", "/api/auth/login", { email, password: pw });
    s.reset();
    if (r.status !== 429 || attempt >= 2) return { s, r };
    const wait = Number(/(\d+) secondes/.exec(r.data?.error ?? "")?.[1] ?? 60);
    await new Promise(res => setTimeout(res, (wait + 1) * 1000));
  }
}
const D = r => r.data?.data ?? {};

const today = new Date().toISOString().slice(0, 10);
const id = r => D(r)?._id;

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const fin = async c => D(await g.req("GET", `/api/contracts/${c}/finance`));
  const balanced = async ref => { const e = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(ref)}`)).items ?? [])[0]; return e && e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0) ? e : null; };

  console.log("\n▶ Devis → marché");
  const cli = id(await g.req("POST", "/api/clients", { code: "C-MCH", name: "Mairie de Niamey" }));
  const dv = D(await g.req("POST", "/api/devis", { clientId: cli, issueDate: today, validUntil: today, lines: [{ description: "Aménagement salle", quantity: 1, unitPrice: 1000000, tvaRate: 0.19 }] }));
  check("devis créé (1 000 000 HT)", dv.totalHT === 1000000, J(dv).slice(0, 120));
  const countInv = async () => D(await g.req("GET", "/api/invoices?limit=1")).pagination?.total ?? -1;
  const before = await countInv();
  const pf = await g.req("POST", `/api/devis/${dv._id}/to-invoice`, { type: "proforma" });
  const after = await countInv();
  check("proforma : un PDF, aucune facture créée", pf.status === 200 && D(pf).pdfUrl && after === before, `${pf.status} ${before}→${after}`);
  check("PDF proforma servi", (await g.req("GET", `/api/devis/${dv._id}/pdf?proforma=1`)).status === 200);
  const tm = await g.req("POST", `/api/devis/${dv._id}/to-market`, { title: "Aménagement salle des fêtes", milestones: [{ label: "Acompte 30 %", kind: "deposit", rate: 30 }, { label: "Solde", kind: "standard", rate: 70 }] });
  const mc = D(tm).contractId, prj = D(tm).projectId;
  check("marché créé avec projet d'exécution et échéancier", tm.status === 201 && mc && prj, `${tm.status} ${J(tm.data).slice(0, 150)}`);
  check("devis devenu marché : conversion directe refusée", (await g.req("POST", `/api/devis/${dv._id}/to-invoice`, {})).status === 409);
  check("deuxième marché sur le même devis refusé", (await g.req("POST", `/api/devis/${dv._id}/to-market`, {})).status === 409);
  const ct = D(await g.req("GET", `/api/contracts/${mc}`));
  check("marché : montant du devis, actif, devis et projet liés", ct.amount === 1000000 && ct.status === "active" && ct.devisId?.number === dv.number && ct.projectId?._id === prj && ct.milestones?.length === 2, J(ct).slice(0, 200));
  check("échéancier au-delà du marché refusé", (await g.req("POST", `/api/contracts/${mc}/milestones`, { label: "Bonus", amount: 1 })).status === 400);

  console.log("\n▶ Acompte");
  const dep = await g.req("POST", `/api/contracts/${mc}/invoice`, { milestoneId: ct.milestones[0]._id });
  const depInv = D(dep).invoice;
  check("facture d'acompte : 300 000 HT, nature acompte, rattachée au marché", dep.status === 201 && depInv?.kind === "deposit" && depInv.totalHT === 300000 && depInv.contractId === mc, `${dep.status} ${J(dep.data).slice(0, 200)}`);
  check("brouillon d'acompte : pas encore d'écriture", !(await balanced(depInv.number)));
  check("même échéance refacturée : refusée", (await g.req("POST", `/api/contracts/${mc}/invoice`, { milestoneId: ct.milestones[0]._id })).status === 400);
  check("acompte au-delà du reste : refusé", (await g.req("POST", `/api/contracts/${mc}/invoice`, { mode: "deposit", amountHT: 800000 })).status === 400);
  let f = await fin(mc);
  check("situation : acompte 300 000 à déduire, travaux 0, reste à facturer 700 000", f.billing?.depositsOutstandingHT === 300000 && f.billing.workHT === 0 && f.billing.toInvoiceHT === 700000, J(f.billing));

  console.log("\n▶ Dépenses du marché");
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-MCH", name: "Quincaillerie Sahel" }));
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque marché", type: "bank", openingBalance: 5000000, openingDate: "2025-01-01" }));
  await g.req("POST", "/api/achats", { kind: "cash", payee: "Impôts", date: today, lines: [{ description: "Droits d'enregistrement du marché", accountCode: "646100", amountHT: 30000, projectId: prj }], payment: { treasuryAccountId: bank } });
  await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, validate: true, lines: [{ description: "Ciment, carreaux", accountCode: "601000", quantity: 1, unitPrice: 400000, tvaRate: 0.19, projectId: prj }] });
  await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, lines: [{ description: "Transport (brouillon)", accountCode: "618000", amountHT: 25000, projectId: prj }] });
  const bc = D(await g.req("POST", "/api/commandes", { supplierId: sup, orderDate: today, projectId: prj, lines: [{ description: "Peinture", quantity: 10, unitPrice: 5000, tvaRate: 0.19 }] }));
  await g.req("PATCH", `/api/commandes/${bc._id}`, { status: "confirmed" });
  f = await fin(mc);
  const cat = Object.fromEntries((f.costs?.categories ?? []).map(c => [c.key, c]));
  check("enregistrement 30 000 réalisé", cat.registration?.actual === 30000, J(cat.registration));
  check("matières 400 000 réalisées + 50 000 engagées (commande)", cat.materials?.actual === 400000 && cat.materials?.committed === 50000, J(cat.materials));
  check("transport 25 000 engagé (achat en brouillon)", cat.transport?.committed === 25000, J(cat.transport));
  check("reste à payer fournisseur : 476 000 TTC", f.costs?.supplierDueTTC === 476000, J(f.costs?.supplierDueTTC));
  check("marge à terminaison = 1 000 000 − 430 000 − 75 000", f.margin?.atCompletion === 495000, J(f.margin));

  console.log("\n▶ Solde avec déduction de l'acompte");
  const sol = await g.req("POST", `/api/contracts/${mc}/invoice`, { milestoneId: ct.milestones[1]._id });
  const solInv = D(sol).invoice;
  check("facture du solde : travaux 1 000 000 − acompte 300 000 = 700 000 HT net (l'échéance)", sol.status === 201 && solInv?.totalHT === 700000 && solInv.lines.some(l => l.kind === "deposit_deduction" && l.totalHT === -300000) && solInv.lines.some(l => l.kind !== "deposit_deduction" && l.totalHT === 1000000), `${sol.status} ${J(sol.data).slice(0, 200)}`);
  // Émettre le solde émet aussi l'acompte qu'il déduit, resté au brouillon.
  check("facture du solde émise", (await g.req("POST", `/api/invoices/${solInv._id}/send`)).status < 300);
  const depEntry = await balanced(depInv.number);
  check("acompte émis avec le solde : écriture équilibrée, avance en 419, pas de produit", depEntry && depEntry.lines.some(l => l.accountCode === "419000" && l.credit === 300000) && !depEntry.lines.some(l => /^7/.test(l.accountCode)), J(depEntry?.lines));
  const solEntry = await balanced(solInv.number);
  check("écriture équilibrée : 706 1 000 000 au crédit imputé au projet, 419 300 000 au débit", solEntry && solEntry.lines.some(l => l.accountCode === "706000" && l.credit === 1000000 && l.projectId === prj) && solEntry.lines.some(l => l.accountCode === "419000" && l.debit === 300000), J(solEntry?.lines));
  f = await fin(mc);
  check("situation : travaux 1 000 000, acomptes tous déduits, rien à facturer", f.billing.workHT === 1000000 && f.billing.depositsOutstandingHT === 0 && f.billing.toInvoiceHT === 0, J(f.billing));
  check("marge réelle = 1 000 000 − 430 000", f.margin.actual === 570000, J(f.margin));
  check("facturation au-delà du marché : refusée", (await g.req("POST", `/api/contracts/${mc}/invoice`, { mode: "standard", amountHT: 1 })).status === 400);
  const pay = await g.req("POST", "/api/payments", { invoiceId: depInv._id, amount: depInv.totalTTC, method: "bank_transfer", date: today, treasuryAccountId: bank });
  f = await fin(mc);
  check("encaissement de l'acompte reflété", pay.status < 300 && f.billing.collectedTTC === depInv.totalTTC, `${pay.status} ${f.billing.collectedTTC}`);

  console.log("\n▶ Avoir total sur le solde");
  const cn = await g.req("POST", `/api/invoices/${solInv._id}/credit-note`, { mode: "full", reason: "Erreur de montant" });
  check("avoir total émis", cn.status === 201, `${cn.status} ${J(cn.data).slice(0, 150)}`);
  const cnEntry = await balanced(D(cn).creditNote?.number ?? "x");
  check("écriture d'avoir équilibrée : acompte rendu (419 au crédit), CA du projet retiré", cnEntry && cnEntry.lines.some(l => l.accountCode === "419000" && l.credit === 300000) && cnEntry.lines.some(l => l.accountCode === "706000" && l.debit === 1000000 && l.projectId === prj), J(cnEntry?.lines));
  f = await fin(mc);
  check("situation : acompte de nouveau à déduire, travaux 0", f.billing.workHT === 0 && f.billing.depositsOutstandingHT === 300000, J(f.billing));
  const ct2 = D(await g.req("GET", `/api/contracts/${mc}`));
  check("échéance du solde de nouveau à facturer", ct2.milestones?.[1]?.status === "pending", J(ct2.milestones));

  console.log("\n▶ Rentabilité et cloisonnement");
  const rent = D(await g.req("GET", "/api/contracts/rentabilite"));
  check("liste de rentabilité : le marché y figure", rent.items?.some(r => r._id === mc && r.contractHT === 1000000), J(rent.items?.map(r => r.reference)));
  const { s: other } = await login("president@test.ne", SEED_PW);
  const r = await other.req("GET", `/api/contracts/${mc}/finance`);
  check("autre organisation : situation du marché inaccessible", [403, 404].includes(r.status), String(r.status));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
