// Scénario : liaison réseau EasyPay → Kanoo, contrat 1.1 (agents, partenaires, bilan du jour du réseau).
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
const id = r => D(r)?._id;
import { createHmac, randomBytes, randomUUID } from "crypto";
const hmac = (k, m) => createHmac("sha256", k).update(m).digest("hex");
async function net(key, path, obj, { secret, site = "_easypay", tampered } = {}) {
  const t = Math.floor(Date.now() / 1000), signed = JSON.stringify(obj), body = tampered ?? signed;
  const res = await fetch(`${BASE}/api/v1/easypay${path}`, { method: "POST", body, headers: { authorization: `Bearer ${key}`, "content-type": "application/json",
    "x-easypay-spec-version": "1", "x-easypay-site": site, "x-easypay-signature": `t=${t},v1=${hmac(secret, `${t}.${signed}`)}` } });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const DAY = new Date().toISOString().slice(0, 10), MONTH = DAY.slice(0, 7);
let seq = 0;
const evt = (type, data, extra = {}) => ({ spec_version: "1", event_id: randomUUID(), type, sequence: ++seq, site: { id: "_easypay", name: "EasyPay (réseau)" },
  occurred_at: new Date(Date.now() - 60_000).toISOString(), business_date: DAY, data, ...extra });

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const KEY = D(await g.req("POST", "/api/v1/auth", { name: "EasyPay réseau", scopes: ["easypay:network"] })).key;
  const OTHER = D(await g.req("POST", "/api/v1/auth", { name: "Lecture", scopes: ["invoices:read"] })).key;
  check("clé de la liaison réseau créée", !!KEY);
  const secret = randomBytes(32).toString("hex"), challenge = randomBytes(16).toString("hex");
  const hsBody = { spec_version: "1", type: "handshake", site: { id: "_easypay", name: "EasyPay (réseau)" }, signing_secret: secret, challenge, sent_at: new Date().toISOString() };

  console.log("\n▶ Poignée de main");
  check("clé sans easypay:network : 403", (await net(OTHER, "/handshake", hsBody, { secret })).status === 403);
  check("autre site que _easypay : 403", (await net(KEY, "/handshake", { ...hsBody, site: { id: "the-spot", name: "x" } }, { secret, site: "the-spot" })).status === 403);
  check("signée d'un autre secret : 401", (await net(KEY, "/handshake", hsBody, { secret: "b".repeat(64) })).status === 401);
  const hs = await net(KEY, "/handshake", hsBody, { secret });
  check("poignée de main : preuve du challenge", hs.status === 200 && hs.data?.challenge_response === hmac(secret, challenge), J(hs.data));
  const send = (e, o = {}) => net(KEY, "/events", e, { secret, ...o });

  console.log("\n▶ Agents");
  const tp = evt("agent_topup.recorded", { topup_id: "t-1", agent_ref: "a_" + "1".repeat(24), campus_id: "c-s1", university_id: "u1", method: "cash", amount: 2000, tendered_amount: 5000, change_amount: 3000, charge_amount: 20, credited_amount: 1980, commission_amount: 50, received_at: new Date().toISOString() });
  check("recharge d'agent : acceptée", (await send(tp)).data?.status === "accepted");
  check("même événement renvoyé : duplicate", (await send(tp)).data?.status === "duplicate");
  check("corps modifié après signature : 401", (await send(evt("agent_topup.recorded", { topup_id: "t-2", amount: 1 }), { tampered: JSON.stringify({ x: 1 }) })).status === 401);
  const remData = { remittance_id: "r-1", direction: "agent_to_easypay", agent_ref: "a_" + "1".repeat(24), amount: 1500, reference: "BORD-1", state: "handed_over", reconciled: false, reconciled_at: null };
  const remRec = evt("agent_remittance.recorded", remData);
  const remOk = evt("agent_remittance.reconciled", { ...remData, state: "reconciled", reconciled: true, reconciled_at: new Date().toISOString() });
  check("rapprochement reçu AVANT le versement : objet créé rapproché", (await send(remOk)).data?.status === "accepted");
  check("versement « recorded » arrivé ensuite : accepté sans faire reculer l'état", (await send(remRec)).data?.status === "accepted");

  console.log("\n▶ Partenaires");
  const earn = { earning_id: "318", object_type: "market_order", object_id: "o1", partner: { id: "p1", name: "Boutique Kaocen", type: "vendor", university_id: null }, base_amount: 10000, commission_rate_bp: 1250, commission_amount: 1250, partner_amount: 8750, settlement: "outside", state: "earned", earned_at: new Date().toISOString(), settled_at: null, to_settle_amount: 8750 };
  check("commission incohérente (commission + part ≠ base) : 422", (await send(evt("partner_earning.recorded", { ...earn, earning_id: "bad", partner_amount: 1 }))).status === 422);
  check("commission partenaire : acceptée", (await send(evt("partner_earning.recorded", earn))).data?.status === "accepted");
  check("règlement au guichet : accepté", (await send(evt("partner_earning.settled", { ...earn, state: "settled", settled_at: new Date().toISOString(), to_settle_amount: 0 }))).data?.status === "accepted");
  check("reversement à un assureur : accepté", (await send(evt("partner_payout.recorded", { payout_id: "12", direction: "easypay_to_partner", partner: { id: "p2", name: "Caren Assurances", type: "insurer" }, amount: 45000, paid_on: DAY, reference: "VIR-118", period: { from: DAY, to: DAY } }))).data?.status === "accepted");
  check("type inconnu : 200 ignored", (await send(evt("futur.type", {}))).data?.status === "ignored");
  check("montant non entier : 422", (await send(evt("agent_topup.recorded", { topup_id: "t-3", amount: 10.5 }))).status === 422);
  check("frais supérieurs à la recharge : 422", (await send(evt("agent_topup.recorded", { topup_id: "t-4", amount: 1000, charge_amount: 5000 }))).status === 422);
  check("reste dû supérieur à la part du partenaire : 422", (await send(evt("partner_earning.recorded", { ...earn, earning_id: "e9", to_settle_amount: 20000 }))).status === 422);
  check("jour inexistant (31 novembre) : 422", (await send(evt("agent_topup.recorded", { topup_id: "t-5", amount: 1 }, { business_date: "2026-11-31" }))).status === 422);
  check("« reconciled » qui ne se dit pas rapproché : 422", (await send(evt("agent_remittance.reconciled", { ...remData, remittance_id: "r-9" }))).status === 422);
  check("droit easypay:network combiné à un autre : refusé", (await g.req("POST", "/api/v1/auth", { name: "x", scopes: ["easypay:network", "invoices:write"] })).status === 400);

  console.log("\n▶ Bilan du jour du réseau");
  const blocks = { agent_topups: { topups_count: 1, amount: 2000 }, agent_remittances: { remittances_count: 1, amount: 1500 }, partner_earnings: { earnings_count: 1, base_amount: 10000 }, partner_payouts: { payouts_count: 1, amount: 45000 } };
  const day = (rev, matches, b = blocks) => evt("network_day.closed", { business_date: DAY, timezone: "Africa/Niamey", revision: rev, ...b, partner_balances: [{ partner: { id: "p2", name: "Caren Assurances", type: "insurer" }, due_to_date_amount: 120000, paid_to_date_amount: 45000, left_to_pay_amount: 75000 }], reconciliation: { matches } });
  await send(day(2, true)); await send(day(1, false));

  const r = D(await g.req("GET", `/api/easypay-reseau?month=${MONTH}`));
  check("synthèse : recharges 2 000, frais 20, commissions agents 50", r.agentTopups?.amount === 2000 && r.agentTopups.charges === 20 && r.agentTopups.commissions === 50, J(r.agentTopups));
  check("synthèse : versement 1 500 rapproché (l'état n'a pas reculé)", r.agentRemittances?.amount === 1500 && r.agentRemittances.reconciled === 1500 && r.agentRemittances.pendingCount === 0, J(r.agentRemittances));
  check("encours de l'agent : 2 000 − 1 500 = 500", r.agents?.[0]?.outstanding === 500, J(r.agents));
  check("commission EasyPay 1 250, part partenaire 8 750, plus rien dû après règlement", r.partnerEarnings?.commission === 1250 && r.partners.find(p => p.partnerId === "p1")?.toSettle === 0, J(r.partners));
  check("reversement 45 000 et soldes des assureurs du dernier bilan", r.partnerPayouts?.amount === 45000 && r.partnerBalances?.[0]?.left_to_pay_amount === 75000, J(r.partnerBalances));
  check("bilan du jour : la plus grande révision fait foi (rév. 2, rapproché)", r.days?.[0]?.revision === 2 && r.days[0].matches === true, J(r.days));
  check("rapprochement par Kanoo : faits reçus = bilan d'EasyPay", r.days?.[0]?.kanooMatches === true, J(r.days?.[0]?.gaps));
  await send(day(3, true, { ...blocks, agent_topups: { topups_count: 2, amount: 4000 } }));
  const r3 = D(await g.req("GET", `/api/easypay-reseau?month=${MONTH}`));
  check("bilan annonçant une recharge que Kanoo n'a pas : écart Kanoo signalé", r3.days?.[0]?.kanooMatches === false && /recharges/.test(r3.days[0].gaps.join(" ")), J(r3.days?.[0]));
  check("rangs jamais acceptés signalés (6 refus en 422 et 1 signature altérée)", r3.missingSequences === 7, String(r3.missingSequences));
  check("liaison affichée avec son dernier rang", r.link?.lastSequence >= 9, J(r.link));
  const o = await other.req("GET", `/api/easypay-reseau?month=${MONTH}`);
  check("autre organisation : rien de cette liaison", o.status === 200 ? (D(o).agentTopups?.amount ?? 0) === 0 : o.status === 403, `${o.status}`);
  check("adresse du restaurant : la clé réseau n'y entre pas", (await (await fetch(`${BASE}/api/v1/spot/events`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ events: [] }) })).status) === 403);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
