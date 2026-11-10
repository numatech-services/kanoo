// Scénario de bout en bout : lot H2 — droits d'enregistrement et timbres des
// marchés (CGI art. 470, 471, 481, 548, 560, 584), marge du marché, défauts
// des marchés (docs/AUDIT-2026-10.md §1).
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

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const today = new Date().toISOString().slice(0, 10);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque H2", type: "bank", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse H2", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const pub = D(await g.req("POST", "/api/clients", { code: "H2-PUB", name: "Ministère de l'Équipement", type: "company", buyerType: "state" }));
  const priv = D(await g.req("POST", "/api/clients", { code: "H2-PRV", name: "Société privée", type: "company", buyerType: "private" }));
  check("nature du client enregistrée", pub.buyerType === "state" && priv.buyerType === "private", J([pub.buyerType, priv.buyerType]));

  console.log("\n▶ Timbre : plus de droit sur la facture, timbre-quittance en espèces");
  const f1 = D(await g.req("POST", "/api/invoices", { clientId: priv._id, issueDate: today, dueDate: today, lines: [{ description: "Vente", quantity: 1, unitPrice: 2_000_000, tvaRate: 0.19 }] }));
  check("facture sans droit de timbre ajouté au TTC", f1.totalDTS === 0 && f1.totalTTC === 2_380_000, J({ dts: f1.totalDTS, ttc: f1.totalTTC }));
  await g.req("POST", `/api/invoices/${f1._id}/send`);
  const p1 = await g.req("POST", "/api/payments", { invoiceId: f1._id, amount: 100_000, method: "cash", date: today, treasuryAccountId: caisse });
  const p2 = await g.req("POST", "/api/payments", { invoiceId: f1._id, amount: 100_000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  const tq = await entries({ reference: /^TQ-/ });
  check("timbre-quittance de 200 FCFA sur le seul règlement en espèces (646200 / 447000)", p1.status === 201 && p2.status === 201 && tq.length === 1
    && tq[0].lines.some(l => l.accountCode === "646200" && l.debit === 200) && tq[0].lines.some(l => l.accountCode === "447000" && l.credit === 200), J(tq.map(e => e.lines)));
  const f2 = D(await g.req("POST", "/api/invoices", { clientId: pub._id, issueDate: today, dueDate: today, lines: [{ description: "Fourniture", quantity: 1, unitPrice: 50_000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${f2._id}/send`);
  await g.req("POST", "/api/payments", { invoiceId: f2._id, amount: 50_000, method: "cash", date: today, treasuryAccountId: caisse });
  check("client public : exonéré de timbre-quittance", (await entries({ reference: /^TQ-/ })).length === 1);

  console.log("\n▶ Marché public : 5 % HT + timbre de l'original");
  const dv = D(await g.req("POST", "/api/devis", { clientId: pub._id, issueDate: today, validUntil: today, lines: [{ description: "Construction d'une école (financement extérieur, exonéré)", quantity: 1, unitPrice: 10_000_000, tvaRate: 0 }] }));
  await g.req("PATCH", `/api/devis/${dv._id}`, { status: "accepted" });
  const tm = await g.req("POST", `/api/devis/${dv._id}/to-market`, { title: "École de Tillabéri", approvalDate: today, milestones: [{ label: "Avance 20 %", kind: "deposit", rate: 20 }] });
  const mc = D(tm).contractId, prj = D(tm).projectId;
  const ct0 = await withDb(ROOT, db => db.collection("contracts").findOne({ _id: new ObjectId(String(mc)) }));
  check("taux de TVA du devis (exonéré) repris par le marché", tm.status === 201 && ct0.tvaRate === 0, J({ s: tm.status, t: ct0?.tvaRate }));
  const est = D(await g.req("GET", `/api/contracts/${mc}/registration`));
  check("estimation : 500 000 + 25 000, échéance à un mois", est.estimate?.duty === 500_000 && est.estimate?.stamp === 25_000 && est.estimate?.buyerType === "state" && !!est.estimate?.dueDate, J(est.estimate));
  const fin0 = D(await g.req("GET", `/api/contracts/${mc}/finance`));
  const reg0 = fin0.costs?.categories?.find(c => c.key === "registration");
  // La catégorie porte aussi la redevance de régulation calculée (marché public) : elle se retranche.
  check("avant constat : droits comptés en dépense engagée du marché", reg0?.committed - (fin0.terms?.regulation?.estimate ?? 0) === 525_000 && fin0.registration?.estimate === 525_000, J({ reg0, r: fin0.registration }));
  const as1 = await g.req("POST", `/api/contracts/${mc}/registration`, { action: "assess" });
  const as2 = await g.req("POST", `/api/contracts/${mc}/registration`, { action: "assess" });
  const enr = (await entries({ reference: /^ENR-/, linkedDocType: "registration" }))[0];
  check("constat : 646100 et 646200 imputés au projet, 447300 au crédit ; une seule fois", as1.status === 200 && as2.status === 400 && enr
    && enr.lines.some(l => l.accountCode === "646100" && l.debit === 500_000 && String(l.projectId) === String(prj))
    && enr.lines.some(l => l.accountCode === "646200" && l.debit === 25_000)
    && enr.lines.some(l => l.accountCode === "447300" && l.credit === 525_000), J({ s: [as1.status, as2.status], l: enr?.lines }));
  const fin1 = D(await g.req("GET", `/api/contracts/${mc}/finance`));
  const reg1 = fin1.costs?.categories?.find(c => c.key === "registration");
  check("après constat : dépense réalisée du marché (plus engagée)", reg1?.actual === 525_000 && (reg1?.committed ?? 0) === (fin0.terms?.regulation?.estimate ?? 0), J(reg1));
  const pay = await g.req("POST", `/api/contracts/${mc}/registration`, { action: "pay", treasuryAccountId: bank, date: today, number: "ENR-2026-0457" });
  const payE = (await entries({ linkedDocType: "registration", lines: { $elemMatch: { accountCode: "447300", debit: 525_000 } } }))[0];
  const ctP = await withDb(ROOT, db => db.collection("contracts").findOne({ _id: new ObjectId(String(mc)) }));
  const mv = await withDb(ROOT, db => db.collection("treasurymovements").findOne({ linkedDocType: "contract", linkedDocId: new ObjectId(String(mc)), amount: -525_000 }));
  check("paiement : 447300 soldé par la banque, mouvement de trésorerie, n° de quittance", pay.status === 200 && payE && ctP.registration.paid === 525_000 && ctP.registration.number === "ENR-2026-0457" && !!mv, J({ s: pay.status, paid: ctP?.registration?.paid }));
  const pay2 = await g.req("POST", `/api/contracts/${mc}/registration`, { action: "pay", treasuryAccountId: bank, date: today });
  check("déjà payé : second paiement refusé", pay2.status === 400, pay2.status);
  const dep = await g.req("POST", `/api/contracts/${mc}/invoice`, { milestoneId: ct0.milestones[0]._id });
  const depInv = D(dep).invoice;
  check("facture du marché exonérée (taux du marché)", dep.status === 201 && depInv?.totalTVA === 0, J({ s: dep.status, tva: depInv?.totalTVA }));

  console.log("\n▶ Contrats privés, sous-traitance, petits bons de commande");
  const cpr = D(await g.req("POST", "/api/contracts", { title: "Maintenance privée", type: "client", clientId: priv._id, amount: 4_000_000, status: "active", approvalDate: today }));
  check("contrat privé : 2 % HT", D(await g.req("GET", `/api/contracts/${cpr._id}/registration`)).estimate?.total === 80_000);
  const csb = D(await g.req("POST", "/api/contracts", { title: "Sous-traitance gros œuvre", type: "client", clientId: pub._id, amount: 30_000_000, status: "active", isSubcontract: true, approvalDate: today }));
  check("sous-traitance : 50 000 fixe", D(await g.req("GET", `/api/contracts/${csb._id}/registration`)).estimate?.total === 50_000);
  const cbc = D(await g.req("POST", "/api/contracts", { title: "Bon de commande fournitures", type: "client", clientId: pub._id, amount: 600_000, status: "active", instrument: "purchase_order", pages: 3, approvalDate: today }));
  const ebc = D(await g.req("GET", `/api/contracts/${cbc._id}/registration`)).estimate;
  check("bon de commande public < 1 M : timbre de dimension 3 × 1 500", ebc?.kind === "dimension_stamp" && ebc?.total === 4_500, J(ebc));
  const noDate = D(await g.req("POST", "/api/contracts", { title: "Sans date", type: "client", clientId: priv._id, amount: 1_000_000, status: "active" }));
  check("constat sans date d'approbation ni de signature : refusé", (await g.req("POST", `/api/contracts/${noDate._id}/registration`, { action: "assess" })).status === 400);
  const ccx = await g.req("POST", `/api/contracts/${cpr._id}/registration`, { action: "assess" });
  const cancel = await g.req("POST", `/api/contracts/${cpr._id}/registration`, { action: "cancel", reason: "Nature d'acheteur erronée" });
  const after = await withDb(ROOT, db => db.collection("contracts").findOne({ _id: new ObjectId(String(cpr._id)) }));
  check("constat non payé : annulable (écritures extournées)", ccx.status === 200 && cancel.status === 200 && !after.registration?.assessedAt && (await entries({ reference: { $in: [`ENR-${after.reference}`, `EXT-ENR-${after.reference}`] } })).length === 2, J([ccx.status, cancel.status]));

  console.log("\n▶ Rappels");
  const ap = new Date(Date.now() - 23 * 86_400_000).toISOString().slice(0, 10);
  const late = D(await g.req("POST", "/api/contracts", { title: "Marché à enregistrer", type: "client", clientId: pub._id, amount: 2_000_000, status: "active", approvalDate: ap }));
  const brief = D(await g.req("GET", "/api/brief?limit=10"));
  const items = brief?.items ?? brief ?? [];
  check("brief : marché à enregistrer signalé", Array.isArray(items) && items.some(i => i.kind === "registration_due"), J(Array.isArray(items) ? items.map(i => i.kind) : brief).slice(0, 200));
  void late;

  console.log("\n▶ Défauts des marchés");
  const inv3 = D(await g.req("POST", "/api/invoices", { clientId: priv._id, issueDate: today, dueDate: today, lines: [{ description: "Hors marché", quantity: 1, unitPrice: 10_000, tvaRate: 0 }] }));
  const l1 = await g.req("POST", `/api/contracts/${cpr._id}/link-invoice`, { invoiceId: inv3._id });
  const l2 = await g.req("POST", `/api/contracts/${cpr._id}/link-invoice`, { invoiceId: inv3._id });
  const ctL = await withDb(ROOT, db => db.collection("contracts").findOne({ _id: new ObjectId(String(cpr._id)) }));
  const inv3d = await withDb(ROOT, db => db.collection("invoices").findOne({ _id: new ObjectId(String(inv3._id)) }));
  const lx = await g.req("POST", `/api/contracts/${mc}/link-invoice`, { invoiceId: inv3._id });
  check("rattachement : sans doublon, contractId posé, autre client refusé", l1.status === 200 && l2.status === 200 && ctL.invoiceIds.length === 1 && String(inv3d.contractId) === String(cpr._id) && lx.status === 400, J({ n: ctL.invoiceIds.length, l: [l1.status, l2.status, lx.status] }));
  const fo = D(await g.req("POST", "/api/marches-cadres", { clientId: priv._id, title: "Cadre H2", totalQuantity: 10, unitPrice: 10_000, inputPerUnit: 0 }));
  const lot = D(await g.req("POST", `/api/marches-cadres/${fo._id}/lots`, { quantity: 4 }));
  const bill = await g.req("POST", `/api/marches-cadres/${fo._id}/lots/${lot._id}/facturer`, {});
  const lotInv = D(bill);
  await g.req("POST", `/api/invoices/${lotInv._id}/credit-note`, { mode: "full", reason: "Lot refusé" });
  const lotD = await withDb(ROOT, db => db.collection("deliverylots").findOne({ _id: new ObjectId(String(lot._id)) }));
  const foD = await withDb(ROOT, db => db.collection("frameworkorders").findOne({ _id: new ObjectId(String(fo._id)) }));
  check("avoir total sur un lot : lot rouvert, quantité facturée rendue", bill.status === 201 && lotD.status === "delivered" && !lotD.invoiceId && (foD.invoicedQuantity ?? 0) === 0, J({ b: bill.status, st: lotD?.status, q: foD?.invoicedQuantity }));
  const rebill = await g.req("POST", `/api/marches-cadres/${fo._id}/lots/${lot._id}/facturer`, {});
  check("le lot se refacture", rebill.status === 201, rebill.status);
  const refs = await withDb(ROOT, db => db.collection("contracts").find({ tenantId: ct0.tenantId }).project({ reference: 1 }).toArray());
  check("références de contrat uniques", new Set(refs.map(r => r.reference)).size === refs.length, J(refs.map(r => r.reference)));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
