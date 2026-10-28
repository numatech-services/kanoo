// Scénario de bout en bout : liaison EasyPay — clé du comptoir, catalogue
// (Kanoo fait foi), ventes de la caisse (formules, carte et espèces), doublons,
// annulation, recharge, stock, pré-commandes et production, rejeu, compte
// courant Numatech et reversement, vente arrivée après l'arrêté.
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
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    store(res);
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { req, reset: () => { csrf = "" } };
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

/** Appel de l'API publique avec une clé (comme le serveur EasyPay : pas de cookie). */
async function api(key, method, p, body, headers = {}) {
  const res = await fetch(`${BASE}/api/v1/spot${p}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, etag: res.headers.get("etag"), data: res.status === 304 ? null : await res.json().catch(() => null) };
}
const ref = (id, name, extra = {}) => ({ id, name, ...extra });
const ev = (id, type, data, occurred_at = new Date(Date.now() - 60_000).toISOString()) => ({ id, type, occurred_at, data });

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const local = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = local(new Date(Date.now() + 86_400_000));
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse Spot EasyPay", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const banque = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque Spot EasyPay", type: "bank", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot EasyPay" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0 });
  const item = async b => D(await g.req("POST", "/api/comptoir/items", { deskId: desk, ...b }));
  const pastel = await item({ name: "Pastel", unit: "pièce", category: "Snacking", quantity: 20, unitCost: 150, salePrice: 200 });
  const riz = await item({ name: "Riz au gras", unit: "assiette", category: "Plats", quantity: 10, unitCost: 300, salePrice: 600 });
  await item({ name: "Yaourt", unit: "pot", category: "Desserts", quantity: 5, unitCost: 150, salePrice: 300 });
  await item({ name: "Coca 33 cl", unit: "canette", category: "Boissons", quantity: 2, unitCost: 300, salePrice: 500 });
  const stock = async () => Object.fromEntries((await db(d => d.collection("activityitems").find({ deskId: oid(desk) }).toArray())).map(i => [i.name, i.quantity]));

  console.log("\n▶ Clé du comptoir");
  const kr = await g.req("POST", "/api/comptoir/easypay", { deskId: desk, action: "create_key" });
  const KEY = D(kr).key;
  check("clé créée depuis le comptoir, montrée une fois", kr.status === 201 && /^kno_[a-f0-9]{64}$/.test(KEY ?? ""), `${kr.status} ${J(kr.data).slice(0, 120)}`);
  const stored = await db(d => d.collection("apikeys").findOne({ deskId: oid(desk) }));
  check("en base : empreinte seulement, scopes spot, liée au comptoir", stored && !J(stored).includes(KEY) && stored.scopes.join() === "spot:read,spot:write" && stored.source === "easypay");
  check("sans clé : 401 ; clé inventée : 401", (await api(null, "GET", "/status")).status === 401 && (await api(`kno_${"0".repeat(64)}`, "GET", "/status")).status === 401);
  check("clé générale : scope spot refusé à la création", (await g.req("POST", "/api/v1/auth", { scopes: ["spot:write"] })).status === 400);
  const general = D(await g.req("POST", "/api/v1/auth", { name: "Lecture factures" })).key;
  check("clé générale (factures) : pas d'accès au comptoir (403)", (await api(general, "GET", "/catalogue")).status === 403);
  const st = await api(KEY, "GET", "/status");
  check("statut : comptoir de la clé", st.status === 200 && st.data?.data?.desk?.name === "The Spot EasyPay", J(st.data).slice(0, 150));

  console.log("\n▶ Catalogue (Kanoo fait foi) et liaison des articles");
  const c1 = await api(KEY, "GET", "/catalogue");
  check("catalogue : 4 articles, prix et stock, ETag", c1.status === 200 && c1.data.data.items.length === 4 && c1.data.data.items.find(i => i.name === "Pastel")?.price === 200 && !!c1.etag, J(c1.data).slice(0, 200));
  check("même catalogue avec If-None-Match : 304", (await api(KEY, "GET", "/catalogue", undefined, { "if-none-match": c1.etag })).status === 304);
  const ln = await api(KEY, "POST", "/catalogue/link", { items: [ref("pastel", "PASTEL", { price: 200 }), ref("jus_bissap", "Jus de bissap", { price: 250, category: "Boissons" })], create_missing: true });
  const links = ln.data?.data?.links ?? [];
  check("liaison : pastel relié par le nom, bissap créé", ln.status === 200 && links.find(l => l.easypay_id === "pastel")?.kanoo_id === pastel._id && links.find(l => l.easypay_id === "jus_bissap")?.created === true, J(links));
  const c2 = await api(KEY, "GET", "/catalogue", undefined, { "if-none-match": c1.etag });
  check("catalogue changé : nouvelle version, ids EasyPay rendus", c2.status === 200 && c2.etag !== c1.etag && c2.data.data.items.find(i => i.id === pastel._id)?.easypay_id === "pastel");
  await g.req("PATCH", `/api/comptoir/items/${pastel._id}`, { salePrice: 250 });
  const c3 = await api(KEY, "GET", "/catalogue", undefined, { "if-none-match": c2.etag });
  check("prix changé dans Kanoo : EasyPay le relit", c3.status === 200 && c3.data.data.items.find(i => i.id === pastel._id)?.price === 250);

  console.log("\n▶ Ventes de la caisse");
  const S1 = "0192aaaa-0000-7000-8000-000000000001";
  const sale1 = ev("evt-0000000001", "sale", {
    sale_id: S1, number: "T-101", profile: "student",
    lines: [
      { item: ref("pastel", "Pastel"), quantity: 2, unit_price: 200 },
      { item: ref("formule_eco", "Formule éco étudiant", { category: "Formules" }), quantity: 1, unit_price: 600, components: [{ item: ref("plat_riz", "Riz au gras", { kanoo_id: riz._id }), quantity: 1 }, { item: ref("yaourt", "Yaourt"), quantity: 1 }] },
    ],
    payments: [{ method: "card", amount: 700 }, { method: "cash", amount: 300 }],
  });
  const S2 = "0192aaaa-0000-7000-8000-000000000002";
  const sale2 = ev("evt-0000000002", "sale", { sale_id: S2, lines: [{ item: ref("coca33", "Coca 33 cl"), quantity: 5, unit_price: 500 }], payments: [{ method: "cash", amount: 2500 }] });
  const b1 = await api(KEY, "POST", "/events", { events: [sale1, sale1, sale2] });
  const r1 = b1.data?.data?.results ?? [];
  check("lot : vente appliquée, doublon reconnu, vente au-delà du stock appliquée", b1.status === 200 && r1[0]?.status === "applied" && r1[1]?.status === "duplicate" && r1[2]?.status === "applied", J(r1));
  check("stock insuffisant signalé, pas bloquant", (r1[2]?.warnings ?? []).some(w => /Coca/.test(w)), J(r1[2]));
  const t1 = await db(d => d.collection("comptoirsales").findOne({ deskId: oid(desk), clientRef: S1 }));
  check("ticket : prix de la caisse (pastel 200 malgré 250 dans Kanoo), source easypay", t1?.totalTTC === 1000 && t1.source === "easypay" && t1.lines[0].unitPriceTTC === 200, J(t1?.lines?.map(l => [l.label, l.unitPriceTTC])));
  const s1 = await stock();
  check("formule : riz et yaourt sortis du stock ; pastel −2 ; coca à 0", s1["Pastel"] === 18 && s1["Riz au gras"] === 9 && s1["Yaourt"] === 4 && s1["Coca 33 cl"] === 0, J(s1));
  check("coût de la formule = ses composants (300 + 150)", t1?.lines[1]?.unitCost === 450 && t1.lines[1].ingredients?.length === 2, J(t1?.lines?.[1]));
  const e1 = await db(d => d.collection("accountingentries").findOne({ linkedDocType: "comptoir_sale", linkedDocId: t1?._id }));
  check("écriture : 467100 (carte) 700, caisse 300, ventes 1 000", e1?.lines?.some(l => l.accountCode === "467100" && l.debit === 700) && e1.lines.some(l => l.accountCode.startsWith("57") && l.debit === 300) && e1.lines.some(l => l.accountCode === "706300" && l.credit === 1000), J(e1?.lines));
  const cash1 = await db(d => d.collection("activitycashentries").find({ saleId: t1?._id }).toArray());
  check("tiroir : seulement les 300 en espèces", cash1.length === 1 && cash1[0].amount === 300 && cash1[0].method === "cash", J(cash1.map(c => [c.method, c.amount])));
  const again = await api(KEY, "POST", "/events", { events: [{ ...sale1, id: "evt-0000000001-bis" }] });
  const n1 = await db(d => d.collection("comptoirsales").countDocuments({ deskId: oid(desk), clientRef: S1 }));
  check("même vente sous un autre id d'événement : un seul ticket", again.data?.data?.results?.[0]?.status === "applied" && n1 === 1, J(again.data));

  console.log("\n▶ Annulation, recharge, stock");
  const b2 = await api(KEY, "POST", "/events", { events: [
    ev("evt-0000000003", "sale_void", { sale_id: S2, reason: "supervisor_cancellation" }),
    ev("evt-0000000004", "sale_void", { sale_id: "0192aaaa-0000-7000-8000-000000000099" }),
    ev("evt-0000000005", "topup", { topup_id: "topup-0000000001", amount: 2000, method: "cash" }),
    ev("evt-0000000006", "stock_movement", { movement_id: "mv-0000000001", kind: "loss", item: ref("pastel", "Pastel"), quantity: -3, reason: "Pastels tombés, cassés" }),
    ev("evt-0000000007", "stock_movement", { movement_id: "mv-0000000002", kind: "receipt", item: ref("yaourt", "Yaourt"), quantity: 10 }),
    ev("evt-0000000008", "stock_movement", { movement_id: "mv-0000000003", kind: "count", item: ref("coca33", "Coca 33 cl"), counted_quantity: 6 }),
    ev("evt-0000000009", "sale", { sale_id: "0192aaaa-0000-7000-8000-000000000003", lines: [{ item: ref("pastel", "Pastel"), quantity: 1, unit_price: 200 }], payments: [{ method: "cash", amount: 100 }] }),
    { type: "sale", data: {} },
  ] });
  const r2 = b2.data?.data?.results ?? [];
  check("annulation appliquée ; annulation d'une vente inconnue en échec (rejouable)", r2[0]?.status === "applied" && r2[1]?.status === "failed" && /pas encore reçue/.test(r2[1]?.error ?? ""), J(r2.slice(0, 2)));
  const t2 = await db(d => d.collection("comptoirsales").findOne({ deskId: oid(desk), clientRef: S2 }));
  check("ticket annulé dans Kanoo, stock rendu", t2?.status === "cancelled" && (await stock())["Coca 33 cl"] === 6, `${t2?.status} ${J(await stock())}`);
  const top = await db(d => d.collection("activitycashentries").findOne({ deskId: oid(desk), category: "easypay_topup" }));
  const topE = top && await db(d => d.collection("accountingentries").findOne({ _id: top.entryId }));
  check("recharge : 2 000 dans le tiroir, caisse / 467100 (pas une recette)", r2[2]?.status === "applied" && top?.amount === 2000 && topE?.lines?.some(l => l.accountCode === "467100" && l.credit === 2000) && !topE.lines.some(l => l.accountCode.startsWith("7")), J(topE?.lines));
  const s2 = await stock();
  const loss = await db(d => d.collection("activitystockmoves").findOne({ deskId: oid(desk), lossReason: { $exists: true }, reason: /EasyPay/ }));
  check("perte (cassé) 3, réception yaourt 10, inventaire coca 6", s2["Pastel"] === 15 && loss?.lossReason === "broken" && s2["Yaourt"] === 14 && s2["Coca 33 cl"] === 6, `${J(s2)} ${loss?.lossReason}`);
  check("vente mal payée : illisible ; événement sans id : illisible, non gardé", r2[6]?.status === "rejected" && r2[7]?.status === "rejected" && !r2[7]?.id, J(r2.slice(6)));
  check("traces : la vente mal payée est gardée « rejected »", (await db(d => d.collection("integrationevents").countDocuments({ deskId: oid(desk), status: "rejected" }))) === 1);

  console.log("\n▶ Pré-commandes et production");
  const b3 = await api(KEY, "POST", "/events", { events: [
    ev("evt-0000000010", "preorder", { order_id: "order-00000001", status: "booked", pickup_day: tomorrow, service: "lunch", amount: 6000, lines: [{ item: ref("poulet_braise", "¼ poulet braisé"), quantity: 3 }] }, new Date(Date.now() - 30_000).toISOString()),
    ev("evt-0000000011", "preorder", { order_id: "order-00000001", status: "cancelled", pickup_day: tomorrow, lines: [{ item: ref("poulet_braise", "¼ poulet braisé"), quantity: 3 }] }, new Date(Date.now() - 50_000).toISOString()),
  ] });
  const po = await db(d => d.collection("deskpreorders").findOne({ externalId: "order-00000001" }));
  check("pré-commande enregistrée ; un état plus ancien arrivé après ne l'écrase pas", b3.data?.data?.results?.every(r => r.status === "applied") && po?.status === "booked", `${J(b3.data)} ${po?.status}`);
  const prod = await api(KEY, "GET", `/production?day=${tomorrow}`);
  const poulet = prod.data?.data?.items?.find(i => i.easypay_id === "poulet_braise");
  check("production de demain : 3 poulets pré-commandés à préparer", prod.status === 200 && poulet?.preordered === 3 && poulet?.planned === 3, J(prod.data).slice(0, 200));
  const plan = D(await g.req("GET", `/api/comptoir/production?deskId=${desk}&day=${tomorrow}`));
  check("plan de production de Kanoo : pré-commandes visibles", plan.preorders?.some(p => p.quantity === 3), J(plan).slice(0, 150));

  console.log("\n▶ Rejeu, écart, compte courant Numatech");
  const failed = await db(d => d.collection("integrationevents").findOne({ deskId: oid(desk), status: "failed" }));
  const rp0 = await g.req("POST", `/api/comptoir/easypay/events/${failed._id}`, { action: "replay" });
  check("rejeu tant que la vente manque : toujours en échec", rp0.status === 200 && D(rp0).status === "failed");
  await api(KEY, "POST", "/events", { events: [ev("evt-0000000012", "sale", { sale_id: "0192aaaa-0000-7000-8000-000000000099", lines: [{ item: ref("jus_bissap", "Jus de bissap"), quantity: 1, unit_price: 250 }], payments: [{ method: "balance", amount: 250 }] })] });
  const rp = await g.req("POST", `/api/comptoir/easypay/events/${failed._id}`, { action: "replay" });
  const t99 = await db(d => d.collection("comptoirsales").findOne({ deskId: oid(desk), clientRef: "0192aaaa-0000-7000-8000-000000000099" }));
  check("vente arrivée : le rejeu applique l'annulation", rp.status === 200 && D(rp).status === "applied" && t99?.status === "cancelled", `${J(rp.data)} ${t99?.status}`);
  const rej = await db(d => d.collection("integrationevents").findOne({ deskId: oid(desk), status: "rejected" }));
  check("événement illisible : écarté par le chef", (await g.req("POST", `/api/comptoir/easypay/events/${rej._id}`, { action: "ignore", note: "corrigé à la caisse" })).status === 200);
  const view = D(await g.req("GET", `/api/comptoir/easypay?deskId=${desk}`));
  // Carte : 700 (vente 1) ; recharge : −2 000 ; vente 99 par carte puis annulée : 0.
  check("compte courant : 700 − 2 000 = −1 300 (le comptoir doit à Numatech)", view.balance === -1300, J({ balance: view.balance, counts: view.counts }));
  check("compteurs : appliqués, écarté, aucun échec", view.counts?.applied >= 12 && view.counts?.ignored === 1 && !view.counts?.failed, J(view.counts));
  const rem = await g.req("POST", "/api/comptoir/easypay", { deskId: desk, action: "remittance", treasuryAccountId: banque, amount: 1300, direction: "paid", reference: "VIR-EP-1" });
  check("reversement à Numatech : compte soldé", rem.status === 201 && D(rem).balance === 0, J(rem.data));

  console.log("\n▶ Vente arrivée après l'arrêté de la journée");
  const today = local();
  const cl = await g.req("POST", "/api/comptoir/closings", { deskId: desk, day: today, countedCash: 0, openingFloat: 0 });
  const late = await api(KEY, "POST", "/events", { events: [ev("evt-0000000013", "sale", { sale_id: "0192aaaa-0000-7000-8000-000000000013", lines: [{ item: ref("pastel", "Pastel"), quantity: 1, unit_price: 200 }], payments: [{ method: "card", amount: 200 }] })] });
  const tl = await db(d => d.collection("comptoirsales").findOne({ deskId: oid(desk), clientRef: "0192aaaa-0000-7000-8000-000000000013" }));
  check("journée arrêtée : la vente passe au premier jour ouvert, heure réelle gardée", cl.status === 201 && late.data?.data?.results?.[0]?.status === "applied" && tl && local(new Date(tl.date)) === tomorrow && local(new Date(tl.occurredAt)) === today, `${cl.status} ${J(late.data)} ${tl?.date}`);

  console.log("\n▶ Révocation");
  const keyDoc = await db(d => d.collection("apikeys").findOne({ deskId: oid(desk) }));
  await g.req("POST", "/api/comptoir/easypay", { deskId: desk, action: "revoke_key", keyId: String(keyDoc._id) });
  check("clé révoquée : 401", (await api(KEY, "GET", "/status")).status === 401);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
