// Scénario de bout en bout : The Spot, 10 améliorations — ardoise, fiche
// recette, pertes, réassort, objectifs, promotions, caissiers, mobile money,
// caisse rapide (ticket idempotent), inventaire tournant.
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
const db = fn => withDb(ROOT, fn);
const oid = x => new ObjectId(String(x));
const cron = async job => (await fetch(`${BASE}/api/cron?job=${job}`, { headers: { "x-cron-key": process.env.CRON_SECRET } })).json();

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const local = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = n => local(new Date(Date.now() - n * 86_400_000));
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse Spot 2", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  await g.req("POST", "/api/treasury-accounts", { label: "Airtel Money Spot", type: "mobile_money", openingBalance: 0, openingDate: "2025-01-01" });
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot 2" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0, leadDays: 2, coverDays: 7, weeklyRevenueTarget: 100_000, cycleCountSize: 3 });
  const item = async b => D(await g.req("POST", "/api/comptoir/items", { deskId: desk, ...b }));
  const sale = (b, s = g) => s.req("POST", "/api/comptoir/sales", { deskId: desk, ...b });

  console.log("\n▶ 5. Objectifs de la semaine");
  const op = await g.req("POST", "/api/comptoir/sessions", { deskId: desk, openingFloat: 5000, day: daysAgo(2) });
  check("caisse ouverte (il y a 2 jours) avec l'objectif du comptoir", op.status === 201 && D(op).targets?.revenue === 100_000, `${op.status} ${J(op.data).slice(0, 150)}`);

  console.log("\n▶ 1. Ardoise");
  const soda = await item({ name: "Soda", unit: "bouteille", category: "Boissons", quantity: 25, unitCost: 300, salePrice: 500, pack: { label: "casier", size: 24, cost: 7200 } });
  const cust = D(await g.req("POST", "/api/comptoir/customers", { deskId: desk, name: "Moussa l'habitué", phone: "90112233", creditLimit: 5000 }));
  const a1 = await sale({ lines: [{ itemId: soda._id, quantity: 6, unitPriceTTC: 500 }], payments: [{ method: "credit", amount: 3000 }], customerId: cust._id });
  const c1 = await db(d => d.collection("deskcustomers").findOne({ _id: oid(cust._id) }));
  const e1 = await db(d => d.collection("accountingentries").findOne({ linkedDocType: "comptoir_sale", linkedDocId: oid(D(a1).sale?._id) }));
  const cashA1 = await db(d => d.collection("activitycashentries").countDocuments({ saleId: oid(D(a1).sale?._id) }));
  check("vente à l'ardoise : dû 3 000, créance 411800, rien en caisse", a1.status === 201 && c1.balance === 3000 && e1?.lines?.some(l => l.accountCode === "411800" && l.debit === 3000) && cashA1 === 0, `${a1.status} ${J(a1.data).slice(0, 150)} ${c1?.balance}`);
  check("plafond : 3 000 + 2 500 > 5 000 refusé", (await sale({ lines: [{ itemId: soda._id, quantity: 5, unitPriceTTC: 500 }], payments: [{ method: "credit", amount: 2500 }], customerId: cust._id })).status === 400);
  check("ardoise sans client : refusée", (await sale({ lines: [{ itemId: soda._id, quantity: 1, unitPriceTTC: 500 }], payments: [{ method: "credit", amount: 500 }] })).status === 400);
  await g.req("POST", `/api/comptoir/sales/${D(a1).sale._id}/cancel`, { reason: "Erreur de client" });
  const c2 = await db(d => d.collection("deskcustomers").findOne({ _id: oid(cust._id) }));
  check("ticket à l'ardoise annulé : dette effacée", c2.balance === 0, c2.balance);
  await sale({ lines: [{ itemId: soda._id, quantity: 4, unitPriceTTC: 500 }], payments: [{ method: "credit", amount: 2000 }], customerId: cust._id });
  const st = await g.req("POST", `/api/comptoir/customers/${cust._id}/settle`, { amount: 2000, method: "cash" });
  const c3 = await db(d => d.collection("deskcustomers").findOne({ _id: oid(cust._id) }));
  const stE = await db(d => d.collection("accountingentries").findOne({ label: /Règlement ardoise — Moussa/ }));
  check("règlement en espèces : ardoise soldée, caisse / 411800", st.status === 200 && c3.balance === 0 && !c3.oldestDebtAt && stE?.lines?.some(l => l.accountCode === "411800" && l.credit === 2000), `${st.status} ${J(st.data)}`);
  check("trop régler : refusé", (await g.req("POST", `/api/comptoir/customers/${cust._id}/settle`, { amount: 1 })).status === 400);
  const hist = D(await g.req("GET", `/api/comptoir/customers/${cust._id}`)).moves ?? [];
  check("historique : 2 ventes, 1 annulation, 1 règlement", hist.length === 4 && hist.filter(m => m.kind === "sale").length === 2, J(hist.map(m => [m.kind, m.amount])));

  console.log("\n▶ 2. Fiche recette");
  const farine = await item({ name: "Farine", unit: "kg", quantity: 10, unitCost: 600 });
  const huile = await item({ name: "Huile", unit: "litre", quantity: 5, unitCost: 1200 });
  const viande = await item({ name: "Viande hachée", unit: "kg", quantity: 3, unitCost: 3000 });
  const pastel = await item({ name: "Pastel maison", unit: "pièce", category: "Snacks", salePrice: 200 });
  const rec = await g.req("PATCH", `/api/comptoir/items/${pastel._id}`, { recipe: [{ itemId: farine._id, quantity: 0.05 }, { itemId: huile._id, quantity: 0.02 }, { itemId: viande._id, quantity: 0.02 }] });
  check("recette enregistrée ; ingrédient = lui-même refusé", rec.status === 200 && (await g.req("PATCH", `/api/comptoir/items/${pastel._id}`, { recipe: [{ itemId: pastel._id, quantity: 1 }] })).status === 400, `${rec.status} ${J(rec.data).slice(0, 120)}`);
  const ps = D(await sale({ lines: [{ itemId: pastel._id, quantity: 10 }] })).sale;
  const stock = async () => Object.fromEntries((D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)) ?? []).map(i => [i.name, i.quantity]));
  let s1 = await stock();
  check("10 pastels : ingrédients sortis (farine 9,5, huile 4,8, viande 2,8)", s1["Farine"] === 9.5 && s1["Huile"] === 4.8 && s1["Viande hachée"] === 2.8, J(s1));
  check("coût figé 114 par pastel, marge 860", ps?.lines?.[0]?.unitCost === 114 && ps.lines[0].marginHT === 860 && ps.lines[0].ingredients?.length === 3, J(ps?.lines?.[0]));
  const prof = D(await g.req("GET", `/api/comptoir/profitability?deskId=${desk}`));
  const pRow = prof.items?.find(r => r._id === pastel._id);
  check("rentabilité : coût de la recette 114, marge 86 par pastel", pRow?.economics?.unitCost === 114 && pRow.economics.marginUnit === 86 && pRow.recipe?.length === 3, J(pRow?.economics));
  await g.req("POST", `/api/comptoir/sales/${ps._id}/cancel`, { reason: "Test" });
  s1 = await stock();
  check("ticket annulé : ingrédients rendus", s1["Farine"] === 10 && s1["Viande hachée"] === 3, J(s1));

  console.log("\n▶ 3. Pertes et casse");
  const loss = await g.req("POST", "/api/comptoir/losses", { deskId: desk, itemId: farine._id, quantity: 0.5, reason: "expired", note: "charançons" });
  check("perte déclarée : 0,5 kg de farine = 300 au coût", loss.status === 201 && D(loss).lossValue === 300, `${loss.status} ${J(loss.data).slice(0, 120)}`);
  check("motif inconnu : refusé", (await g.req("POST", "/api/comptoir/losses", { deskId: desk, itemId: farine._id, quantity: 1, reason: "xx" })).status === 400);
  const lr = D(await g.req("GET", `/api/comptoir/losses?deskId=${desk}`));
  check("pertes par motif", lr.byReason?.find(r => r.reason === "expired")?.value === 300 && lr.total === 300, J(lr));

  console.log("\n▶ 6. Promotions");
  const today = new Date().getDay();
  const pr1 = await g.req("POST", "/api/comptoir/promos", { deskId: desk, name: "Happy soda", itemIds: [soda._id], kind: "percent", value: 20, days: [today], from: "00:00", to: "23:59" });
  const pr2 = await g.req("POST", "/api/comptoir/promos", { deskId: desk, name: "Casier de 6", itemIds: [soda._id], kind: "price", value: 350, minQty: 6 });
  check("promotions créées ; sans article ni famille refusée", pr1.status === 201 && pr2.status === 201 && (await g.req("POST", "/api/comptoir/promos", { deskId: desk, name: "x", kind: "percent", value: 10 })).status === 400);
  const ps1 = D(await sale({ lines: [{ itemId: soda._id, quantity: 2 }] })).sale;
  check("happy hour : 500 → 400, promotion notée", ps1?.lines?.[0]?.unitPriceTTC === 400 && ps1.lines[0].listPrice === 500 && ps1.lines[0].promoName === "Happy soda", J(ps1?.lines?.[0]));
  const ps2 = D(await sale({ lines: [{ itemId: soda._id, quantity: 6 }] })).sale;
  check("prix de gros dès 6 : 350 (le meilleur prix)", ps2?.lines?.[0]?.unitPriceTTC === 350 && ps2.lines[0].promoName === "Casier de 6", J(ps2?.lines?.[0]));
  const ps3 = D(await sale({ lines: [{ itemId: soda._id, quantity: 1, unitPriceTTC: 500 }] })).sale;
  check("prix saisi à la main : pas de promotion", ps3?.lines?.[0]?.unitPriceTTC === 500 && !ps3.lines[0].promoId, J(ps3?.lines?.[0]));
  const pe = D(await g.req("GET", `/api/comptoir/promos?deskId=${desk}`)).items ?? [];
  check("effet : remise accordée 200 (happy) et 900 (gros)", pe.find(p => p.name === "Happy soda")?.effect?.discount === 200 && pe.find(p => p.name === "Casier de 6")?.effect?.discount === 900, J(pe.map(p => [p.name, p.effect])));

  console.log("\n▶ 4. Réassort conseillé");
  // Soda : 25 − 4 (ardoise) − 2 − 6 − 1 = 12 en stock, 13 vendus sur 28 j.
  const sup = D(await g.req("POST", "/api/suppliers", { code: "SUP-SPOT", name: "Brasseries du Niger" }));
  const eau = D(await g.req("POST", "/api/products", { code: "EAU-15", label: "Eau 1,5 L", unitPrice: 300, tvaRate: 0, initialQty: 50, initialCost: 200, preferredSupplierId: sup._id }));
  const itEau = await item({ productId: eau._id, salePrice: 350 });
  const princ = D(await g.req("GET", "/api/warehouses")).find(w => w.code === "PRINC");
  await g.req("POST", "/api/comptoir/supply", { deskId: desk, fromWarehouseId: princ._id, lines: [{ itemId: itEau._id, quantity: 12 }] });
  await sale({ lines: [{ itemId: itEau._id, quantity: 11, unitPriceTTC: 350 }] });
  const plan = D(await g.req("GET", `/api/comptoir/reorder?deskId=${desk}`));
  const rEau = plan.lines?.find(l => l.itemId === itEau._id);
  check("eau : 1 en stock, rupture avant livraison (2 j restants = délai), à commander", rEau?.stock === 1 && rEau.urgent === true && rEau.quantity > 0 && rEau.supplier?.name === "Brasseries du Niger", J(rEau));
  const ro = await g.req("POST", "/api/comptoir/reorder", { deskId: desk, lines: [{ itemId: itEau._id, quantity: rEau?.quantity }, { itemId: farine._id, quantity: 5 }] });
  const cmd = D(ro).orders?.[0] && await db(d => d.collection("commandes").findOne({ _id: oid(D(ro).orders[0]._id) }));
  check("bon de commande brouillon au fournisseur habituel ; farine en liste de courses", ro.status === 201 && cmd?.status === "draft" && String(cmd.supplierId) === sup._id && D(ro).shopping?.[0]?.name === "Farine", `${ro.status} ${J(ro.data).slice(0, 200)}`);

  console.log("\n▶ 7. Contrôle des caissiers");
  const PWS = `Kz-${Date.now()}!Aa9`;
  await g.req("POST", "/api/users", { email: "caisse2.spot@test.ne", password: PWS, firstName: "Awa", lastName: "Caisse", roles: ["svc_spot"], roleLevels: { svc_spot: "employe" }, siteIds: [desk] });
  const { s: cash } = await login("caisse2.spot@test.ne", PWS);
  const own = [];
  for (let k = 0; k < 4; k++) own.push(D(await sale({ lines: [{ itemId: soda._id, quantity: 1, unitPriceTTC: 500 }] }, cash)).sale);
  for (const t of own.slice(0, 3)) await g.req("POST", `/api/comptoir/sales/${t._id}/cancel`, { reason: "Erreur" });
  const nCancel = await db(d => d.collection("notifications").countDocuments({ type: "desk_cancellations" }));
  check("3 annulations du même caissier : direction prévenue", own.every(Boolean) && nCancel > 0, `${own.length} ${nCancel}`);
  const cs = D(await g.req("GET", `/api/comptoir/cashiers?deskId=${desk}`)).items ?? [];
  const awa = cs.find(c => c.name === "Awa Caisse");
  check("tableau par caissier : 4 tickets, 3 annulés (75 %), à vérifier", awa?.tickets === 4 && awa.cancelled === 3 && awa.cancelRate === 75 && awa.alert === true, J(awa));
  check("caissier : tableau des caissiers refusé", (await cash.req("GET", `/api/comptoir/cashiers?deskId=${desk}`)).status === 403);

  console.log("\n▶ 8. Rapprochement mobile money");
  await sale({ lines: [{ itemId: soda._id, quantity: 1, unitPriceTTC: 500 }], payments: [{ method: "orange_money", amount: 500 }] });
  const t2 = new Date(); const dd = `${String(t2.getDate()).padStart(2, "0")}/${String(t2.getMonth() + 1).padStart(2, "0")}/${t2.getFullYear()}`;
  const csv = `Date;Montant;Référence;Téléphone\n${dd} 10:00;500;AM-001;90000001\n${dd} 11:00;1500;AM-002;90000002`;
  const im = await g.req("POST", "/api/comptoir/momo", { deskId: desk, operator: "Airtel Money", csv });
  check("relevé importé : 1 rapproché, 1 reçu chez l'opérateur sans ticket", im.status === 201 && D(im).added === 2 && D(im).matched?.length === 1 && D(im).statementOnly?.length === 1 && D(im).statementOnly[0].amount === 1500, `${im.status} ${J(D(im)).slice(0, 220)}`);
  const im2 = await g.req("POST", "/api/comptoir/momo", { deskId: desk, csv });
  check("réimport du même relevé : rien de doublé", D(im2).added === 0 && D(im2).skipped === 2, J(D(im2)).slice(0, 80));

  console.log("\n▶ 9. Caisse rapide : ticket renvoyé sans doublon");
  const ref = `qr${Date.now()}abcdef`;
  const q1 = await sale({ clientRef: ref, lines: [{ itemId: soda._id, quantity: 1 }] }, cash);
  const q2 = await sale({ clientRef: ref, lines: [{ itemId: soda._id, quantity: 1 }] }, cash);
  const nRef = await db(d => d.collection("comptoirsales").countDocuments({ clientRef: ref }));
  // Caisse rapide : un seul moyen de paiement, montant calculé par le serveur (promotion comprise).
  const q3 = await sale({ clientRef: `qr${Date.now()}zzzzzz`, lines: [{ itemId: soda._id, quantity: 2 }], payMethod: "orange_money" }, cash);
  check("paiement « moyen seul » : montant du serveur (2 × 400 en happy hour)", q3.status === 201 && D(q3).sale?.totalTTC === 800 && D(q3).sale?.payments?.[0]?.method === "orange_money" && D(q3).sale.payments[0].amount === 800, `${q3.status} ${J(D(q3).sale?.payments)}`);
  check("même référence envoyée deux fois : un seul ticket, le même rendu", q1.status === 201 && q2.status === 200 && D(q2).duplicate === true && D(q2).sale?.number === D(q1).sale?.number && nRef === 1, `${q1.status} ${q2.status} ${nRef}`);

  console.log("\n▶ 10. Inventaire tournant");
  const cc = D(await g.req("GET", `/api/comptoir/cycle-count?deskId=${desk}`));
  check("3 articles à compter aujourd'hui, sans la quantité théorique", cc.items?.length === 3 && cc.items.every(i => i.quantity === undefined), J(cc.items));
  const target = cc.items[0];
  const before = (D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)) ?? []).find(i => i._id === target.itemId);
  const cnt = await cash.req("POST", "/api/comptoir/cycle-count", { deskId: desk, counts: [{ itemId: target.itemId, counted: Math.max(0, before.quantity - 1) }] });
  const after = (D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)) ?? []).find(i => i._id === target.itemId);
  check("comptage : écart −1 enregistré, stock aligné", cnt.status === 201 && D(cnt).results?.[0]?.gap === -1 && after.quantity === before.quantity - 1, `${cnt.status} ${J(D(cnt))}`);
  check("même article recompté le même jour : refusé", (await g.req("POST", "/api/comptoir/cycle-count", { deskId: desk, counts: [{ itemId: target.itemId, counted: 1 }] })).status === 400);

  console.log("\n▶ 5. Objectifs : avancement et alerte");
  const ses = D(await g.req("GET", `/api/comptoir/sessions?deskId=${desk}`));
  check("avancement : jour 3/7, en retard", ses.current?.progress?.elapsedDays === 3 && ses.current.progress.revenue?.behind === true && ses.current.progress.revenue.expected === 42_857, J(ses.current?.progress));
  check("bilan : ardoise, pertes et marge après pertes", ses.current?.report?.creditSales === 2000 && ses.current.report.creditSettled === 2000 && ses.current.report.shrinkage?.total >= 300 && ses.current.report.netMargin === ses.current.report.sales.margin - ses.current.report.shrinkage.total, J({ c: ses.current?.report?.creditSales, s: ses.current?.report?.shrinkage, n: ses.current?.report?.netMargin }));
  await cron("desk-spot");
  check("alerte « objectif en retard » envoyée", (await db(d => d.collection("notifications").countDocuments({ type: "desk_target_behind" }))) > 0);
  await db(d => d.collection("deskcustomers").updateOne({ _id: oid(cust._id) }, { $set: { balance: 3000, oldestDebtAt: new Date(Date.now() - 20 * 86_400_000) } }));
  await cron("desk-spot");
  check("ardoise de plus de 14 jours : relance", (await db(d => d.collection("notifications").countDocuments({ type: "desk_credit_due", linkedId: oid(cust._id) }))) > 0);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
