// Scénario de bout en bout : lot H1 — encaissements, avoirs, numérotation,
// relevé client, marchés, charges récurrentes, comptoir, lettrage par ligne,
// clôture (docs/AUDIT-2026-10.md).
import { readFileSync } from "fs";
import { withDb } from "./db.mjs";

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
  async function req(method, p, body, extraHeaders = {}) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const form = body instanceof FormData;
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), ...(form ? {} : { "content-type": "application/json" }), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}), ...extraHeaders }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  }
  return { req, reset: () => { csrf = ""; } };
}
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



const { ObjectId } = (await import("module")).createRequire(`${ROOT}/package.json`)("mongodb");
const entries = (filter) => withDb(ROOT, db => db.collection("accountingentries").find(filter).toArray());
const inv = (id) => withDb(ROOT, db => db.collection("invoices").findOne({ _id: new ObjectId(String(id)) }));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque H1", type: "bank", openingBalance: 0, openingDate: `${year - 2}-01-01` }))._id;
  const clientA = D(await g.req("POST", "/api/clients", { code: "H1-A", name: "Client A", type: "company" }));
  const clientB = D(await g.req("POST", "/api/clients", { code: "H1-B", name: "Client B", type: "company" }));
  const mkInv = async (clientId, lines, issueDate = today) => D(await g.req("POST", "/api/invoices", { clientId, issueDate, dueDate: issueDate, lines }));
  const send = (id) => g.req("POST", `/api/invoices/${id}/send`);
  const pay = (id, amount, extra = {}) => g.req("POST", "/api/payments", { invoiceId: id, amount, method: "bank_transfer", date: today, treasuryAccountId: bank, ...extra });

  console.log("\n▶ Numérotation continue (V9)");
  const d1 = await mkInv(clientA._id, [{ description: "Brouillon supprimé", quantity: 1, unitPrice: 1000, tvaRate: 0 }]);
  check("un brouillon porte un numéro provisoire", /^BROUILLON-/.test(d1.number), d1.number);
  await g.req("DELETE", `/api/invoices/${d1._id}`);
  const i1 = await mkInv(clientA._id, [{ description: "Prestation", quantity: 1, unitPrice: 100000, tvaRate: 0 }]);
  await send(i1._id);
  const i2 = await mkInv(clientA._id, [{ description: "Prestation 2", quantity: 1, unitPrice: 50000, tvaRate: 0 }]);
  await send(i2._id);
  const n1 = (await inv(i1._id)).number, n2 = (await inv(i2._id)).number;
  const seq = n => Number(n.split("-").pop());
  check("numéro définitif à l'émission, sans trou laissé par le brouillon supprimé", /^FAC-\d{4}-\d+$/.test(n1) && seq(n2) === seq(n1) + 1, `${n1} ${n2}`);
  const dec = await mkInv(clientA._id, [{ description: "Décembre", quantity: 1, unitPrice: 10000, tvaRate: 0 }], `${year - 1}-12-20`);
  const decSent = await send(dec._id);
  const decNum = (await inv(dec._id)).number;
  check("facture datée de l'an passé : numéro de l'an passé, sans collision", decSent.status === 200 && decNum.startsWith(`FAC-${year - 1}-`), `${decSent.status} ${decNum}`);

  console.log("\n▶ Encaissements (V1, V5, V6)");
  const ttc1 = (await inv(i1._id)).totalTTC;
  const both = await Promise.all([pay(i1._id, ttc1), pay(i1._id, ttc1)]);
  const after = await inv(i1._id);
  check("deux encaissements simultanés du solde : un seul passe", both.filter(r => r.status === 201).length === 1 && after.paidAmount === ttc1 && after.status === "paid", J({ st: both.map(r => r.status), paid: after.paidAmount, ttc1 }));
  const avFull = await g.req("POST", `/api/invoices/${i2._id}/credit-note`, { mode: "full", reason: "Annulée" });
  const cn = avFull.data?.data?.creditNote ?? avFull.data?.data;
  const payCn = await pay(cn._id, 1000);
  check("un avoir ne s'encaisse pas", avFull.status < 300 && payCn.status === 400, J([avFull.status, payCn.status]));
  const i3 = await mkInv(clientA._id, [{ description: "À annuler", quantity: 2, unitPrice: 40000, tvaRate: 0 }]);
  await send(i3._id);
  const pPending = D(await pay(i3._id, 10000, { status: "pending" }));
  await g.req("PATCH", `/api/payments/${pPending._id}`, { status: "effective", treasuryAccountId: bank });
  await g.req("POST", `/api/payments/${pPending._id}/cancel`, { reason: "Chèque impayé" });
  const reconf = await g.req("PATCH", `/api/payments/${pPending._id}`, { status: "effective", treasuryAccountId: bank });
  check("un paiement annulé ne se reconfirme pas", reconf.status === 400, reconf.status);
  await g.req("POST", `/api/invoices/${i3._id}/credit-note`, { reason: "Remise", lines: [{ lineIndex: 0, quantity: 1 }] });
  const cancelR = await g.req("POST", `/api/invoices/${i3._id}/cancel`);
  check("facture avec avoir partiel : annulation refusée (V2)", cancelR.status === 400, cancelR.status);

  console.log("\n▶ Avoirs (V7)");
  const prod = D(await g.req("POST", "/api/products", { code: "H1-ART", label: "Marchandise H1", unitPrice: 30000, initialQty: 50, initialCost: 10000 }));
  const i4 = await mkInv(clientA._id, [
    { productId: prod._id, description: "Marchandise", quantity: 10, unitPrice: 30000, tvaRate: 0.19 },
    { description: "Installation", quantity: 2, unitPrice: 300000, tvaRate: 0.19 },
  ]);
  await send(i4._id);
  const i4d = await inv(i4._id);
  const c1 = await g.req("POST", `/api/invoices/${i4._id}/credit-note`, { reason: "Retour", lines: [{ lineIndex: 0, quantity: 10 }] });
  const twice = await g.req("POST", `/api/invoices/${i4._id}/credit-note`, { reason: "Retour bis", lines: [{ lineIndex: 0, quantity: 1 }] });
  const c1doc = c1.data?.data?.creditNote ?? c1.data?.data;
  const c1e = (await entries({ linkedDocType: "invoice", linkedDocId: new ObjectId(String(c1doc._id)) }))[0];
  check("l'avoir extourne le compte de la vente (701100), pas le 706", c1e?.lines.some(l => l.accountCode === "701100" && l.debit === 300000) && !c1e?.lines.some(l => l.accountCode === "706000"), J(c1e?.lines));
  check("une ligne déjà créditée ne se crédite plus (V7)", twice.status === 400, `${twice.status} ${J(twice.data).slice(0, 120)}`);
  const c2 = await g.req("POST", `/api/invoices/${i4._id}/credit-note`, { reason: "Annulation installation", lines: [{ lineIndex: 1, quantity: 2 }] });
  const c2doc = c2.data?.data?.creditNote ?? c2.data?.data;
  const i4after = await inv(i4._id);
  check("l'avoir qui complète les précédents solde la facture", c2doc?.totalDTS === (i4d.totalDTS ?? 0) && i4after.status === "cancelled", J({ dts: i4d.totalDTS, c2: c2doc?.totalDTS, st: i4after.status }));

  console.log("\n▶ Relevé client (V3)");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const rel = D(await g.req("GET", `/api/clients/${clientA._id}/releve?from=${year - 1}-01-01&to=${tomorrow}`));
  const expected = (await withDb(ROOT, db => db.collection("invoices").find({ clientId: new ObjectId(String(clientA._id)), status: { $ne: "draft" } }).toArray()))
    .filter(i => i.documentType !== "credit_note" && !["cancelled", "written_off"].includes(i.status)).reduce((t, i) => t + Math.max(0, i.totalTTC - (i.paidAmount || 0) - (i.creditedAmount || 0)), 0);
  check("solde du relevé = reste dû réel (avoirs et factures annulées par avoir compensés)", rel?.statement?.totals?.closingBalance === expected, J({ closing: rel?.statement?.totals?.closingBalance, expected, rows: (rel?.statement?.rows ?? []).map(r => [r.kind, r.reference, r.amount]) }));

  console.log("\n▶ Marchés (M1, M2, M3)");
  const fo = D(await g.req("POST", "/api/marches-cadres", { clientId: clientA._id, title: "Cadre H1", totalQuantity: 100, unitPrice: 5000 }));
  const foP = await g.req("PATCH", `/api/marches-cadres/${fo._id}`, { title: "Cadre H1 renommé", unitPrice: 6000, deliveredQuantity: 99, invoicedQuantity: 99 });
  const foD = await withDb(ROOT, db => db.collection("frameworkorders").findOne({ _id: new ObjectId(String(fo._id)) }));
  check("marché-cadre : titre et prix modifiés, quantités protégées", foP.status === 200 && foD.title === "Cadre H1 renommé" && foD.unitPrice === 6000 && !foD.deliveredQuantity && !foD.invoicedQuantity, J({ s: foP.status, t: foD.title, p: foD.unitPrice, d: foD.deliveredQuantity }));
  const ct = D(await g.req("POST", "/api/contracts", { title: "Contrat H1", type: "client", clientId: clientA._id, amount: 120000, status: "draft", startDate: today }));
  const sg = await g.req("POST", `/api/contracts/${ct._id}/sign`, { signerName: "Moussa Gérant", signerRole: "Gérant", signedDate: today });
  const ctD = await withDb(ROOT, db => db.collection("contracts").findOne({ _id: new ObjectId(String(ct._id)) }));
  check("signature d'un contrat : il devient actif", sg.status === 200 && ctD.status === "active" && ctD.signedDate, J([sg.status, ctD.status]));
  const rc = D(await g.req("POST", "/api/contracts", { title: "Maintenance H1", type: "client", clientId: clientA._id, amount: 50000, status: "active", startDate: today, isRecurring: true, billingFrequency: "monthly" }));
  const gi = await Promise.all([g.req("POST", `/api/contracts/${rc._id}/generate-invoice`, {}), g.req("POST", `/api/contracts/${rc._id}/generate-invoice`, {})]);
  const gi3 = await g.req("POST", `/api/contracts/${rc._id}/generate-invoice`, {});
  check("contrat récurrent : une seule facture par période", gi.filter(r => r.status === 200).length === 1 && gi3.status === 400, J([...gi.map(r => r.status), gi3.status]));

  console.log("\n▶ Charges récurrentes (A2)");
  const rec = D(await g.req("POST", "/api/recurring-expenses", { label: "Loyer H1", category: "loyer", amount: 100000, frequency: "monthly", startDate: today, accountCode: "622100", treasuryAccountId: bank }));
  const ex = await Promise.all([g.req("POST", `/api/recurring-expenses/${rec._id}`, {}), g.req("POST", `/api/recurring-expenses/${rec._id}`, {})]);
  const again = await g.req("POST", `/api/recurring-expenses/${rec._id}`, {});
  const recD2 = await withDb(ROOT, db => db.collection("recurringexpenses").findOne({ _id: new ObjectId(String(rec._id)) }));
  check("double clic : une seule exécution, l'échéance suivante n'est pas payée d'avance", ex.filter(r => r.status === 200).length === 1 && again.status === 400 && recD2.executions.length === 1, J({ st: ex.map(r => r.status), again: again.status, n: recD2.executions.length }));

  console.log("\n▶ Comptoir (K1, K3)");
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse H1", type: "cash", openingBalance: 0, openingDate: `${year - 2}-01-01` }))._id;
  const mm = D(await g.req("POST", "/api/treasury-accounts", { label: "Mobile money H1", type: "mobile_money", openingBalance: 0, openingDate: `${year - 2}-01-01` }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Comptoir H1" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0 });
  const om = D(await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "in", amount: 5000, label: "Vente mobile", method: "orange_money" }));
  const mv = await withDb(ROOT, db => db.collection("treasurymovements").find({ label: /Vente mobile/ }).toArray());
  check("paiement mobile money : sur le compte mobile money, pas la caisse", mv.length === 1 && String(mv[0].accountId) === String(mm), J(mv.map(m => String(m.accountId))));
  const cashE = D(await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "in", amount: 3000, label: "Vente à supprimer" }));
  const del = await g.req("DELETE", `/api/comptoir/cash/${cashE._id ?? cashE.entry?._id}`);
  const rev = await entries({ label: /Vente à supprimer/ });
  const mvs = await withDb(ROOT, db => db.collection("treasurymovements").find({ label: /Vente à supprimer/ }).toArray());
  const net = mvs.reduce((t, m) => t + m.amount, 0);
  check("suppression d'une écriture de caisse : écriture et trésorerie extournées", del.status === 204 && rev.length === 2 && rev.some(e => e.reverses) && net === 0, J({ del: del.status, n: rev.length, net, om: !!om }));

  console.log("\n▶ Lettrage par ligne (C5)");
  const ia = await mkInv(clientA._id, [{ description: "Lettrage A", quantity: 1, unitPrice: 70000, tvaRate: 0 }]); await send(ia._id);
  const ib = await mkInv(clientB._id, [{ description: "Lettrage B", quantity: 1, unitPrice: 70000, tvaRate: 0 }]); await send(ib._id);
  await pay(ib._id, (await inv(ib._id)).totalTTC);
  const saleA = (await entries({ linkedDocType: "invoice", linkedDocId: new ObjectId(String(ia._id)) }))[0];
  const payB = (await entries({ label: `Règlement facture ${(await inv(ib._id)).number}` }))[0];
  const mixed = await g.req("POST", "/api/accounting-entries/lettrage", { entryIds: [String(saleA._id), String(payB._id)], account: "411" });
  check("facture du client A et règlement du client B : lettrage refusé", mixed.status === 400, `${mixed.status} ${J(mixed.data).slice(0, 120)}`);
  const saleB = (await entries({ linkedDocType: "invoice", linkedDocId: new ObjectId(String(ib._id)) }))[0];
  const ok1 = await g.req("POST", "/api/accounting-entries/lettrage", { entryIds: [String(saleB._id), String(payB._id)], account: "411" });
  const sb = (await entries({ _id: saleB._id }))[0];
  check("lettrage posé sur la ligne 411", ok1.status === 200 && sb.lines.some(l => l.accountCode === "411000" && l.letterRef), J({ s: ok1.status, l: sb.lines.map(l => [l.accountCode, l.letterRef]) }));
  const ren = await g.req("PATCH", `/api/accounting-entries/${saleB._id}`, { reference: "REPRISE-OUVERTURE" });
  check("référence d'une écriture de document non modifiable (C6)", ren.status === 400, ren.status);

  console.log("\n▶ Clôture (C1, C2, C3, C4)");
  const cur = await g.req("POST", "/api/accounting/closing", { action: "close", year });
  check("l'exercice en cours ne se clôture pas", cur.status === 400, cur.status);
  // Exercice précédent sans antériorité : clôture de year-1, alors que janvier est déjà verrouillé.
  await g.req("POST", "/api/accounting/closing", { action: "lock", until: `${year}-01-31` });
  const chk = D(await g.req("POST", "/api/accounting/closing", { action: "check", year: year - 1 }));
  const blocked = await g.req("POST", "/api/accounting/closing", { action: "close", year: year - 1 });
  const closed = await g.req("POST", "/api/accounting/closing", { action: "close", year: year - 1, acknowledgeWarnings: true });
  const an = (await entries({ reference: `AN-${year}` }))[0];
  check("clôture possible malgré le verrou de janvier, contrôles d'abord", Array.isArray(chk.checks) && (chk.checks.length === 0 || blocked.status === 409) && closed.status === 200 && !!an, J({ checks: chk.checks, b: blocked.status, c: closed.status, an: !!an }));
  check("à-nouveaux du 411 ventilés par client", an && an.lines.filter(l => l.accountCode === "411000").every(l => l.thirdPartyId), J(an?.lines.filter(l => l.accountCode === "411000")));
  const res130 = an?.lines.find(l => l.accountCode === "130000");
  const amount130 = res130 ? Math.abs(res130.credit - res130.debit) : 0;
  const alloc = await g.req("POST", "/api/accounting/closing", { action: "allocate", year: year - 1, date: today, allocations: [{ accountCode: "121000", amount: amount130 }] });
  check("affectation du résultat : 130 soldé", !res130 || alloc.status === 200, `${alloc.status} ${J(alloc.data).slice(0, 160)}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
