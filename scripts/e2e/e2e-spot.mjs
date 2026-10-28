// Scénario de bout en bout : The Spot — rentabilité par article (achat au
// paquet, revente à l'unité), marge attendue, meilleures ventes, caisse de la
// semaine (ouverture, bilan, fermeture), coûts visibles du seul chef.
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
const oid = x => new ObjectId(String(x));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse Spot", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot" }))._id;
  const set = await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0, targetMarkup: 0.3 });
  check("comptoir relié, taux de marque visé 30 %", set.status === 200, `${set.status} ${J(set.data).slice(0, 120)}`);

  console.log("\n▶ Rentabilité prévue par article");
  const bis = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Biscuit (sachet)", unit: "sachet", category: "Biscuits", salePrice: 200, pack: { label: "paquet", size: 24, cost: 5000 } }));
  const pas = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Pastel", unit: "pièce", category: "Snacks", quantity: 40, unitCost: 150, salePrice: 200 }));
  check("biscuit : coût unitaire tiré du paquet (5 000 / 24)", bis.unitCost === 208.33 && bis.pack?.size === 24, J(bis).slice(0, 160));
  let pr = D(await g.req("GET", `/api/comptoir/profitability?deskId=${desk}`));
  const eb = pr.items?.find(r => r._id === bis._id)?.economics, ep = pr.items?.find(r => r._id === pas._id);
  check("biscuit revendu 200 : à perte (−8,33 par sachet, −200 par paquet), prix conseillé 300", eb?.status === "loss" && eb.marginUnit === -8.33 && eb.packMargin === -200 && eb.packRevenue === 4800 && eb.suggestedPrice === 300 && eb.breakEvenPrice === 225, J(eb));
  check("pastel 150 → 200 : +50 par pièce, 25 % du prix", ep?.economics.marginUnit === 50 && ep.economics.markupRate === 25 && ep.economics.status === "ok", J(ep?.economics));
  check("stock de 40 pastels : 8 000 de CA et 2 000 de marge attendus", ep?.outlook.expectedRevenue === 8000 && ep.outlook.expectedMargin === 2000, J(ep?.outlook));
  check("signalement : 1 article à perte", pr.totals?.losses === 1, J(pr.totals));

  console.log("\n▶ Entrée de stock par paquets");
  const ent = await g.req("POST", "/api/comptoir/stock", { deskId: desk, itemId: bis._id, type: "in", packs: 3, packCost: 5100, reason: "Achat grossiste" });
  const bis2 = D(await g.req("GET", `/api/comptoir/items?deskId=${desk}`)).find(i => i._id === bis._id);
  check("3 paquets de 24 à 5 100 : 72 sachets à 212,50, prix du paquet mis à jour", ent.status === 201 && bis2?.quantity === 72 && bis2?.unitCost === 212.5 && bis2?.pack?.cost === 5100, `${ent.status} ${J(bis2).slice(0, 160)}`);
  const patch = await g.req("PATCH", `/api/comptoir/items/${bis._id}`, { pack: { size: 0.5 } });
  check("conditionnement invalide : refusé", patch.status === 400, patch.status);

  console.log("\n▶ Caisse de la semaine");
  const op = await g.req("POST", "/api/comptoir/sessions", { deskId: desk, openingFloat: 10_000, label: "Semaine test" });
  check("caisse ouverte avec 10 000 de fonds ; une seule à la fois", op.status === 201 && (await g.req("POST", "/api/comptoir/sessions", { deskId: desk, openingFloat: 0 })).status === 400, `${op.status} ${J(op.data).slice(0, 100)}`);
  await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: pas._id, quantity: 10 }] });
  await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: bis._id, quantity: 5 }], payments: [{ method: "orange_money", amount: 1000 }] });
  await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "out", amount: 3000, label: "Moto-taxi livraison", category: "transport" });
  await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction: "out", amount: 2000, label: "Sucre", category: "ingredients" });
  const ses = D(await g.req("GET", `/api/comptoir/sessions?deskId=${desk}`));
  const r = ses.current?.report;
  check("bilan : CA 3 000, recettes 3 000, dépenses 5 000, solde −2 000", r?.sales.revenueTTC === 3000 && r.receipts === 3000 && r.expenses === 5000 && r.balance === -2000, J(r && { s: r.sales, rc: r.receipts, ex: r.expenses }));
  check("espèces attendues : 10 000 + 2 000 − 5 000 = 7 000", r?.expectedCash === 7000, r?.expectedCash);
  check("dépenses par nature", r?.expensesByCategory?.find(c => c.category === "transport")?.amount === 3000 && r.expensesByCategory.find(c => c.category === "ingredients")?.amount === 2000, J(r?.expensesByCategory));
  check("meilleures ventes : pastel en tête (CA et marge), biscuit vendu à perte", r?.topByRevenue?.[0]?.label === "Pastel" && r.topByMargin?.[0]?.margin === 500 && r.losses?.some(l => l.label === "Biscuit (sachet)"), J([r?.topByRevenue, r?.losses]));
  check("panier moyen 1 500 sur 2 tickets", r?.sales.count === 2 && r.sales.averageTicket === 1500, J(r?.sales));
  pr = D(await g.req("GET", `/api/comptoir/profitability?deskId=${desk}`));
  check("rentabilité : pastel n°1 des ventes, marge réalisée 500", pr.best?.[0]?.label === "Pastel" && pr.items?.find(x => x._id === pas._id)?.sold?.rank === 1 && pr.items.find(x => x._id === pas._id).sold.margin === 500, J(pr.best));

  console.log("\n▶ Coûts : chef du Spot oui, caissier non");
  const PWS = `Kz-${Date.now()}!Aa9`;
  await g.req("POST", "/api/users", { email: "chef.spot@test.ne", password: PWS, firstName: "Chef", lastName: "Spot", roles: ["svc_spot"], roleLevels: { svc_spot: "chef" } });
  await g.req("POST", "/api/users", { email: "caisse.spot@test.ne", password: PWS, firstName: "Caisse", lastName: "Spot", roles: ["svc_spot"], roleLevels: { svc_spot: "employe" }, siteIds: [desk] });
  const { s: chef } = await login("chef.spot@test.ne", PWS);
  const { s: cash } = await login("caisse.spot@test.ne", PWS);
  check("chef du Spot : coûts et rentabilité visibles", (D(await chef.req("GET", `/api/comptoir/items?deskId=${desk}`)) ?? []).every(i => i.unitCost !== null) && (await chef.req("GET", `/api/comptoir/profitability?deskId=${desk}`)).status === 200);
  const cs = D(await cash.req("GET", `/api/comptoir/sessions?deskId=${desk}`));
  check("caissier : rentabilité refusée, bilan sans marge", (await cash.req("GET", `/api/comptoir/profitability?deskId=${desk}`)).status === 403 && cs.showCosts === false && cs.current?.report?.sales?.margin === undefined && cs.current?.report?.sales?.revenueTTC === 3000, J(cs.current?.report?.sales));

  console.log("\n▶ Fermeture de la caisse");
  const sid = ses.current._id;
  const cl = await cash.req("POST", `/api/comptoir/sessions/${sid}/close`, { countedCash: 6900, notes: "Pièces manquantes" });
  const closed = D(cl);
  const gapE = await db(d => d.collection("accountingentries").findOne({ linkedDocType: "cash_closing", linkedDocId: oid(closed.closingId) }));
  check("fermée : écart −100 passé en 658100, bilan figé", cl.status === 200 && closed.status === "closed" && closed.summary?.gap === -100 && closed.summary?.countedCash === 6900 && gapE?.lines?.some(l => l.accountCode === "658100" && l.debit === 100), `${cl.status} ${J(closed).slice(0, 200)}`);
  check("période verrouillée : nouveau ticket refusé", (await g.req("POST", "/api/comptoir/sales", { deskId: desk, lines: [{ itemId: pas._id, quantity: 1 }] })).status === 400);
  const after = D(await g.req("GET", `/api/comptoir/sessions?deskId=${desk}`));
  check("historique : la semaine fermée, plus de caisse ouverte", !after.current && after.history?.length === 1 && after.history[0].summary?.sales?.revenueTTC === 3000, J(after.history?.[0]?.summary?.sales));
  check("fermer deux fois : refusé", (await g.req("POST", `/api/comptoir/sessions/${sid}/close`, { countedCash: 1 })).status === 400);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
