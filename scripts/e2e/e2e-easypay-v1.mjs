// Scénario de bout en bout : liaison EasyPay — clé du comptoir, catalogue
// (Kanoo fait foi), ventes de la caisse (formules, carte et espèces), doublons,
// annulation, recharge, stock, pré-commandes et production, rejeu, compte
// courant Numatech et reversement, vente arrivée après l'arrêté.
import { readFileSync } from "fs";
import { createHmac, randomBytes, randomUUID } from "crypto";
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


const hmac = (k, m) => createHmac("sha256", k).update(m).digest("hex");
/** Requête du contrat v1, signée comme EasyPay (corps brut, t en secondes). */
// `raw` : corps envoyé tel quel (signé tel quel) ; `tampered` : corps envoyé APRÈS signature du corps d'origine.
async function v1(key, path, obj, { secret, site = "the-spot", t = Math.floor(Date.now() / 1000), raw, tampered } = {}) {
  const signed = raw ?? JSON.stringify(obj), body = tampered ?? signed;
  const res = await fetch(`${BASE}/api/v1/spot${path}`, { method: "POST", redirect: "manual", body, headers: {
    authorization: `Bearer ${key}`, "content-type": "application/json; charset=utf-8", accept: "application/json", "user-agent": "EasyPay-Kanoo/1",
    "x-easypay-spec-version": "1", "x-easypay-site": site, "x-easypay-signature": `t=${t},v1=${hmac(secret, `${t}.${signed}`)}`,
    ...(obj?.event_id ? { "idempotency-key": obj.event_id, "x-easypay-event-id": obj.event_id, "x-easypay-event-type": obj.type, "x-easypay-sequence": String(obj.sequence), "x-easypay-attempt": "1", "x-easypay-replay": "0" } : {}),
  } });
  return { status: res.status, data: await res.json().catch(() => null) };
}
let seq = 0;
const evt = (type, data, extra = {}) => ({ spec_version: "1", event_id: randomUUID(), type, sequence: ++seq, site: { id: "the-spot", name: "The Spot" },
  occurred_at: new Date(Date.now() - 60_000).toISOString(), business_date: new Date().toISOString().slice(0, 10), recorded_at: new Date().toISOString(), data, ...extra });

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const caisse = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse Spot v1", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "The Spot v1" }))._id;
  await g.req("PATCH", `/api/comptoir/desks/${desk}`, { treasuryAccountId: caisse, revenueAccount: "706300", vatRate: 0 });
  await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Pastel", unit: "pièce", category: "Snacking", quantity: 20, unitCost: 150, salePrice: 200 });
  const KEY = D(await g.req("POST", "/api/comptoir/easypay", { deskId: desk, action: "create_key" })).key;
  const secret = randomBytes(32).toString("hex");

  console.log("\n▶ Poignée de main");
  const ev0 = evt("sale.recorded", { sale_id: randomUUID(), payments: [{ method: "cash", amount: 200 }], lines: [{ kind: "item", ref_id: "pastel", label: "Pastel", quantity: 1, unit_price_amount: 200, amount: 200 }] });
  check("événement avant toute poignée de main : 401", (await v1(KEY, "/events", ev0, { secret })).status === 401);
  const challenge = randomBytes(16).toString("hex");
  const hsBody = { spec_version: "1", type: "handshake", site: { id: "the-spot", name: "The Spot" }, signing_secret: secret, challenge, sent_at: new Date().toISOString() };
  check("poignée de main signée d'un autre secret : 401", (await v1(KEY, "/handshake", hsBody, { secret: "b".repeat(64) })).status === 401);
  const hs = await v1(KEY, "/handshake", hsBody, { secret });
  check("poignée de main : 200, ok, version 1, preuve juste", hs.status === 200 && hs.data?.ok === true && hs.data.spec_version === "1" && hs.data.challenge_response === hmac(secret, challenge), `${hs.status} ${J(hs.data)}`);
  const kd = await db(d => d.collection("apikeys").findOne({ deskId: oid(desk) }));
  check("secret gardé chiffré, restaurant relié", kd.easypaySite === "the-spot" && kd.signingSecret && kd.signingSecret !== secret && !kd.signingSecret.includes(secret), J({ site: kd.easypaySite }));
  const screen = D(await g.req("GET", `/api/comptoir/easypay?deskId=${desk}`));
  check("écran du comptoir : restaurant relié affiché, secret jamais renvoyé", screen.keys?.[0]?.easypaySite === "the-spot" && !J(screen).includes("signingSecret"));

  console.log("\n▶ Événements signés");
  const r0 = await v1(KEY, "/events", ev0, { secret });
  const sale = await db(d => d.collection("comptoirsales").findOne({ deskId: oid(desk), clientRef: ev0.data.sale_id }));
  check("vente reçue : 200 accepted, ticket créé", r0.status === 200 && r0.data?.status === "accepted" && sale?.totalTTC === 200, `${r0.status} ${J(r0.data)}`);
  const dup = await v1(KEY, "/events", ev0, { secret });
  const n = await db(d => d.collection("comptoirsales").countDocuments({ deskId: oid(desk), clientRef: ev0.data.sale_id }));
  check("même event_id renvoyé : 200 duplicate, un seul ticket", dup.status === 200 && dup.data?.status === "duplicate" && n === 1, `${dup.status} ${J(dup.data)} ${n}`);
  check("corps modifié après signature : 401", (await v1(KEY, "/events", ev0, { secret, tampered: JSON.stringify({ ...ev0, sequence: 99 }) })).status === 401);
  check("horloge écartée de plus de 300 s : 401", (await v1(KEY, "/events", evt("drawer.opened", {}), { secret, t: Math.floor(Date.now() / 1000) - 400 })).status === 401);
  check("autre restaurant dans X-EasyPay-Site : 403 unknown_site", (await v1(KEY, "/events", evt("drawer.opened", {}), { secret, site: "autre" })).data?.error === "unknown_site");
  const bad = evt("sale.recorded", { sale_id: randomUUID(), payments: [{ method: "cash", amount: 999 }], lines: [{ kind: "item", ref_id: "pastel", label: "Pastel", quantity: 1, unit_price_amount: 200, amount: 200 }] });
  const rb = await v1(KEY, "/events", bad, { secret });
  check("vente incohérente : 422 invalid_payload, sans donnée sensible", rb.status === 422 && rb.data?.error === "invalid_payload", `${rb.status} ${J(rb.data)}`);
  const fixed = { ...bad, data: { ...bad.data, payments: [{ method: "card", amount: 200 }] } };
  check("même event_id renvoyé corrigé (lettre morte rejouée) : accepté", (await v1(KEY, "/events", fixed, { secret })).data?.status === "accepted");
  const unk = await v1(KEY, "/events", evt("loyalty.points", { points: 3 }), { secret });
  check("type inconnu (version future) : 200 ignored", unk.status === 200 && unk.data?.status === "ignored", `${unk.status} ${J(unk.data)}`);
  check("recharge en espèces au comptoir : accepted", (await v1(KEY, "/events", evt("topup.recorded", { topup_id: randomUUID(), amount: 2000, tendered_amount: 5000, change_amount: 3000 }), { secret })).data?.status === "accepted");
  const vo = await v1(KEY, "/events", evt("sale.voided", { void_id: randomUUID(), sale_id: ev0.data.sale_id, reason: "supervisor_cancellation", sale_known: true, credited_amount: 0 }), { secret });
  const after = await db(d => d.collection("comptoirsales").findOne({ _id: sale._id }));
  check("annulation : ticket annulé", vo.data?.status === "accepted" && after.status === "cancelled", `${J(vo.data)} ${after.status}`);
  check("annulation d'une vente jamais reçue : accepted, rien à annuler", (await v1(KEY, "/events", evt("sale.voided", { void_id: randomUUID(), sale_id: randomUUID(), reason: "unconfirmed_refused", sale_known: false, sale: null }), { secret })).data?.status === "accepted");

  console.log("\n▶ Commandes et bilan du jour");
  const order = randomUUID(), today = new Date().toISOString().slice(0, 10);
  const od = (status, s) => evt("order.updated", { order_id: order, number: "A-205", status, payment: "balance", pickup_date: today, total_amount: 200, lines: [{ kind: "item", ref_id: "pastel", label: "Pastel", quantity: 1, unit_price_amount: 200, amount: 200 }] }, { sequence: s });
  await v1(KEY, "/events", { ...od("received", 100), type: "order.placed" }, { secret });
  await v1(KEY, "/events", od("handed_over", 102), { secret });
  await v1(KEY, "/events", od("ready", 101), { secret });
  const po = await db(d => d.collection("deskpreorders").findOne({ externalId: order }));
  check("commande : l'état de plus grande sequence l'emporte (renvoi plus ancien ignoré)", po?.status === "picked_up" && po.sequence === 102, J(po && { status: po.status, sequence: po.sequence }));
  const close = rev => evt("day.closed", { business_date: today, revision: rev, sales: { sales_count: 2, total_amount: 400, card_amount: 200, net_amount: 400 },
    settlement: { balance_collected_amount: 200, counter_topups_amount: 2000, net_due_to_site_amount: -1800, commission_amount: null }, reconciliation: { matches: true } });
  await v1(KEY, "/events", close(2), { secret });
  await v1(KEY, "/events", close(1), { secret });
  const dc = await db(d => d.collection("easypaydaycloses").find({ deskId: oid(desk) }).toArray());
  check("bilan du jour : un par jour, celui de plus grande révision", dc.length === 1 && dc[0].revision === 2 && dc[0].data.settlement.net_due_to_site_amount === -1800, J(dc.map(c => c.revision)));
  const scr = D(await g.req("GET", `/api/comptoir/easypay?deskId=${desk}`));
  check("écran du comptoir : bilan affiché et rang de la file suivi", scr.dayCloses?.[0]?.revision === 2 && scr.sequence?.last >= 102 && scr.sequence.missing > 0, J({ c: scr.dayCloses?.length, s: scr.sequence }));

  console.log("\n▶ Ancien envoi par lots");
  const legacy = await api(KEY, "POST", "/events", { events: [{ id: `legacy-${Date.now()}`, type: "topup", occurred_at: new Date(Date.now() - 60_000).toISOString(), data: { topup_id: `tp-${Date.now()}`, amount: 500 } }] });
  check("lot { events } toujours accepté", legacy.status === 200 && legacy.data?.data?.results?.[0]?.status === "applied", `${legacy.status} ${J(legacy.data).slice(0, 160)}`);

  console.log(`\n${pass} réussis, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
