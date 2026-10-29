// Scénario de bout en bout : corrections de cohérence — règles du service
// worker servies hors session, numéros des reçus et courriers sans doublon
// (créations simultanées, suppression), erreurs internes jamais renvoyées,
// session de 20 minutes, caisse rapide idempotente.
import { readFileSync } from "fs";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);

function session() {
  const jar = new Map(); let csrf = ""; let lastCookies = [];
  const store = r => { lastCookies = r.headers.getSetCookie?.() ?? []; for (const c of lastCookies) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body, headers = {}) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    store(res);
    return { status: res.status, data: await res.json().catch(() => null), cookies: lastCookies };
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
const db = fn => withDb(ROOT, fn);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const year = new Date().getFullYear();

  console.log("\n▶ 1. Service worker");
  const pol = await fetch(`${BASE}/sw-policy.js`, { redirect: "manual" });
  const polText = await pol.text();
  check("règles du service worker servies sans session (installation depuis la page de connexion)", pol.status === 200 && /mutationMode/.test(polText) && /no-store/.test(pol.headers.get("cache-control") ?? ""), `${pol.status}`);
  const sw = await (await fetch(`${BASE}/sw.js`)).text();
  check("le service worker charge ses règles et ne garde plus de pages", sw.includes('importScripts("/sw-policy.js")') && !sw.includes('"/dashboard"'));

  console.log("\n▶ 4. Session");
  const { s: g, r: lr } = await login("admin@test.ne", SEED_PW);
  const auth = lr.cookies.find(c => c.startsWith("auth_token="));
  const maxAge = Number(/Max-Age=(\d+)/i.exec(auth ?? "")?.[1]);
  check("session glissante de 20 minutes (au lieu de 4)", maxAge === 1200, `${auth?.slice(0, 80)}`);

  console.log("\n▶ 3. Numérotation sans doublon");
  const { s: p } = await login("president@test.ne", SEED_PW);
  const caisse = D(await p.req("POST", "/api/treasury-accounts", { label: `Caisse asso ${Date.now()}`, type: "cash", openingBalance: 0, openingDate: "2025-01-01" }))._id;
  const don = amount => ({ amount, date: new Date().toISOString(), donorType: "anonymous", treasuryAccountId: caisse, paymentMethod: "cash" });
  const dons = await Promise.all(Array.from({ length: 6 }, (_, k) => p.req("POST", "/api/dons", don(1000 + k))));
  const nums = dons.map(r => D(r).receiptNumber);
  check("6 dons enregistrés en même temps : 6 reçus, 6 numéros différents", dons.every(r => r.status === 201) && new Set(nums).size === 6 && nums.every(n => new RegExp(`^DON-${year}-\\d{5}$`).test(n)), J(dons.map(r => [r.status, D(r).receiptNumber ?? r.data?.error])));
  const last = [...nums].sort().pop();
  const victim = dons.find(r => D(r).receiptNumber !== last);
  const del = await p.req("DELETE", `/api/dons/${D(victim)._id}`);
  const after = await p.req("POST", "/api/dons", don(500));
  const allNums = (await db(d => d.collection("donations").find({ receiptNumber: new RegExp(`^DON-${year}-`) }).toArray())).map(x => x.receiptNumber);
  check("après une suppression, le reçu suivant ne reprend aucun numéro existant", [200, 204].includes(del.status) && after.status === 201 && new Set(allNums).size === allNums.length && D(after).receiptNumber > last, `${del.status} ${D(after).receiptNumber} ${last}`);

  const members = [];
  for (let k = 0; k < 4; k++) members.push(D(await p.req("POST", "/api/membres", { firstName: "Awa", lastName: `Test ${k}`, code: `M-${Date.now()}-${k}`, membershipType: "actif", joinDate: new Date().toISOString().slice(0, 10) })));
  const cots = await Promise.all(members.map(m => p.req("POST", "/api/cotisations", { memberId: m._id, year, amount: 5000 })));
  check("4 cotisations simultanées : 4 reçus distincts", cots.every(r => r.status === 201) && new Set(cots.map(r => D(r).receiptNumber)).size === 4, J(cots.map(r => [r.status, D(r).receiptNumber ?? r.data?.error])));
  // La suite efface la base avant chaque scénario, après le démarrage du serveur :
  // l'index que Mongoose (ou npm run indexes) pose en production est recréé ici.
  await db(d => d.collection("memberships").createIndex({ tenantId: 1, memberId: 1, year: 1 }, { unique: true }));
  const twice = await p.req("POST", "/api/cotisations", { memberId: members[0]._id, year, amount: 5000 });
  check("cotisation déjà enregistrée pour l'année : conflit lisible (409), pas une erreur interne", twice.status === 409 && /existe déjà/.test(twice.data?.error ?? ""), `${twice.status} ${twice.data?.error}`);

  const letters = await Promise.all(Array.from({ length: 5 }, (_, k) => g.req("POST", "/api/courriers", { subject: `Courrier simultané ${k}`, direction: "out" })));
  const refs = letters.map(r => D(r).reference);
  check("5 courriers simultanés : 5 références distinctes", letters.every(r => r.status === 201) && new Set(refs).size === 5 && refs.every(x => new RegExp(`^CR-${year}-\\d{4}$`).test(x)), J(letters.map(r => [r.status, D(r).reference ?? r.data?.error])));
  const manual = await g.req("POST", "/api/courriers", { subject: "Référence saisie", reference: `CR-${year}-9999`, direction: "out" });
  const next = await g.req("POST", "/api/courriers", { subject: "Après la saisie manuelle", direction: "out" });
  check("une référence saisie à la main est respectée, la série continue sans la reprendre", manual.status === 201 && D(manual).reference === `CR-${year}-9999` && D(next).reference !== `CR-${year}-9999`, `${D(manual).reference} ${D(next).reference}`);

  console.log("\n▶ 5. Erreurs internes jamais renvoyées");
  const { s: o } = await login("ordonnateur@test.ne", SEED_PW);
  const bad = await o.req("POST", "/api/services", { name: "Service", price: "pas un nombre", unitPrice: "x" });
  const msg = String(bad.data?.error ?? "");
  check("donnée invalide : 400 lisible, sans le message brut de la base", bad.status === 400 && !/validation failed|Cast to|Path `/.test(msg), `${bad.status} ${msg}`);

  console.log("\n▶ 1. Caisse rapide idempotente");
  const desk = D(await g.req("POST", "/api/comptoir/desks", { name: "Comptoir cohérence" }))._id;
  const item = D(await g.req("POST", "/api/comptoir/items", { deskId: desk, name: "Café", unit: "tasse", quantity: 50, unitCost: 100, salePrice: 250 }));
  const ref = `ref${Date.now()}abc`;
  const body = { deskId: desk, clientRef: ref, lines: [{ itemId: item._id, quantity: 2 }], payMethod: "cash" };
  const h = { "X-Kanoo-Offline": "page", "Idempotency-Key": `sale-${ref}` };
  const [a, b] = await Promise.all([g.req("POST", "/api/comptoir/sales", body, h), g.req("POST", "/api/comptoir/sales", body, h)]);
  const again = await g.req("POST", "/api/comptoir/sales", body, h);
  const count = await db(d => d.collection("comptoirsales").countDocuments({ clientRef: ref }));
  check("le même ticket envoyé trois fois (dont deux en même temps) : un seul ticket, trois réponses positives", count === 1 && [a, b, again].every(r => r.status >= 200 && r.status < 300), `${count} ${a.status} ${b.status} ${again.status}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
