// Scénario de bout en bout : lot 3 (créances douteuses, écarts de change, états financiers SYSCOHADA).
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
const entriesOf = async (g, q) => D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(q)}&limit=50`)).items ?? [];
const balancedE = e => e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque lot 3", type: "bank", openingBalance: 0, openingDate: "2025-01-01" }));
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const year = new Date().getFullYear();
  const cl = id(await g.req("POST", "/api/clients", { code: "C-DTX", name: "Client défaillant" }));

  console.log("\n▶ Créances douteuses");
  const inv = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: daysAgo(210), dueDate: daysAgo(200), lines: [{ description: "Prestation", quantity: 1, unitPrice: 1000000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  let pv = D(await g.req("GET", "/api/accounting/provisions"));
  const w = pv.items?.find(i => i._id === inv._id);
  check("retard de 200 jours : à examiner, 50 % suggérés", w && !w.doubtful && w.suggestedRate === 0.5 && w.due === inv.totalTTC, J(w));
  const md = await g.req("POST", "/api/accounting/provisions", { action: "doubtful", invoiceId: inv._id, rate: 0.5 });
  const odE = await entriesOf(g, inv.number);
  const ht = Math.round(inv.totalTTC * inv.totalHT / inv.totalTTC);
  check("classement : 411 → 416, dépréciation de 50 % du HT (659400 / 491100)", md.status === 200
    && odE.some(e => e.lines.some(l => l.accountCode === "416000" && l.debit === inv.totalTTC) && e.lines.some(l => l.accountCode === "411000" && l.credit === inv.totalTTC))
    && odE.some(e => e.lines.some(l => l.accountCode === "659400" && l.debit === Math.round(ht * 0.5))), `${md.status} ${J(md.data).slice(0, 150)}`);
  check("déjà douteuse : refusé", (await g.req("POST", "/api/accounting/provisions", { action: "doubtful", invoiceId: inv._id })).status === 400);
  check("avoir sur créance douteuse : refusé", (await g.req("POST", `/api/invoices/${inv._id}/credit-note`, { mode: "full", reason: "x" })).status === 400);
  const half = Math.round(inv.totalTTC / 2);
  const p1 = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: half, method: "bank_transfer", date: today, treasuryAccountId: bank._id });
  const pe = (await entriesOf(g, `Règlement facture ${inv.number}`))[0];
  check("règlement partiel : 416 crédité (pas 411)", p1.status === 201 && pe?.lines.some(l => l.accountCode === "416000" && l.credit === half), `${p1.status} ${J(pe?.lines)}`);
  pv = D(await g.req("GET", "/api/accounting/provisions"));
  const d1 = pv.items.find(i => i._id === inv._id);
  check("dépréciation reprise d'elle-même au prorata du reste dû", d1 && d1.provision === d1.required && d1.provision === Math.round(Math.round((inv.totalTTC - half) * inv.totalHT / inv.totalTTC) * 0.5), J(d1));
  const rr = await g.req("POST", "/api/accounting/provisions", { action: "provision", invoiceId: inv._id, rate: 1 });
  check("taux porté à 100 % : dotation complémentaire", rr.status === 200 && D(rr).delta > 0, J(rr.data).slice(0, 150));
  const wo = await g.req("POST", "/api/accounting/provisions", { action: "writeoff", invoiceId: inv._id });
  const woE = (await entriesOf(g, inv.number)).find(e => e.lines.some(l => l.accountCode === "651000"));
  const fi = D(await g.req("GET", `/api/invoices/${inv._id}`));
  check("perte : 651 (HT) + 443 (TVA) / 416, dépréciation reprise, statut irrécouvrable", wo.status === 200 && woE && balancedE(woE)
    && woE.lines.some(l => l.accountCode === "443000" && l.debit > 0) && fi.status === "written_off" && fi.provisionAmount === 0, `${wo.status} ${J(woE?.lines)} ${fi.status}`);
  check("facture irrécouvrable : encaissement refusé", (await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 1000, method: "bank_transfer", date: today, treasuryAccountId: bank._id })).status === 400);
  const bal491 = D(await g.req("GET", "/api/accounting/reports?type=balance&account=491")).rows ?? [];
  check("491 soldé, 416 soldé", bal491.every(r => r.soldeDebit === 0 && r.soldeCredit === 0) && (D(await g.req("GET", "/api/accounting/reports?type=balance&account=416")).rows ?? []).every(r => r.debit === r.credit), J(bal491));

  console.log("\n▶ Écarts de change");
  const inv2 = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Export", quantity: 1, unitPrice: 1000000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  check("écart au-delà de 10 % : refusé", (await g.req("POST", "/api/payments", { invoiceId: inv2._id, amount: 800000, exchangeDifference: inv2.totalTTC - 800000, method: "bank_transfer", date: today, treasuryAccountId: bank._id })).status === 400);
  const loss = inv2.totalTTC - 985000;
  const fx = await g.req("POST", "/api/payments", { invoiceId: inv2._id, amount: 985000, exchangeDifference: loss, method: "bank_transfer", date: today, treasuryAccountId: bank._id });
  const fxE = (await entriesOf(g, `Règlement facture ${inv2.number}`))[0];
  check("perte de change : facture soldée, 676 au débit, 411 soldé du tout", fx.status === 201 && D(await g.req("GET", `/api/invoices/${inv2._id}`)).status === "paid"
    && fxE?.lines.some(l => l.accountCode === "676000" && l.debit === loss) && fxE.lines.some(l => l.accountCode === "411000" && l.credit === inv2.totalTTC), `${fx.status} ${J(fxE?.lines)}`);
  const can = await g.req("POST", `/api/payments/${D(fx)._id}/cancel`, { reason: "test" });
  check("annulation : facture rouverte en entier", can.status === 200 && D(await g.req("GET", `/api/invoices/${inv2._id}`)).paidAmount === 0);
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-USD", name: "Fournisseur américain" }));
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, validate: true, lines: [{ description: "Licence", accountCode: "605000", quantity: 1, unitPrice: 500000, tvaRate: 0 }] }));
  await g.req("POST", `/api/treasury-accounts/movements`, { kind: "manual", direction: "in", accountId: bank._id, amount: 2000000, date: today, label: "Apport", counterAccount: "101000" });
  const pp = await g.req("POST", `/api/achats/${pur._id}/pay`, { amount: 490000, exchangeDifference: 10000, treasuryAccountId: bank._id, date: today, allowOverdraft: true });
  const ppE = (await entriesOf(g, `${pur.number}-RGL`))[0];
  const pd = D(await g.req("GET", `/api/achats/${pur._id}`));
  check("fournisseur payé en devise : dette soldée, gain de change (776)", pp.status === 200 && pd.status === "paid" && ppE && balancedE(ppE) && ppE.lines.some(l => l.accountCode === "776000" && l.credit === 10000), `${pp.status} ${J(pp.data).slice(0, 150)} ${pd.status} ${J(ppE?.lines)}`);

  console.log("\n▶ États financiers SYSCOHADA");
  const fs = D(await g.req("GET", `/api/accounting/financial-statements?annee=${year}`));
  const ref = (lines, r) => lines?.find(l => l.ref === r)?.amount;
  check("bilan équilibré", fs.balanceSheet && Math.abs(fs.balanceSheet.totalActif - fs.balanceSheet.totalPassif) < 1, J({ a: fs.balanceSheet?.totalActif, p: fs.balanceSheet?.totalPassif }));
  check("compte de résultat : tous les comptes classés, résultat = CJ du bilan", fs.incomeStatement?.unclassified === 0 && ref(fs.incomeStatement.lines, "XI") === ref(fs.balanceSheet.passif, "CJ"), J({ u: fs.incomeStatement?.unclassified, xi: ref(fs.incomeStatement?.lines, "XI"), cj: ref(fs.balanceSheet?.passif, "CJ") }));
  const pl = D(await g.req("GET", `/api/accounting/reports?type=pl&from=${year}-01-01&to=${year}-12-31`));
  check("résultat identique au compte de résultat simplifié", pl.resultat === ref(fs.incomeStatement.lines, "XI"), J({ pl: pl.resultat }));
  check("tableau des flux rapproché de la trésorerie", fs.cashFlow?.gap === 0, J(fs.cashFlow?.lines?.filter(l => l.total)));
  check("pertes sur créances au compte de résultat", ref(fs.incomeStatement.lines, "RJ") < 0, J(ref(fs.incomeStatement.lines, "RJ")));
  check("notes : clients et engagements", Array.isArray(fs.notes?.clients) && Array.isArray(fs.notes?.commitments), J(fs.notes).slice(0, 150));
  const x = await g.req("GET", `/api/accounting/financial-statements?annee=${year}&format=xlsx`);
  check("liasse Excel téléchargeable", x.status === 200 && typeof x.data === "string" && x.data.startsWith("PK"), `${x.status} ${String(x.data).slice(0, 40)}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
