// Scénario de bout en bout : lot 2 (retenue de garantie, cautions bancaires).
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
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque lot 2", type: "bank", openingBalance: 10000000, openingDate: "2025-01-01" }));
  const bal = async () => D(await g.req("GET", `/api/treasury-accounts/${bank._id}`)).balance;

  console.log("\n▶ Retenue de garantie");
  const cl = id(await g.req("POST", "/api/clients", { code: "C-RG", name: "Direction des Routes" }));
  const ct = D(await g.req("POST", "/api/contracts", { title: "Réfection de voirie", type: "client", clientId: cl, amount: 2000000, status: "active", startDate: today }));
  check("marché créé", !!ct._id, J(ct).slice(0, 150));
  check("taux au-delà de 10 % : refusé", (await g.req("PATCH", `/api/contracts/${ct._id}`, { retentionRate: 0.2 })).status === 400);
  await g.req("PATCH", `/api/contracts/${ct._id}`, { retentionRate: 0.05 });
  const dep = D(await g.req("POST", `/api/contracts/${ct._id}/invoice`, { mode: "deposit", amountHT: 200000 })).invoice;
  check("acompte : pas de retenue", dep && !(dep.retentionAmount > 0), J(dep).slice(0, 120));
  const f1 = D(await g.req("POST", `/api/contracts/${ct._id}/invoice`, { amountHT: 1000000, deductDeposits: false })).invoice;
  const ret = Math.round(f1.totalTTC * 0.05);
  check("facture de travaux : retenue de 5 % du TTC", f1.retentionAmount === ret && f1.retentionRate === 0.05, J({ r: f1.retentionAmount, ttc: f1.totalTTC }));
  await g.req("POST", `/api/invoices/${f1._id}/send`);
  const e1 = (await entriesOf(g, f1.number)).find(e => e.journalCode === "VT" && !e.reverses);
  check("écriture de vente : 411 au net, 411700 à la retenue", e1 && balancedE(e1) && e1.lines.some(l => l.accountCode === "411000" && l.debit === f1.totalTTC - ret) && e1.lines.some(l => l.accountCode === "411700" && l.debit === ret), J(e1?.lines));
  check("encaisser au-delà de l'exigible : refusé", (await g.req("POST", "/api/payments", { invoiceId: f1._id, amount: f1.totalTTC, method: "bank_transfer", date: today, treasuryAccountId: bank._id })).status === 400);
  const p1 = await g.req("POST", "/api/payments", { invoiceId: f1._id, amount: f1.totalTTC - ret, method: "bank_transfer", date: today, treasuryAccountId: bank._id });
  const fi1 = D(await g.req("GET", `/api/invoices/${f1._id}`));
  check("net encaissé : facture soldée", p1.status === 201 && fi1.status === "paid", `${p1.status} ${fi1.status}`);
  let rs = D(await g.req("GET", `/api/contracts/${ct._id}/retention`));
  check("retenue suivie sur le marché, pas encore réclamable", rs.held === ret && rs.outstanding === ret && rs.claimable === false && rs.releasableFrom === null, J(rs).slice(0, 200));
  const fin = D(await g.req("GET", `/api/contracts/${ct._id}/finance`));
  check("situation du marché : dû hors retenue, retenue à part", fin.retention?.outstanding === ret && fin.billing.dueTTC === dep.totalTTC, J({ due: fin.billing.dueTTC, r: fin.retention }));
  await g.req("PATCH", `/api/contracts/${ct._id}`, { receptionProvisoireDate: "2024-06-30", guaranteeMonths: 12 });
  rs = D(await g.req("GET", `/api/contracts/${ct._id}/retention`));
  check("délai de garantie écoulé : réclamable", rs.claimable === true, J(rs).slice(0, 150));
  const br = D(await g.req("GET", "/api/brief?limit=20"));
  check("brief : retenue à réclamer", br.items?.some(i => i.kind === "retention_claimable" && i.amount === ret), J(br.items?.map(i => i.kind)));
  check("reversement au-delà du reste : refusé", (await g.req("POST", `/api/contracts/${ct._id}/retention`, { amount: ret + 1, treasuryAccountId: bank._id, date: today })).status === 400);
  const b0 = await bal();
  const rel = await g.req("POST", `/api/contracts/${ct._id}/retention`, { amount: ret, treasuryAccountId: bank._id, date: today });
  const re = (await entriesOf(g, "Retenue de garantie reversée"))[0];
  check("reversement : banque au débit, 411700 au crédit, trésorerie à jour", rel.status === 201 && re && balancedE(re) && re.lines.some(l => l.accountCode === "411700" && l.credit === ret) && (await bal()) - b0 === ret, `${rel.status} ${J(re?.lines)}`);
  rs = D(await g.req("GET", `/api/contracts/${ct._id}/retention`));
  check("plus rien à récupérer, réception définitive notée", rs.outstanding === 0 && rs.releases.length === 1, J(rs).slice(0, 150));
  const cancel = await g.req("DELETE", `/api/contracts/${ct._id}/retention?releaseId=${rs.releases[0]._id}&reason=${encodeURIComponent("erreur de compte")}`);
  rs = D(await g.req("GET", `/api/contracts/${ct._id}/retention`));
  check("annulation du reversement : retenue de nouveau due, trésorerie corrigée", cancel.status === 200 && rs.outstanding === ret && (await bal()) === b0, `${cancel.status} ${rs.outstanding}`);

  console.log("\n▶ Avoirs sur facture avec retenue");
  const f2 = D(await g.req("POST", `/api/contracts/${ct._id}/invoice`, { amountHT: 300000, deductDeposits: false })).invoice;
  await g.req("POST", `/api/invoices/${f2._id}/send`);
  check("avoir partiel : refusé", (await g.req("POST", `/api/invoices/${f2._id}/credit-note`, { reason: "Erreur", lines: [{ lineIndex: 0, quantity: 0.5 }] })).status === 400);
  const av = await g.req("POST", `/api/invoices/${f2._id}/credit-note`, { mode: "full", reason: "Erreur de quantité" });
  const ae = (await entriesOf(g, D(av).creditNote?.number ?? "??"))[0];
  check("avoir total : solde 411700 et 411", av.status === 201 && ae && balancedE(ae) && ae.lines.some(l => l.accountCode === "411700" && l.credit === f2.retentionAmount), `${av.status} ${J(ae?.lines)}`);
  check("facture annulée : sort de la retenue du marché", D(await g.req("GET", `/api/contracts/${ct._id}/retention`)).held === ret);

  console.log("\n▶ Cautions bancaires");
  const ap = D(await g.req("POST", "/api/appels", { title: "Construction d'un dispensaire", organism: "Ministère de la Santé", submissionDeadline: plusDays(20), estimatedAmount: 30000000 }));
  const b1 = await bal();
  const c1r = await g.req("POST", "/api/cautions", { type: "soumission", appelId: ap._id, amount: 600000, issueDate: plusDays(-90), expiryDate: plusDays(-2), treasuryAccountId: bank._id, fee: 15000, collateral: 600000, reference: "CS-001" });
  const c1 = D(c1r);
  check("caution de soumission : bénéficiaire repris de l'appel", c1r.status === 201 && c1.beneficiary === "Ministère de la Santé", `${c1r.status} ${J(c1r.data).slice(0, 200)}`);
  const ce = await entriesOf(g, "CS-001");
  check("commission en 631, dépôt en 275, banque débitée", ce.some(e => e.lines.some(l => l.accountCode === "631000" && l.debit === 15000)) && ce.some(e => e.lines.some(l => l.accountCode === "275000" && l.debit === 600000)) && b1 - (await bal()) === 615000, J(ce.map(e => e.lines)));
  check("dépôt plus grand que la caution : refusé", (await g.req("POST", "/api/cautions", { type: "soumission", beneficiary: "X", amount: 100, collateral: 200, treasuryAccountId: bank._id })).status === 400);
  const list = D(await g.req("GET", "/api/cautions?status=active"));
  check("liste : caution échue signalée, engagements hors bilan", list.items?.find(x => x._id === c1._id)?.alert === "expired" && list.commitments?.total === 600000 && list.commitments.collateral === 600000, J(list.commitments));
  const brief = D(await g.req("GET", "/api/brief?limit=20"));
  check("brief : mainlevée à demander", brief.items?.some(i => i.kind === "guarantee_due" && /mainlevée/.test(i.title)), J(brief.items?.map(i => i.kind)));
  const cron = await fetch(`${BASE}/api/cron?job=bank-guarantees`, { headers: { "x-cron-key": process.env.CRON_SECRET ?? "" } });
  check("tâche planifiée des cautions : exécutée", cron.ok, String(cron.status));
  const rl = await g.req("POST", `/api/cautions/${c1._id}/release`, {});
  check("mainlevée : dépôt rendu en banque", rl.status === 200 && D(rl).status === "released" && b1 - (await bal()) === 15000, `${rl.status} ${b1 - (await bal())}`);
  check("mainlevée déjà obtenue : refusée", (await g.req("POST", `/api/cautions/${c1._id}/release`, {})).status === 400);
  const c2 = D(await g.req("POST", "/api/cautions", { type: "bonne_execution", contractId: ct._id, amount: 200000, expiryDate: plusDays(200), treasuryAccountId: bank._id, collateral: 50000, reference: "CBE-002" }));
  check("caution de bonne exécution : bénéficiaire = client du marché", c2.beneficiary === "Direction des Routes", J(c2).slice(0, 150));
  const b2 = await bal();
  const call = await g.req("POST", `/api/cautions/${c2._id}/call`, { amount: 120000 });
  const callE = (await entriesOf(g, "CBE-002")).find(e => e.lines.some(l => l.accountCode === "658000"));
  check("caution appelée : 658 à la charge, dépôt imputé, banque débitée du reste", call.status === 200 && callE && balancedE(callE) && callE.lines.some(l => l.accountCode === "658000" && l.debit === 120000) && callE.lines.some(l => l.accountCode === "275000" && l.credit === 50000) && b2 - (await bal()) === 70000, `${call.status} ${J(callE?.lines)} ${b2 - (await bal())}`);
  const c3 = D(await g.req("POST", "/api/cautions", { type: "avance_demarrage", contractId: ct._id, amount: 400000, treasuryAccountId: bank._id, fee: 8000, reference: "CRA-003" }));
  const b3 = await bal();
  const del = await g.req("DELETE", `/api/cautions/${c3._id}`);
  check("saisie erronée supprimée : commission extournée, trésorerie corrigée", del.status === 204 && (await bal()) - b3 === 8000, `${del.status} ${(await bal()) - b3}`);
  check("cautions du marché listées", (D(await g.req("GET", `/api/cautions?contractId=${ct._id}`)).items ?? []).length === 1);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
