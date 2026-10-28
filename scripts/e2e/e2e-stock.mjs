// Scénario de bout en bout : organisation cloisonnée (services × niveaux).
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

const id = r => D(r)?._id;

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const plus = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const byWh = async pid => Object.fromEntries((D(await g.req("GET", `/api/products/${pid}/stock`)).warehouses ?? []).map(w => [w.warehouseId?.code, w.qty]));
  const prodQty = async pid => D(await g.req("GET", `/api/products/${pid}`)).stockQty;

  console.log("\n▶ Reprise de l'ancien stock global");
  await withDb(ROOT, async db => {
    const admin = await db.collection("users").findOne({ email: "admin@test.ne" });
    await db.collection("products").insertOne({ tenantId: admin.tenantId, code: "LEGACY", label: "Ancien article", unitPrice: 1000, tvaRate: 0.19, unit: "u", stockQty: 7, stockMinAlert: 0, isService: false, isActive: true, purchaseCost: 500 });
  });
  const legacy = (D(await g.req("GET", "/api/products?search=LEGACY")).items ?? [])[0];
  const lw = await byWh(legacy._id);
  check("ancien stock rangé dans le magasin principal", lw.PRINC === 7, J(lw));

  console.log("\n▶ Entrepôts et transferts");
  const whs = D(await g.req("GET", "/api/warehouses"));
  const princ = whs.find(w => w.code === "PRINC");
  const dep = id(await g.req("POST", "/api/warehouses", { code: "DEP-MRD", name: "Dépôt Maradi", kind: "depot" }));
  check("entrepôt créé ; code en double refusé", !!dep && (await g.req("POST", "/api/warehouses", { code: "DEP-MRD", name: "x" })).status === 409);
  const p1 = D(await g.req("POST", "/api/products", { code: "CAB-01", label: "Câble HDMI", unitPrice: 5000, initialQty: 10, initialCost: 2000 }));
  const t1 = await g.req("POST", "/api/stock/transfers", { fromWarehouseId: princ._id, toWarehouseId: dep, lines: [{ productId: p1._id, quantity: 4 }] });
  let w1 = await byWh(p1._id);
  check("transfert : 6 au principal, 4 au dépôt, total inchangé", t1.status === 201 && w1.PRINC === 6 && w1["DEP-MRD"] === 4 && (await prodQty(p1._id)) === 10, `${t1.status} ${J(w1)} ${J(t1.data).slice(0, 150)}`);
  check("sortie du dépôt au-delà de son stock : refusée", (await g.req("POST", "/api/stock/movements", { productId: p1._id, type: "exit", quantity: 5, warehouseId: dep, reason: "Vente" })).status === 400);
  const ex1 = await g.req("POST", "/api/stock/movements", { productId: p1._id, type: "exit", quantity: 3, warehouseId: dep, reason: "Vente Maradi" });
  w1 = await byWh(p1._id);
  check("sortie depuis le dépôt : dépôt 1, total 7", ex1.status === 201 && w1["DEP-MRD"] === 1 && (await prodQty(p1._id)) === 7, J(w1));
  const trMove = (D(await g.req("GET", `/api/stock/movements?productId=${p1._id}&type=transfer`)).items ?? [])[0];
  const rv = await g.req("DELETE", `/api/stock/movements/${trMove._id}?reason=erreur`);
  check("annulation d'un transfert : refusée si le dépôt n'a plus le stock", rv.status === 400, `${rv.status} ${J(rv.data)}`);
  const wl = D(await g.req("GET", `/api/stock?warehouseId=${dep}`)).items ?? [];
  check("vue du stock par entrepôt", wl.some(x => x._id === p1._id && x.stockQty === 1 && x.totalQty === 7), J(wl.map(x => [x.code, x.stockQty, x.totalQty])));
  const th = await g.req("PATCH", `/api/products/${p1._id}/stock`, { warehouseId: dep, minAlert: 2 });
  const wl2 = D(await g.req("GET", `/api/stock?warehouseId=${dep}`)).items ?? [];
  check("seuil propre au dépôt : alerte à 1 ≤ 2", th.status === 200 && wl2.find(x => x._id === p1._id)?.isAlert === true, `${th.status} ${J(wl2.map(x => [x.code, x.stockQty, x.stockMinAlert, x.isAlert]))}`);
  check("entrepôt avec stock : désactivation refusée", (await g.req("PATCH", `/api/warehouses/${dep}`, { isActive: false })).status === 400);

  console.log("\n▶ Lots (FEFO) et numéros de série");
  const p2 = D(await g.req("POST", "/api/products", { code: "LAIT-01", label: "Lait UHT", unitPrice: 800, trackingMode: "lot" }));
  check("entrée sans lot sur un article suivi : refusée", (await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "entry", quantity: 10, reason: "Achat" })).status === 400);
  const e2 = await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "entry", quantity: 10, unitCost: 500, reason: "Achat", lots: [{ lotNumber: "L-B", expiryDate: plus(60), qty: 6 }, { lotNumber: "L-A", expiryDate: plus(10), qty: 4 }] });
  check("entrée en deux lots", e2.status === 201, J(e2.data).slice(0, 150));
  const x2 = await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "exit", quantity: 5, reason: "Vente" });
  const lots2 = Object.fromEntries((D(await g.req("GET", `/api/products/${p2._id}/stock`)).lots ?? []).map(l => [l.lotNumber, l.qty]));
  check("sortie FEFO : le lot qui périme le plus tôt part d'abord (A 0, B 5)", x2.status === 201 && !lots2["L-A"] && lots2["L-B"] === 5, J(lots2));
  const mvLots = (D(await g.req("GET", `/api/stock/movements?productId=${p2._id}&type=exit`)).items ?? [])[0]?.lots ?? [];
  check("mouvement : lots touchés tracés", mvLots.some(l => l.lotNumber === "L-A" && l.qty === -4) && mvLots.some(l => l.lotNumber === "L-B" && l.qty === -1), J(mvLots));
  await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "entry", quantity: 2, reason: "Retour ancien", lots: [{ lotNumber: "L-OLD", expiryDate: plus(-3), qty: 2 }] });
  const exp = D(await g.req("GET", "/api/stock/lots?days=30"));
  check("péremptions : lot périmé signalé", exp.expired?.some(l => l.lotNumber === "L-OLD"), J(exp.expired?.map(l => l.lotNumber)));
  const sellAll = await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "exit", quantity: 6, reason: "Vente" });
  check("vente automatique : le lot périmé n'est jamais pris", sellAll.status === 400 && /périmé/.test(sellAll.data?.error ?? ""), `${sellAll.status} ${J(sellAll.data)}`);
  const sellOld = await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "exit", quantity: 1, reason: "Vente", lots: [{ lotNumber: "L-OLD", qty: 1 }] });
  check("vente d'un lot périmé désigné : refusée", sellOld.status === 400, `${sellOld.status}`);
  const loss = await g.req("POST", "/api/stock/movements", { productId: p2._id, type: "loss", quantity: 2, reason: "Périmé", lots: [{ lotNumber: "L-OLD", qty: 2 }] });
  check("sortie du lot périmé (perte ciblée)", loss.status === 201, J(loss.data).slice(0, 120));
  const p3 = D(await g.req("POST", "/api/products", { code: "PC-01", label: "Ordinateur portable", unitPrice: 450000, trackingMode: "serial", initialQty: 2, initialCost: 350000, initialLots: [{ lotNumber: "SN-001", qty: 1 }, { lotNumber: "SN-002", qty: 1 }] }));
  check("article par numéro de série créé avec 2 numéros", p3?.stockQty === 2, J(p3).slice(0, 150));
  check("numéro de série déjà en stock : refusé", (await g.req("POST", "/api/stock/movements", { productId: p3._id, type: "entry", quantity: 1, reason: "x", lots: [{ lotNumber: "SN-001", qty: 1 }] })).status === 400);
  const sx = await g.req("POST", "/api/stock/movements", { productId: p3._id, type: "exit", quantity: 1, reason: "Vente", lots: [{ lotNumber: "SN-002", qty: 1 }] });
  const lots3 = (D(await g.req("GET", `/api/products/${p3._id}/stock`)).lots ?? []).map(l => l.lotNumber);
  check("sortie d'un numéro précis", sx.status === 201 && lots3.join() === "SN-001", J(lots3));
  const tr2 = await g.req("POST", "/api/stock/transfers", { fromWarehouseId: princ._id, toWarehouseId: dep, lines: [{ productId: p2._id, quantity: 3 }] });
  const lotsDep = (D(await g.req("GET", `/api/products/${p2._id}/stock`)).lots ?? []).filter(l => l.warehouseId?._id === dep);
  check("transfert d'un article suivi : le lot et sa péremption suivent", tr2.status === 201 && lotsDep.some(l => l.lotNumber === "L-B" && l.qty === 3 && l.expiryDate), J(lotsDep));

  console.log("\n▶ Réception de commande dans un entrepôt, avec lots");
  const sup = (D(await g.req("GET", "/api/suppliers?limit=1")).items ?? [])[0] ?? D(await g.req("POST", "/api/suppliers", { code: "F1", name: "Fournisseur" }));
  const bc = D(await g.req("POST", "/api/commandes", { supplierId: sup._id, orderDate: plus(0), lines: [{ productId: p2._id, quantity: 12, unitPrice: 520 }] }));
  await g.req("PATCH", `/api/commandes/${bc._id}`, { status: "confirmed" });
  const rc = await g.req("POST", `/api/commandes/${bc._id}/receive`, { warehouseId: dep, lines: [{ index: 0, quantity: 12, lots: [{ lotNumber: "L-C", expiryDate: plus(90), qty: 12 }] }] });
  const d2 = await byWh(p2._id);
  check("réception au dépôt, lot L-C", rc.status === 200 && d2["DEP-MRD"] === 15, `${rc.status} ${J(d2)} ${J(rc.data).slice(0, 120)}`);

  console.log("\n▶ Inventaire d'un entrepôt, par lot");
  const inv = await g.req("POST", "/api/inventaires", { label: "Inventaire Maradi", warehouseId: dep, blind: false });
  const invId = D(inv)._id;
  const det = D(await g.req("GET", `/api/inventaires/${invId}`));
  const lineB = det.lines?.find(l => l.lotNumber === "L-B"), lineC = det.lines?.find(l => l.lotNumber === "L-C"), lineCab = det.lines?.find(l => l.code === "CAB-01");
  check("inventaire du dépôt : une ligne par lot", inv.status === 201 && lineB && lineC && lineCab, J(det.lines?.map(l => [l.code, l.lotNumber, l.theoreticalQty])));
  for (const [l, q] of [[lineB, 2], [lineC, 12], [lineCab, 1]]) await g.req("PATCH", `/api/inventaires/${invId}`, { lineId: l._id, countedQty: q, reason: "Comptage" });
  await g.req("PATCH", `/api/inventaires/${invId}`, { status: "review" });
  const blocked = await g.req("PATCH", `/api/inventaires/${invId}`, { status: "validated" });
  check("gros écart sur un lot : second comptage exigé", blocked.status === 400);
  await g.req("PATCH", `/api/inventaires/${invId}`, { lineId: lineB._id, recountQty: 2, reason: "Recompté : 1 carton abîmé jeté" });
  const val = await g.req("PATCH", `/api/inventaires/${invId}`, { status: "validated" });
  const lotsAfter = Object.fromEntries((D(await g.req("GET", `/api/products/${p2._id}/stock`)).lots ?? []).filter(l => l.warehouseId?._id === dep).map(l => [l.lotNumber, l.qty]));
  check("validation : le lot L-B ramené à 2 au dépôt", val.status === 200 && lotsAfter["L-B"] === 2 && lotsAfter["L-C"] === 12, `${val.status} ${J(val.data).slice(0, 150)} ${J(lotsAfter)}`);

  console.log("\n▶ Comptoir relié au catalogue");
  const desk = id(await g.req("POST", "/api/comptoir/desks", { name: "The Spot Test" }));
  const whs2 = D(await g.req("GET", "/api/warehouses"));
  const cw = whs2.find(w => w.kind === "comptoir");
  check("réserve du comptoir créée", !!cw, J(whs2.map(w => w.code)));
  const it = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, productId: p2._id, salePrice: 1000 }));
  check("article du comptoir relié au catalogue", it?.productId && it.quantity === 0, J(it).slice(0, 150));
  const sp = await g.req("POST", "/api/comptoir/supply", { deskId: desk, fromWarehouseId: princ._id, lines: [{ itemId: it._id, quantity: 2 }] });
  const items = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`));
  const itm = items.find(x => x._id === it._id);
  check("approvisionnement depuis le magasin : 2 au comptoir", sp.status === 201 && itm?.quantity === 2, `${sp.status} ${J(sp.data).slice(0, 150)} ${itm?.quantity}`);
  const sale = await g.req("POST", "/api/comptoir/stock", { deskId: desk, itemId: it._id, type: "out", quantity: 1, cashAmount: 1000 });
  const wc = await byWh(p2._id);
  check("vente au comptoir : sortie de la réserve, caisse encaissée", sale.status === 201 && wc[cw.code] === 1 && D(sale).cash, `${sale.status} ${J(wc)}`);
  check("vente au-delà de la réserve : refusée", (await g.req("POST", "/api/comptoir/stock", { deskId: desk, itemId: it._id, type: "out", quantity: 5 })).status === 400);
  const own = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Café", unit: "tasse", quantity: 20, unitCost: 100 }));
  const lk = await g.req("PATCH", `/api/comptoir/items/${own._id}`, { productId: p1._id });
  const wp1 = await byWh(p1._id);
  check("article propre relié : son stock entre dans la réserve (reprise)", lk.status === 200 && wp1[cw.code] === 20, `${lk.status} ${J(wp1)} ${J(lk.data).slice(0, 120)}`);
  const cat = D(await g.req("GET", "/api/comptoir/catalog"));
  check("catalogue du comptoir : articles sans coût d'achat, entrepôts hors comptoir", cat.products?.length > 0 && cat.products.every(x => x.purchaseCost === undefined) && cat.warehouses?.every(w => w.kind !== "comptoir"), J(cat).slice(0, 200));
  check("suppression d'un article relié avec réserve : refusée", (await g.req("DELETE", `/api/comptoir/items/${own._id}`)).status === 400);
  const ret = await g.req("POST", "/api/comptoir/supply", { deskId: desk, fromWarehouseId: princ._id, direction: "return", lines: [{ itemId: own._id, quantity: 20 }] });
  const wp1b = await byWh(p1._id);
  const ownAfter = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)).find(x => x._id === own._id);
  check("retour des invendus au magasin : réserve vidée, magasin crédité", ret.status === 201 && !wp1b[cw.code] && wp1b.PRINC === 26 && ownAfter?.quantity === 0, `${ret.status} ${J(wp1b)} ${ownAfter?.quantity} ${J(ret.data).slice(0, 120)}`);
  // Article déjà mouvementé : archivé (historique et tickets gardent leur référence).
  const delOwn = await g.req("DELETE", `/api/comptoir/items/${own._id}`);
  const listed = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)).some(x => x._id === own._id);
  check("article relié vide : retiré du comptoir (archivé, historique conservé)", (delOwn.status === 204 || D(delOwn).archived === true) && !listed, `${delOwn.status} ${listed}`);
  const sum = D(await g.req("GET", `/api/comptoir/summary?deskId=${desk}`));
  check("synthèse du comptoir alignée sur la réserve", typeof sum.stockValue === "number" && sum.itemCount === 1, J(sum).slice(0, 150));

  console.log("\n▶ Marché-cadre : intrant prélevé dans un entrepôt");
  const cli = (D(await g.req("GET", "/api/clients?limit=1")).items ?? [])[0] ?? D(await g.req("POST", "/api/clients", { code: "C-MC", name: "Client marché" }));
  const mc = id(await g.req("POST", "/api/marches-cadres", { clientId: cli._id, title: "Fourniture câbles", totalQuantity: 10, unitPrice: 6000, inputProductId: p1._id, inputPerUnit: 1 }));
  const beforeMc = await byWh(p1._id);
  const lotKo = await g.req("POST", `/api/marches-cadres/${mc}/lots`, { quantity: 3, warehouseId: dep });
  check("livraison : intrant insuffisant dans le dépôt choisi → refus", lotKo.status === 400, `${lotKo.status} ${J(lotKo.data)}`);
  const lotOk = await g.req("POST", `/api/marches-cadres/${mc}/lots`, { quantity: 3 });
  const afterMc = await byWh(p1._id);
  check("livraison : intrant sorti de l'entrepôt par défaut", lotOk.status === 201 && afterMc.PRINC === beforeMc.PRINC - 3 && afterMc["DEP-MRD"] === beforeMc["DEP-MRD"], `${lotOk.status} ${J(beforeMc)} → ${J(afterMc)} ${J(lotOk.data).slice(0, 150)}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
