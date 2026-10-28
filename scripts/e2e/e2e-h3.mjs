// Scénario de bout en bout : lot H3 — tickets du comptoir (coût figé, moyens de
// paiement, TVA par article, timbre), annulation, arrêté de caisse enregistré,
// marges par produit, frais d'approche, inventaire par écart, avoir avec
// retour en stock, coûts masqués aux caissiers (docs/AUDIT-2026-10.md §2).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const PW = `Kz-${randomBytes(12).toString("base64url")}!9q`;
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
const entriesOf = filter => db(d => d.collection("accountingentries").find(filter).toArray());
const balanced = e => e && e.lines.reduce((t, l) => t + l.debit - l.credit, 0) === 0;

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const local = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = local();
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse H3", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const mm = D(await g.req("POST", "/api/treasury-accounts", { label: "Mobile money H3", type: "mobile_money", openingBalance: 0, openingDate: "2025-01-01" }))._id;

  console.log("\n▶ Réception : bon de réception et frais d'approche dans le CMUP");
  const sup = D(await g.req("POST", "/api/suppliers", { code: "F-H3", name: "Grossiste H3" }));
  const soda = D(await g.req("POST", "/api/products", { code: "H3-SODA", label: "Soda H3", unitPrice: 1000, tvaRate: 0.19, category: "Boissons" }));
  const eau = D(await g.req("POST", "/api/products", { code: "H3-EAU", label: "Eau H3", unitPrice: 500, tvaRate: 0.19, category: "Boissons", initialQty: 20, initialCost: 0 }));
  const bc = D(await g.req("POST", "/api/commandes", { supplierId: sup._id, orderDate: today, lines: [{ productId: soda._id, description: "Soda H3", quantity: 20, unitPrice: 500 }] }));
  await g.req("PATCH", `/api/commandes/${bc._id}`, { status: "confirmed" });
  const rc = await g.req("POST", `/api/commandes/${bc._id}/receive`, { all: true, landedCosts: 2000 });
  const sodaP = D(await g.req("GET", `/api/products/${soda._id}`));
  const br = await db(d => d.collection("goodsreceipts").findOne({ commandeId: new ObjectId(String(bc._id)) }));
  check("réception : CMUP = 500 + 2 000 / 20 = 600", rc.status === 200 && (sodaP.purchaseCost ?? sodaP.product?.purchaseCost) === 600, `${rc.status} ${J(sodaP).slice(0, 160)}`);
  check("bon de réception créé (quantité, coût rendu)", br && br.lines[0]?.receivedQty === 20 && br.lines[0]?.unitPrice === 600 && /^BR-/.test(br.number), J(br));

  console.log("\n▶ Comptoir relié, approvisionné");
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Spot H3" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0.19 });
  const itSoda = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, productId: soda._id, salePrice: 1190 }));
  const itEau = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, productId: eau._id, salePrice: 595 }));
  const itGlace = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Glaçons", unit: "sachet", quantity: 50, unitCost: 20, salePrice: 100 }));
  const princ = D(await g.req("GET", "/api/warehouses")).find(w => w.code === "PRINC");
  const sp = await g.req("POST", "/api/comptoir/supply", { deskId: desk, fromWarehouseId: princ._id, lines: [{ itemId: itSoda._id, quantity: 10 }, { itemId: itEau._id, quantity: 12 }] });
  check("approvisionnement du comptoir", sp.status === 200 || sp.status === 201, `${sp.status} ${J(sp.data).slice(0, 150)}`);

  console.log("\n▶ Ticket multi-articles, paiement mixte");
  const t1r = await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itSoda._id, quantity: 3 }, { itemId: itGlace._id, quantity: 2 }], payments: [{ method: "cash", amount: 3000 }, { method: "orange_money", amount: 770 }], cashGiven: 5000 });
  const t1 = D(t1r).sale;
  check("ticket numéroté TK, total 3 770, monnaie rendue 2 000", t1r.status === 201 && /^TK/.test(t1?.number) && t1.totalTTC === 3770 && t1.changeGiven === 2000, `${t1r.status} ${J(t1r.data).slice(0, 200)}`);
  const lS = t1?.lines?.[0], lG = t1?.lines?.[1];
  check("ligne catalogue : HT 3 000, coût figé 600 × 3, marge 1 200", lS?.totalHT === 3000 && lS?.unitCost === 600 && lS?.costTotal === 1800 && lS?.marginHT === 1200, J(lS));
  check("article propre : HT 168, coût 40, marge 128", lG?.totalHT === 168 && lG?.costTotal === 40 && lG?.marginHT === 128, J(lG));
  const e1 = (await entriesOf({ linkedDocType: "comptoir_sale", linkedDocId: new ObjectId(String(t1._id)) }))[0];
  check("écriture : espèces sur la caisse, mobile money sur son compte, 706300 3 168, TVA 602", balanced(e1)
    && e1.lines.some(l => /^571/.test(l.accountCode) && l.debit === 3000) && e1.lines.some(l => /^5218/.test(l.accountCode) && l.debit === 770)
    && e1.lines.some(l => l.accountCode === "706300" && l.credit === 3168) && e1.lines.some(l => l.accountCode === "443000" && l.credit === 602)
    && !e1.lines.some(l => l.accountCode === "646200"), J(e1?.lines));
  const tm1 = await db(d => d.collection("treasurymovements").find({ linkedDocType: "comptoir_sale", linkedDocId: new ObjectId(String(t1._id)) }).toArray());
  check("trésorerie : 3 000 en caisse, 770 en mobile money", tm1.length === 2 && tm1.some(m => String(m.accountId) === caisse && m.amount === 3000) && tm1.some(m => String(m.accountId) === mm && m.amount === 770), J(tm1.map(m => [String(m.accountId), m.amount])));
  const cash1 = D(await g.req("GET", `/api/comptoir/cash?deskId=${desk}&from=${today}&to=${today}`));
  check("caisse du comptoir : un encaissement par moyen, rattaché au ticket", cash1.items?.filter(e => e.saleId === t1._id).length === 2, J(cash1.items?.map(e => [e.method, e.amount])));
  const items1 = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`));
  check("stock : soda 10 → 7, glaçons 50 → 48", items1.find(i => i._id === itSoda._id)?.quantity === 7 && items1.find(i => i._id === itGlace._id)?.quantity === 48, J(items1.map(i => [i.name, i.quantity])));

  console.log("\n▶ Contrôles du ticket");
  check("paiements ≠ total : refusé", (await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itSoda._id, quantity: 1 }], payments: [{ method: "cash", amount: 100 }] })).status === 400);
  check("stock insuffisant : refusé", (await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itSoda._id, quantity: 100 }] })).status === 400);
  const del = await g.req("DELETE", `/api/comptoir/cash/${cash1.items.find(e => e.saleId === t1._id)._id}`);
  check("encaissement d'un ticket : non supprimable seul", del.status === 400, del.status);

  console.log("\n▶ Article sans coût, timbre-quittance, vente à perte");
  const t2r = await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itEau._id, quantity: 10 }] });
  const t2 = D(t2r).sale;
  const e2 = (await entriesOf({ linkedDocType: "comptoir_sale", linkedDocId: new ObjectId(String(t2?._id)) }))[0];
  check("eau sans coût : marge non calculée, avertissement", t2?.lines?.[0]?.marginHT === null && (D(t2r).warnings ?? []).some(w => /sans coût/.test(w)), J(D(t2r)).slice(0, 200));
  check("5 950 en espèces : timbre-quittance 200 (646200 / 447000)", balanced(e2) && e2.lines.some(l => l.accountCode === "646200" && l.debit === 200) && e2.lines.some(l => l.accountCode === "447000" && l.credit === 200), J(e2?.lines));
  const t3r = await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itSoda._id, quantity: 1, unitPriceTTC: 595 }] });
  const t3 = D(t3r).sale;
  const notif = await db(d => d.collection("notifications").findOne({ title: "Comptoir : vente sous le coût" }));
  check("vente sous le coût : marge −100, alerte envoyée", t3?.lines?.[0]?.marginHT === -100 && !!notif, J(t3?.lines?.[0]));

  console.log("\n▶ Marges par produit");
  const mg = D(await g.req("GET", `/api/reports/margins?from=${today}&to=${today}&source=comptoir`));
  const rs = mg.rows?.find(r => r.label === "Soda H3"), re = mg.rows?.find(r => r.label === "Eau H3");
  check("soda : 4 vendus, CA HT 3 500, coût 2 400, marge 1 100", rs?.quantity === 4 && rs?.revenueHT === 3500 && rs?.costTotal === 2400 && rs?.marginHT === 1100, J(rs));
  check("taux de marque 31,4 %, taux de marge 45,8 %", rs?.markupRate === 31.4 && rs?.marginRate === 45.8, J([rs?.markupRate, rs?.marginRate]));
  check("eau : non valorisée, exclue des taux", re?.unvaluedRevenueHT === 5000 && re?.revenueHT === 0 && mg.unvalued?.some(u => u.label === "Eau H3"), J(re));
  const mgCat = D(await g.req("GET", `/api/reports/margins?from=${today}&to=${today}&source=comptoir&groupBy=category`));
  check("regroupement par catégorie", mgCat.rows?.some(r => r.label === "Boissons"), J(mgCat.rows?.map(r => r.label)));

  console.log("\n▶ Annulation d'un ticket");
  const cx = await g.req("POST", `/api/comptoir/sales/${t3._id}/cancel`, { reason: "Erreur de prix" });
  const items2 = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`));
  const ext = await entriesOf({ linkedDocType: "reversal", reverses: new ObjectId(String((await db(d => d.collection("comptoirsales").findOne({ _id: new ObjectId(String(t3._id)) }))).entryId)) });
  check("annulé : stock rendu (soda 6 → 7), écriture extournée, encaissement retiré", cx.status === 200 && items2.find(i => i._id === itSoda._id)?.quantity === 7 && ext.length === 1
    && !(D(await g.req("GET", `/api/comptoir/cash?deskId=${desk}&from=${today}&to=${today}`)).items ?? []).some(e => e.saleId === t3._id), `${cx.status} ${J(items2.map(i => [i.name, i.quantity]))} ${ext.length}`);
  check("déjà annulé : refusé", (await g.req("POST", `/api/comptoir/sales/${t3._id}/cancel`, { reason: "bis" })).status === 400);

  console.log("\n▶ Coûts masqués au personnel du comptoir");
  // Caissier : employé du service The Spot, affecté à ce comptoir.
  await g.req("POST", "/api/users", { email: "spot.h3@test.ne", password: PW, firstName: "Caissier", lastName: "H3", roles: ["svc_spot"], roleLevels: { svc_spot: "employe" }, siteIds: [desk] });
  const { s: c } = await login("spot.h3@test.ne", PW);
  const cItems = D(await c.req("GET", `/api/comptoir/items?deskId=${desk}`));
  const cSales = D(await c.req("GET", `/api/comptoir/sales?deskId=${desk}&from=${today}&to=${today}`));
  const cSum = D(await c.req("GET", `/api/comptoir/summary?deskId=${desk}`));
  check("caissier : coût unitaire, valeur du stock et marges masqués", cItems.length > 0 && cItems.every(i => i.unitCost === null) && cSum.stockValue === null
    && cSales.showCosts === false && cSales.items?.every(s => s.marginHT === undefined && s.lines.every(l => l.unitCost === undefined)), J({ i: cItems[0]?.unitCost, v: cSum.stockValue, s: cSales.items?.[0]?.marginHT }));
  check("caissier : rapport des marges refusé", (await c.req("GET", "/api/reports/margins")).status === 403);
  const cT = await c.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itGlace._id, quantity: 1 }] });
  check("caissier : encaisse un ticket, sans les coûts dans la réponse", cT.status === 201 && D(cT).sale?.lines?.[0]?.unitCost === undefined, `${cT.status} ${J(cT.data).slice(0, 150)}`);

  console.log("\n▶ Arrêté de caisse enregistré");
  const fig = D(await g.req("GET", `/api/comptoir/closings?deskId=${desk}&day=${today}`)).day;
  check("théorique espèces de la journée = 3 000 + 5 950 + 100", fig?.cashNet === 9050, J(fig));
  const cl = await g.req("POST", "/api/comptoir/closings", { deskId: desk, day: today, countedCash: 9000, openingFloat: 0 });
  const gapE = (await entriesOf({ linkedDocType: "cash_closing", linkedDocId: new ObjectId(String(D(cl)._id)) }))[0];
  check("arrêté : manquant de 50 passé en 658100 contre la caisse", cl.status === 201 && D(cl).gap === -50 && balanced(gapE)
    && gapE.lines.some(l => l.accountCode === "658100" && l.debit === 50) && gapE.lines.some(l => /^571/.test(l.accountCode) && l.credit === 50), `${cl.status} ${J(cl.data).slice(0, 150)} ${J(gapE?.lines)}`);
  check("journée arrêtée : nouveau ticket refusé", (await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: itGlace._id, quantity: 1 }] })).status === 400);
  check("journée arrêtée : écriture de caisse refusée", (await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "out", amount: 100, label: "Après arrêté" })).status === 400);
  check("journée arrêtée : annulation de ticket refusée", (await g.req("POST", `/api/comptoir/sales/${t1._id}/cancel`, { reason: "trop tard" })).status === 400);
  check("deuxième arrêté du même jour : refusé", (await g.req("POST", "/api/comptoir/closings", { deskId: desk, day: today, countedCash: 9069 })).status === 400);

  console.log("\n▶ Dépense de caisse sans TVA déductible");
  const desk2 = D(await g.req("POST", "/api/comptoir/desks", { name: "Spot H3 bis" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk2}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0.19 });
  await g.req("POST", "/api/comptoir/cash", { deskId: desk2, direction: "out", amount: 1190, label: "Achat glace H3" });
  const spend = (await entriesOf({ label: /Achat glace H3/ }))[0];
  check("dépense : 601100 1 190, pas de 445200", spend && spend.lines.some(l => l.accountCode === "601100" && l.debit === 1190) && !spend.lines.some(l => l.accountCode === "445200"), J(spend?.lines));

  console.log("\n▶ Inventaire : l'écart s'applique, pas le comptage");
  const inv = D(await g.req("POST", "/api/inventaires", { label: "Inventaire H3", warehouseId: princ._id, blind: false }));
  const det = D(await g.req("GET", `/api/inventaires/${inv._id}`));
  const lS2 = det.lines?.find(l => String(l.productId?._id ?? l.productId) === soda._id);
  // Théorique au magasin : 20 reçus − 10 envoyés au comptoir = 10 ; on compte 9.
  await g.req("PATCH", `/api/inventaires/${inv._id}`, { lineId: lS2?._id, countedQty: lS2?.theoreticalQty - 1, reason: "Casse" });
  for (const l of det.lines ?? []) if (l._id !== lS2?._id) await g.req("PATCH", `/api/inventaires/${inv._id}`, { lineId: l._id, countedQty: l.theoreticalQty });
  // Vente pendant le comptage : 2 sodas livrés au client.
  const cli = D(await g.req("POST", "/api/clients", { code: "H3-CLI", name: "Client H3", type: "company" }));
  const fa = D(await g.req("POST", "/api/invoices", { clientId: cli._id, issueDate: today, dueDate: today, lines: [{ productId: soda._id, description: "Soda H3", quantity: 2, unitPrice: 1000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${fa._id}/send`);
  const bl = await g.req("POST", "/api/livraisons", { invoiceId: fa._id, deliveryDate: today, warehouseId: princ._id, lines: [{ invoiceLineIndex: 0, productId: soda._id, description: "Soda H3", quantity: 2 }] });
  await g.req("PATCH", `/api/inventaires/${inv._id}`, { status: "review" });
  await g.req("PATCH", `/api/inventaires/${inv._id}`, { lineId: lS2?._id, recountQty: lS2?.theoreticalQty - 1, reason: "Recompté : une bouteille cassée" });
  const val = await g.req("PATCH", `/api/inventaires/${inv._id}`, { status: "validated" });
  if (val.status !== 200) console.log("   validation :", val.status, J(val.data));
  const stk = D(await g.req("GET", `/api/products/${soda._id}/stock`));
  const atPrinc = (stk.byWarehouse ?? stk.warehouses ?? []).find(w => String(w.warehouseId?._id ?? w.warehouseId ?? w._id) === princ._id);
  check("magasin : 10 − 2 livrés − 1 cassé = 7 (la vente du comptage n'est pas effacée)", bl.status === 201 && val.status === 200 && (atPrinc?.qty ?? atPrinc?.quantity) === 7, `${bl.status} ${val.status} ${J(stk).slice(0, 220)}`);
  const invE = (await entriesOf({ reference: inv.reference ?? det.reference, journalCode: "OD" }))[0];
  check("écart d'inventaire passé en 6031 (variation de stock), plus en 659", invE && invE.lines.some(l => l.accountCode === "603100" && l.debit === 600) && !invE.lines.some(l => /^659|^759/.test(l.accountCode)), J(invE?.lines));

  console.log("\n▶ Marge des factures livrées, avoir avec retour en stock");
  const mgF = D(await g.req("GET", `/api/reports/margins?from=${today}&to=${today}&source=invoices`));
  const fS = mgF.rows?.find(r => r.label === "Soda H3");
  check("facture livrée : coût réel de la sortie (2 × 600), marge 800", fS?.revenueHT === 2000 && fS?.costTotal === 1200 && fS?.marginHT === 800, J(fS));
  const av = await g.req("POST", `/api/invoices/${fa._id}/credit-note`, { mode: "full", reason: "Retour client" });
  const stk2 = D(await g.req("GET", `/api/products/${soda._id}/stock`));
  const atPrinc2 = (stk2.byWarehouse ?? stk2.warehouses ?? []).find(w => String(w.warehouseId?._id ?? w.warehouseId ?? w._id) === princ._id);
  check("avoir total : les 2 sodas reviennent au magasin (7 → 9)", av.status === 201 && (atPrinc2?.qty ?? atPrinc2?.quantity) === 9, `${av.status} ${J(atPrinc2)}`);
  const mgF2 = D(await g.req("GET", `/api/reports/margins?from=${today}&to=${today}&source=invoices`));
  check("après avoir : marge des factures ramenée à 0", (mgF2.rows?.find(r => r.label === "Soda H3")?.marginHT ?? 0) === 0, J(mgF2.rows));

  console.log("\n▶ Analytique : comptoir relié compté une seule fois, marge HT");
  const an = D(await g.req("GET", `/api/reports/analytics?months=1`));
  check("série « marge sur achats HT » présente", Array.isArray(an.series?.margeBrute?.data) && /HT/.test(an.series?.margeBrute?.label ?? ""), J(an.series?.margeBrute));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
