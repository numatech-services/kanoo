// Scénario de bout en bout : lot 1 (retenue subie, soldes d'ouverture, rappels d'appels d'offres, appel gagné → marché).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const PW = `Kz-${randomBytes(12).toString("base64url")}!9q`;
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
const entriesOf = async (g, q) => D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(q)}&limit=50`)).items ?? [];
const balancedE = e => e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d.toISOString(); };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque lot 1", type: "bank", openingBalance: 0, openingDate: "2025-01-01" }));
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse lot 1", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }));

  console.log("\n▶ Retenue à la source subie");
  const cl = id(await g.req("POST", "/api/clients", { code: "C-RAS", name: "Ministère des Finances" }));
  const inv = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Prestation", quantity: 1, unitPrice: 1000000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  const ttc = inv.totalTTC;
  check("retenue au-delà du reste à payer : refusée", (await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: ttc, withholdingAmount: 50000, method: "bank_transfer", date: today, treasuryAccountId: bank._id })).status === 400);
  const pay = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: ttc - 50000, withholdingAmount: 50000, method: "bank_transfer", date: today, treasuryAccountId: bank._id });
  check("encaissement net + retenue : enregistré", pay.status === 201, `${pay.status} ${J(pay.data).slice(0, 200)}`);
  let fi = D(await g.req("GET", `/api/invoices/${inv._id}`));
  check("facture soldée du brut, retenue notée", fi.status === "paid" && fi.paidAmount === ttc && fi.retenueSource === 50000, J({ s: fi.status, p: fi.paidAmount, r: fi.retenueSource }));
  const pe = (await entriesOf(g, `Règlement facture ${inv.number}`)).find(e => !e.reverses);
  check("écriture : banque au net, 449200 à la retenue, 411 au brut", pe && balancedE(pe)
    && pe.lines.some(l => l.accountCode === bank.ledgerCode && l.debit === ttc - 50000)
    && pe.lines.some(l => l.accountCode === "449200" && l.debit === 50000)
    && pe.lines.some(l => l.accountCode === "411000" && l.credit === ttc), J(pe?.lines));
  const rs = D(await g.req("GET", `/api/fiscal/retenues-subies?annee=${new Date().getFullYear()}`));
  check("état des retenues subies : la retenue y figure", rs.total === 50000 && rs.items?.length === 1, J(rs).slice(0, 200));
  const tb = D(await g.req("GET", `/api/treasury-accounts/${bank._id}`));
  check("trésorerie : seul le net est entré en banque", tb.balance === ttc - 50000, J({ b: tb.balance }));
  const cancel = await g.req("POST", `/api/payments/${D(pay)._id}/cancel`, { reason: "Erreur de saisie" });
  fi = D(await g.req("GET", `/api/invoices/${inv._id}`));
  check("annulation : facture rouverte, retenue retirée", cancel.status === 200 && fi.paidAmount === 0 && fi.retenueSource === 0 && fi.status !== "paid", `${cancel.status} ${J({ s: fi.status, p: fi.paidAmount, r: fi.retenueSource })}`);
  check("annulation : retenue sortie de l'état", D(await g.req("GET", `/api/fiscal/retenues-subies?annee=${new Date().getFullYear()}`)).total === 0);
  const ext = (await entriesOf(g, `Règlement facture ${inv.number}`)).length;
  check("annulation : écriture extournée (miroir)", ext >= 2 || (await entriesOf(g, "encaissement annulé")).length > 0, String(ext));

  console.log("\n▶ Reprise des soldes d'ouverture");
  let op = D(await g.req("GET", "/api/accounting/opening"));
  check("état initial : aucune reprise, comptes de trésorerie listés", op.entry === null && op.accounts?.some(a => a._id === bank._id), J(op).slice(0, 200));
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-AN", name: "Fournisseur repris" }));
  const odate = `${new Date().getFullYear()}-01-01`;
  const lines = [
    { accountCode: "101000", accountLabel: "Capital", debit: 0, credit: 2000000 },
    { accountCode: "411000", accountLabel: "Clients", debit: 700000, credit: 0, thirdPartyId: cl },
    { accountCode: "401000", accountLabel: "Fournisseurs", debit: 0, credit: 300000, thirdPartyId: sup },
  ];
  check("déséquilibre refusé", (await g.req("POST", "/api/accounting/opening", { date: odate, lines, treasury: [{ accountId: bank._id, amount: 1500000 }] })).status === 400);
  check("compte de banque saisi en ligne : refusé", (await g.req("POST", "/api/accounting/opening", { date: odate, lines: [...lines, { accountCode: "521000", debit: 1600000, credit: 0 }] })).status === 400);
  check("compte de charge : refusé", (await g.req("POST", "/api/accounting/opening", { date: odate, lines: [...lines, { accountCode: "601000", debit: 1600000, credit: 0 }] })).status === 400);
  check("tiers d'un autre type : refusé", (await g.req("POST", "/api/accounting/opening", { date: odate, lines: [{ ...lines[0] }, { ...lines[1], thirdPartyId: sup }, lines[2]], treasury: [{ accountId: bank._id, amount: 1600000 }] })).status === 400);
  const ok1 = await g.req("POST", "/api/accounting/opening", { date: odate, lines, treasury: [{ accountId: bank._id, amount: 1500000 }, { accountId: caisse._id, amount: 100000 }] });
  check("reprise équilibrée : passée", ok1.status === 201, `${ok1.status} ${J(ok1.data).slice(0, 200)}`);
  op = D(await g.req("GET", "/api/accounting/opening"));
  const an = op.entry;
  check("écriture AN : banque et caisse sur leurs comptes dédiés", an && an.lines.some(l => l.accountCode === bank.ledgerCode && l.debit === 1500000)
    && an.lines.some(l => /^5711\d\d$/.test(l.accountCode) && l.debit === 100000) && an.lines.some(l => l.accountCode === "101000" && l.credit === 2000000), J(an?.lines));
  const tb2 = D(await g.req("GET", `/api/treasury-accounts/${bank._id}`));
  check("trésorerie : solde d'ouverture aligné sur la reprise", tb2.openingBalance === 1500000, J({ o: tb2.openingBalance }));
  check("deuxième reprise : refusée", (await g.req("POST", "/api/accounting/opening", { date: odate, lines, treasury: [{ accountId: bank._id, amount: 1600000 }] })).status === 400);
  const bal = D(await g.req("GET", `/api/accounting/reports?type=balance`));
  check("balance : capital au crédit", JSON.stringify(bal).includes("101000"), J(bal).slice(0, 150));
  const rev = await g.req("POST", `/api/accounting-entries/${an._id}/reverse`, { reason: "Reprise à refaire" });
  check("reprise extournable", rev.status === 201, `${rev.status} ${J(rev.data).slice(0, 150)}`);
  check("après extourne : trésorerie remise à zéro", D(await g.req("GET", `/api/treasury-accounts/${bank._id}`)).openingBalance === 0);
  const ok2 = await g.req("POST", "/api/accounting/opening", { date: odate, lines, treasury: [{ accountId: bank._id, amount: 1600000 }] });
  check("après extourne : nouvelle reprise acceptée", ok2.status === 201, `${ok2.status} ${J(ok2.data).slice(0, 150)}`);

  console.log("\n▶ Appels d'offres : rappels et brief");
  const ap = D(await g.req("POST", "/api/appels", { title: "Fourniture de matériel informatique", organism: "Direction des Marchés Publics", reference: "AO-2026-12", submissionDeadline: plusDays(1), estimatedAmount: 5000000, requiredDocuments: ["Caution de soumission"] }));
  check("appel créé", !!ap._id, J(ap).slice(0, 150));
  const br = D(await g.req("GET", "/api/brief?limit=20"));
  const t = br.items?.find(i => i.kind === "tender_deadline");
  check("brief : dépôt de demain signalé, pièce manquante citée", t && /demain/.test(t.why) && /pièce/.test(t.why) && t.href === `/appels/${ap._id}`, J(t ?? br.items?.map(i => i.kind)));
  const cron = await fetch(`${BASE}/api/cron?job=tender-deadlines`, { headers: { "x-cron-key": process.env.CRON_SECRET ?? "" } });
  const cj = await cron.json().catch(() => null);
  check("tâche planifiée : rappel envoyé", cron.ok && /[1-9]\d* rappel/.test(J(cj)), `${cron.status} ${J(cj).slice(0, 200)}`);
  const notes = D(await g.req("GET", "/api/notifications?limit=20")).items ?? [];
  check("notification : dépôt demain, vers l'appel", notes.some(n => n.type === "tender_deadline" && /demain/.test(n.message) && String(n.linkedId) === ap._id), J(notes.map(n => n.type)));

  console.log("\n▶ Appel gagné → marché");
  check("appel encore à préparer : refusé", (await g.req("POST", `/api/appels/${ap._id}/to-contract`, {})).status === 400);
  await g.req("PATCH", `/api/appels/${ap._id}`, { status: "submitted" });
  const tc = await g.req("POST", `/api/appels/${ap._id}/to-contract`, { amount: 4800000 });
  check("marché créé : client ajouté depuis l'organisme, projet d'exécution", tc.status === 201 && D(tc).contractId && D(tc).projectId && D(tc).newClient === true, `${tc.status} ${J(tc.data).slice(0, 200)}`);
  const ct = D(await g.req("GET", `/api/contracts/${D(tc).contractId}`));
  check("marché : montant attribué, client = organisme, actif", ct.amount === 4800000 && ct.status === "active" && (ct.clientId?.name ?? "") === "Direction des Marchés Publics", J({ a: ct.amount, s: ct.status, c: ct.clientId }).slice(0, 200));
  const ap2 = D(await g.req("GET", `/api/appels/${ap._id}`));
  check("appel passé à « gagné », lié au marché et au projet", ap2.status === "won" && ap2.contractId?._id === D(tc).contractId && ap2.projectId?._id === D(tc).projectId, J({ s: ap2.status, c: ap2.contractId, p: ap2.projectId }));
  check("deuxième passage : refusé", (await g.req("POST", `/api/appels/${ap._id}/to-contract`, {})).status === 409);
  const ap3 = D(await g.req("POST", "/api/appels", { title: "Entretien des locaux", organism: "direction des marchés publics", submissionDeadline: plusDays(-3), estimatedAmount: 900000 }));
  await g.req("PATCH", `/api/appels/${ap3._id}`, { status: "submitted" });
  const tc3 = await g.req("POST", `/api/appels/${ap3._id}/to-contract`, {});
  check("même organisme : client existant réutilisé (sans doublon)", tc3.status === 201 && D(tc3).newClient === false && D(tc3).clientId === D(tc).clientId, `${tc3.status} ${J(tc3.data).slice(0, 200)}`);
  check("brief : un appel gagné ne fait plus l'objet d'un rappel", !(D(await g.req("GET", "/api/brief?limit=20")).items ?? []).some(i => i.kind === "tender_deadline"));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
