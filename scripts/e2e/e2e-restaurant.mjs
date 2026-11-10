// Scénario de bout en bout : restauration — réserve et comptoir (réception,
// approvisionnement, pertes, péremption), inventaires au scanner (plusieurs
// appareils, vente pendant le comptage), résultat de gestion du mois (charges,
// personnel, consommation, rapprochement), dossier Excel, clôture qui verrouille.
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const require = createRequire(`${ROOT}/package.json`);
const { Types } = require("mongoose");
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);
const db = fn => withDb(ROOT, fn);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    // Connexion réutilisée fermée par le serveur pendant une tâche longue (ECONNRESET) : une nouvelle tentative.
    const send = () => fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await send().catch(() => send());
    store(res);
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
    return { status: res.status, data };
  }
  return { req, reset: () => { csrf = ""; }, cookie };
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
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const today = localDay(now);
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
const runAt = (job, at) => JSON.parse(execFileSync("npx", ["tsx", "scripts/e2e/run-job-at.ts", job, at], { cwd: ROOT, env: process.env, encoding: "utf8" }).trim().split("\n").pop()).summary;
const notifs = async g => { const r = await g.req("GET", "/api/notifications?limit=100"); return r.data?.data?.items ?? r.data?.data ?? []; };


(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const tenantId = await db(d => d.collection("users").findOne({ email: "admin@test.ne" }).then(u => u.tenantId));
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const sector = D(await g.req("POST", "/api/analytics/activities", { name: "Restaurant E2E" }))._id;
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse restaurant E2E", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Restaurant E2E" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, activityId: sector, revenueAccount: "706300", vatRate: 0 });
  const item = async b => D(await g.req("POST", "/api/comptoir/items", { deskId: desk, ...b }));
  const coca = await item({ name: "Coca 33 cl", unit: "canette", category: "Boissons", quantity: 0, salePrice: 500, threshold: 10, pack: { label: "carton", size: 24, cost: 7200 } });
  const riz = await item({ name: "Riz", unit: "kg", category: "Épicerie", quantity: 0, unitCost: 600 });
  const plat = await item({ name: "Riz au gras", unit: "assiette", category: "Plats", quantity: 0, salePrice: 1000 });
  await g.req("PATCH", `/api/comptoir/items/${plat._id}`, { recipe: [{ itemId: riz._id, quantity: 0.2 }] });
  const levels = async () => D(await g.req("GET", `/api/comptoir/reserve?deskId=${desk}`));
  const row = (lv, id) => lv.rows.find(r => r.itemId === id);

  console.log("\n▶ Réserve et comptoir");
  const rec = await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "receive", supplier: "Grossiste", reference: "BL-1", paidFromCash: true,
    lines: [{ itemId: coca._id, packs: 3, packCost: 7200 }, { itemId: riz._id, quantity: 25, unitCost: 600 }] });
  let lv = await levels();
  check("réception en réserve : 3 cartons = 72 canettes, 25 kg de riz", rec.status === 201 && row(lv, coca._id).reserve === 72 && row(lv, riz._id).reserve === 25 && row(lv, coca._id).desk === 0, `${rec.status} ${J(rec.data).slice(0, 200)}`);
  check("payée depuis la caisse : 36 600 sortis de la caisse du comptoir", D(rec).total === 36_600 && !!(await db(d => d.collection("activitycashentries").findOne({ deskId: new Types.ObjectId(desk), direction: "out", amount: 36_600 }))));
  check("article relié au catalogue automatiquement, réserve créée", row(lv, coca._id).linked && !!lv.reserveId);
  const prod = await db(d => d.collection("activityitems").findOne({ _id: new Types.ObjectId(coca._id) }).then(i => d.collection("products").findOne({ _id: i.productId })));
  check("fiche catalogue créée au taux de TVA du comptoir, suivie par lot, au coût de l'article", prod?.tvaRate === 0 && prod.trackingMode === "lot", J({ tva: prod?.tvaRate, mode: prod?.trackingMode }));
  const dlc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "receive", lines: [{ itemId: riz._id, quantity: 1, unitCost: 600, lotNumber: "SAC-DLC", expiryDate: dlc }] });
  lv = await levels();
  check("date de péremption gardée : alerte à moins de 7 jours", row(lv, riz._id).nextExpiry === dlc && row(lv, riz._id).expiringQty >= 1, J(row(lv, riz._id)));
  const sup = await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "supply", lines: [{ itemId: coca._id, packs: 1 }, { itemId: riz._id, quantity: 5 }] });
  lv = await levels();
  check("comptoir approvisionné depuis la réserve : 24 canettes et 5 kg montés", sup.status === 201 && row(lv, coca._id).desk === 24 && row(lv, coca._id).reserve === 48 && row(lv, riz._id).desk === 5 && row(lv, riz._id).reserve === 21, J(lv.rows.map(r => [r.name, r.reserve, r.desk])));
  const rise = await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "receive", lines: [{ itemId: coca._id, packs: 1, packCost: 8400 }] });
  check("hausse du coût d'achat signalée (+16,7 %)", D(rise).alerts?.[0]?.name === "Coca 33 cl" && D(rise).alerts[0].pct >= 16, J(D(rise)));
  const ret = await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "supply", lines: [{ itemId: coca._id, quantity: 999 }] });
  check("monter plus que la réserve : refusé", ret.status === 400, `${ret.status}`);

  console.log("\n▶ Ventes, inventaires au scanner");
  await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: coca._id, quantity: 20 }, { itemId: plat._id, quantity: 10 }] });
  lv = await levels();
  check("vente : 20 canettes et 2 kg de riz (recette) sortis du comptoir", row(lv, coca._id).desk === 4 && Math.abs(row(lv, riz._id).desk - 3) < 1e-6, J(lv.rows.map(r => [r.name, r.desk])));
  const dishLoss = await g.req("POST", "/api/comptoir/losses", { deskId: desk, itemId: plat._id, quantity: 1, reason: "unsold" });
  lv = await levels();
  check("invendu d'un plat : ses ingrédients sortent du stock (0,2 kg de riz)", dishLoss.status === 201 && Math.abs(row(lv, riz._id).desk - 2.8) < 1e-6, `${dishLoss.status} ${J(dishLoss.data).slice(0, 120)} ${row(lv, riz._id).desk}`);
  check("écart d'inventaire déclaré à la main : refusé", (await g.req("POST", "/api/comptoir/losses", { deskId: desk, itemId: coca._id, quantity: 1, reason: "inventory" })).status === 400);
  await g.req("PATCH", `/api/comptoir/items/${coca._id}`, { barcode: "5449000000996" });
  const dup = await g.req("PATCH", `/api/comptoir/items/${riz._id}`, { barcode: "5449000000996" });
  check("code-barres unique sur le comptoir", dup.status === 400);
  const inv = D(await g.req("POST", "/api/comptoir/inventory", { deskId: desk, level: "desk" }));
  check("inventaire du comptoir ouvert, préparations exclues, code-barres repris", inv.lines?.length === 2 && inv.lines.some(l => l.barcode === "5449000000996") && !inv.lines.some(l => l.name === "Riz au gras"), J(inv.lines));
  check("second inventaire du comptoir ouvert en même temps : refusé", (await g.req("POST", "/api/comptoir/inventory", { deskId: desk, level: "desk" })).status === 400);
  await g.req("PATCH", "/api/comptoir/inventory", { id: inv._id, device: "A", counts: [{ itemId: coca._id, counted: 2 }, { itemId: riz._id, counted: 2.8 }] });
  await g.req("PATCH", "/api/comptoir/inventory", { id: inv._id, device: "B", counts: [{ itemId: coca._id, counted: 1 }] });
  const mid = D(await g.req("GET", `/api/comptoir/inventory?id=${inv._id}`));
  check("deux appareils comptent le même article : leurs comptages s'additionnent", mid.lines?.find(l => l.itemId === coca._id)?.counted === 3, J(mid.lines?.find(l => l.itemId === coca._id)));
  // Vente pendant l'inventaire : elle ne doit pas créer d'écart (théorique relevé au comptage).
  await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: coca._id, quantity: 1 }] });
  const v1 = await g.req("POST", "/api/comptoir/inventory", { id: inv._id, action: "validate" });
  const cocaLine = D(v1).lines?.find(l => l.itemId === coca._id);
  lv = await levels();
  check("validation : manquant d'une canette chiffré au coût, la vente faite pendant le comptage ne compte pas", v1.status === 200 && cocaLine?.gap === -1 && cocaLine.gapValue < 0 && D(v1).status === "validated" && row(lv, coca._id).desk === 2, `${v1.status} ${J(D(v1).lines)} ${row(lv, coca._id).desk}`);
  check("double validation : refusée", (await g.req("POST", "/api/comptoir/inventory", { id: inv._id, action: "validate" })).status === 400);
  check("comptages refusés sur un inventaire clos", (await g.req("PATCH", "/api/comptoir/inventory", { id: inv._id, counts: [{ itemId: coca._id, counted: 9 }] })).status === 400);
  const invR = D(await g.req("POST", "/api/comptoir/inventory", { deskId: desk, level: "reserve" }));
  await g.req("PATCH", "/api/comptoir/inventory", { id: invR._id, counts: [{ itemId: coca._id, counted: 70 }] });
  const v2 = D(await g.req("POST", "/api/comptoir/inventory", { id: invR._id, action: "validate" }));
  lv = await levels();
  check("inventaire de la réserve : 72 attendus, 70 comptés, réserve ramenée à 70", v2.lines?.find(l => l.itemId === coca._id)?.gap === -2 && row(lv, coca._id).reserve === 70, J(v2.lines?.find(l => l.itemId === coca._id)));
  const rl0 = await g.req("POST", "/api/comptoir/reserve", { deskId: desk, action: "loss", reason: "broken", lines: [{ itemId: coca._id, quantity: 2 }] });
  lv = await levels();
  check("perte en réserve : 2 canettes sorties de la réserve", rl0.status === 201 && row(lv, coca._id).reserve === 68, `${rl0.status} ${J(rl0.data).slice(0, 120)}`);

  console.log("\n▶ Charges et résultat du mois");
  const other = await g.req("POST", "/api/comptoir/desks", { name: "Bar E2E" });
  check("un secteur par comptoir : le même secteur sur un second comptoir est refusé", (await g.req("PATCH", `/api/comptoir/desks/${D(other)._id}`, { activityId: sector })).status === 400);
  await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "in", amount: 5_000, label: "Remboursement avance E2E", category: "non_sale" });
  const ns = await db(d => d.collection("accountingentries").findOne({ tenantId, label: /Remboursement avance E2E/ }));
  check("entrée de caisse hors vente : compte d'attente, sans chiffre d'affaires ni TVA", ns?.lines.some(l => l.accountCode === "471000" && l.credit === 5_000) && !ns.lines.some(l => /^70|^443/.test(l.accountCode)), J(ns?.lines));
  const elec = await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "out", amount: 30_000, label: "Facture NIGELEC", category: "electricity" });
  const e = await db(d => d.collection("accountingentries").findOne({ tenantId, "lines.accountCode": "605200", label: /NIGELEC/ }));
  check("dépense d'électricité : 605200, imputée au secteur du comptoir", elec.status === 201 && e?.lines.some(l => l.accountCode === "605200" && l.debit === 30_000 && String(l.activityId) === String(sector)), J(e?.lines));
  const emp = await db(d => d.collection("employees").insertOne({ tenantId, firstName: "Awa", lastName: "Cuisine", isActive: true, createdAt: new Date(), updatedAt: new Date() }));
  await db(d => d.collection("payslips").insertOne({ tenantId, employeeId: emp.insertedId, month: now.getMonth() + 1, year: now.getFullYear(), grossSalary: 100_000, grossTotal: 100_000, cnssEmployee: 5_250, cnssEmployer: 16_400, netSalary: 90_000, employerCost: 120_000, createdAt: new Date(), updatedAt: new Date() }));
  const cfg = await g.req("PATCH", `/api/comptoir/desks/${desk}`, { staff: [{ employeeId: String(emp.insertedId), share: 0.5 }], plannedCosts: [{ category: "electricite", amount: 25_000 }, { category: "loyer", amount: 50_000 }], openDaysPerMonth: 25 });
  check("personnel affecté (mi-temps) et charges prévues enregistrés", cfg.status === 200, `${cfg.status} ${J(cfg.data).slice(0, 160)}`);
  const r = D(await g.req("GET", `/api/comptoir/result?deskId=${desk}&month=${month}&trend=1`));
  const ch = c => r.pnl?.charges.find(x => x.category === c);
  check("CA HT du mois : 21 canettes à 500 + 10 plats à 1 000 = 20 500", r.pnl?.revenueHT === 20_500 && r.sales.tickets === 2, J(r.pnl && { ca: r.pnl.revenueHT, t: r.sales }));
  check("coût des ventes au coût de revient (canettes et riz de la recette)", r.pnl.costOfSales > 0 && r.pnl.grossMargin === r.pnl.valuedRevenueHT - r.pnl.costOfSales - r.pnl.cashPurchases, J({ cogs: r.pnl.costOfSales, v: r.pnl.valuedRevenueHT }));
  check("consommation théorique et réelle : le riz du plat invendu compte en pertes", r.consumption?.some(c => c.name === "Riz" && c.losses >= 0.2), J(r.consumption));
  check("rapprochement : CA comptable du secteur repris", r.reconciliation?.accountingRevenue >= 20_500, J(r.reconciliation));
  const near = (a, b) => Math.abs(a - b) <= 1;
  const declared = r.lossesByReason.filter(l => !["inventory", "staff", "offered"].includes(l.reason)).reduce((t, l) => t + l.value, 0);
  check("écarts d'inventaire des deux niveaux comptés une fois, hors pertes déclarées", r.inventories.length === 2 && near(r.pnl.inventoryGap, -938) && near(r.pnl.losses, declared) && near(r.pnl.losses, 745), J({ gap: r.pnl.inventoryGap, losses: r.pnl.losses, declared, by: r.lossesByReason }));
  check("charges : électricité 30 000 (prévu 25 000), personnel 60 000 (mi-temps de 120 000)", ch("electricite")?.actual === 30_000 && ch("electricite").planned === 25_000 && ch("personnel")?.actual === 60_000 && r.staffDetail[0]?.allocated === 60_000, J(r.pnl.charges));
  check("coût des ventes au CMUP (canettes à 312,50 après la hausse, riz de la recette) : 7 763", near(r.pnl.costOfSales, 7_763), J({ cogs: r.pnl.costOfSales }));
  // Toutes les réceptions valorisées (au comptant 36 600 et à crédit) passent en 601 et se rapprochent des entrées en stock.
  check("achats payés en caisse : au rapprochement (601 du secteur, égal aux entrées valorisées), pas en charges ni en achats de caisse hors réception", r.reconciliation.accountingPurchases === r.reconciliation.stockEntriesValued && r.reconciliation.accountingPurchases >= 36_600 && r.pnl.cashPurchases === 0 && !r.chargesDetail.some(c => /^60[123]/.test(c.accountCode)), J({ rec: r.reconciliation, cash: r.pnl.cashPurchases }));
  check("résultat = marge matière − charges ; point mort par jour calculé", r.pnl.result === r.pnl.materialMargin - r.pnl.totalCharges && r.pnl.ratios.breakEvenPerDay > 0, J({ res: r.pnl.result, mm: r.pnl.materialMargin, c: r.pnl.totalCharges, be: r.pnl.ratios }));
  check("douze mois de tendance et analyse de la carte", r.trend?.length === 12 && r.menu?.length >= 1, J({ t: r.trend?.length, m: r.menu }));
  const all = D(await g.req("GET", `/api/comptoir/result?all=1&month=${month}`));
  check("vue de tous les comptoirs : le restaurant y figure, totaux cohérents", all.rows?.some(x => x.deskId === desk && x.result === r.pnl.result) && all.totals.revenueHT >= 20_000, J(all.totals));
  const x = await fetch(`${BASE}/api/comptoir/result?deskId=${desk}&month=${month}&format=xlsx`, { headers: { cookie: g.cookie() } });
  check("dossier Excel du mois", x.status === 200 && /spreadsheetml/.test(x.headers.get("content-type") ?? ""), `${x.status}`);
  check("clôture du mois en cours : refusée", (await g.req("POST", "/api/comptoir/result", { deskId: desk, month, action: "close" })).status === 400);
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12), prev = `${pm.getFullYear()}-${pad(pm.getMonth() + 1)}`;
  const c0 = await g.req("POST", "/api/comptoir/result", { deskId: desk, month: prev, action: "close" });
  check("clôture d'un mois aux préalables non remplis (paie manquante) : refusée sans motif", c0.status === 400 && /Préalables/.test(c0.data?.error ?? ""), `${c0.status} ${J(c0.data)}`);
  const c1 = await g.req("POST", "/api/comptoir/result", { deskId: desk, month: prev, action: "close", force: true, note: "Paie du mois passée hors Kanoo" });
  const late = await g.req("POST", "/api/comptoir/sales", { deskId: desk, date: pm.toISOString(), lines: [{ itemId: coca._id, quantity: 1 }] });
  check("mois clos : une vente datée de ce mois est refusée", c1.status === 200 && late.status === 400 && /clos/.test(late.data?.error ?? ""), `${c1.status} ${late.status} ${J(late.data)}`);
  check("réouverture sans motif : refusée", (await g.req("POST", "/api/comptoir/result", { deskId: desk, month: prev, action: "reopen" })).status === 400);
  const ro2 = await g.req("POST", "/api/comptoir/result", { deskId: desk, month: prev, action: "reopen", reason: "Facture fournisseur arrivée en retard" });
  const hist = await db(d => d.collection("deskmonthcloses").findOne({ deskId: new Types.ObjectId(desk), month: prev }));
  check("réouverture motivée : clôture gardée dans l'historique", ro2.status === 200 && hist?.status === "reopened" && hist.history?.length === 1, J(hist && { s: hist.status, h: hist.history?.length }));
  const ro = D(await g.req("GET", `/api/comptoir/reorder?deskId=${desk}`));
  const rl = (ro.lines ?? []).find(l => l.itemId === coca._id);
  check("réassort fournisseur : la réserve compte dans le stock disponible", rl && rl.stock === row(lv, coca._id).desk + row(lv, coca._id).reserve && rl.reserve === row(lv, coca._id).reserve, J(rl));
  const sum = D(await g.req("GET", `/api/comptoir/summary?deskId=${desk}`));
  check("valeur du stock du comptoir : réserve comprise", sum.stockValue > row(lv, coca._id).desk * 300, J({ v: sum.stockValue }));

  console.log(`\n${pass} réussis, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
