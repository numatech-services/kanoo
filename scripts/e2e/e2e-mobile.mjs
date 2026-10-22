// Scénario de bout en bout : API de l'application mobile — connexion par
// jeton (Authorization: Bearer), double authentification sans cookie, tableau
// de bord en JSON, et non-régression de la session web (cookies + CSRF).
import { readFileSync } from "fs";
import crypto from "crypto";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);
const MOBILE = { "content-type": "application/json", "x-kanoo-client": "mobile" };

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${BASE}${path}`, { method, redirect: "manual", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookies: res.headers.getSetCookie?.() ?? [] };
}
const bearer = t => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

// TOTP (RFC 6238, SHA-1, 30 s, 6 chiffres) — comme une application d'authentification.
function totp(b32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = ""; for (const c of b32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

  console.log("\n▶ Connexion mobile");
  const lg = await call("POST", "/api/auth/login", { headers: MOBILE, body: { email: "admin@test.ne", password: SEED_PW } });
  const token = lg.data?.data?.token;
  check("jeton rendu dans la réponse", lg.status === 200 && typeof token === "string" && token.split(".").length === 3, J(lg.data));
  check("aucun cookie de session posé pour le mobile", !lg.cookies.some(c => c.startsWith("auth_token=")), J(lg.cookies));
  const bad = await call("POST", "/api/auth/login", { headers: MOBILE, body: { email: "admin@test.ne", password: "faux" } });
  check("mauvais mot de passe : 401, pas de jeton", bad.status === 401 && !bad.data?.data?.token);

  console.log("\n▶ API par jeton");
  const home = await call("GET", "/api/dashboard/home", { headers: bearer(token) });
  check("tableau de bord en JSON (mêmes données que le web)", home.status === 200 && home.data?.data?.limited === false && "kpis" in home.data.data && "treasury" in home.data.data, J(home.data).slice(0, 300));
  const inv = await call("GET", "/api/invoices?limit=5", { headers: bearer(token) });
  check("liste des factures", inv.status === 200 && Array.isArray(inv.data?.data?.items ?? inv.data?.data), J(inv.data).slice(0, 200));
  check("sans jeton : 401", (await call("GET", "/api/dashboard/home")).status === 401);
  check("jeton falsifié : 401", (await call("GET", "/api/dashboard/home", { headers: bearer(token.slice(0, -4) + "AAAA") })).status === 401);
  const cl = await call("POST", "/api/clients", { headers: bearer(token), body: { code: "C-MOB", name: "Client mobile" } });
  check("écriture par jeton sans CSRF (le Bearer n'est pas un cookie)", cl.status === 201 || cl.status === 200, J(cl.data));
  const me = await call("GET", "/api/auth/me", { headers: bearer(token) });
  check("profil (/api/auth/me)", me.status === 200 && me.data?.data?.user?.email === "admin@test.ne", J(me.data).slice(0, 200));
  const { status: limitedStatus, data: limited } = await (async () => {
    const t = (await call("POST", "/api/auth/login", { headers: MOBILE, body: { email: "president@test.ne", password: SEED_PW } })).data?.data?.token;
    return call("GET", "/api/dashboard/home", { headers: bearer(t) });
  })();
  check("profil association : données selon ses droits", limitedStatus === 200 && typeof limited?.data?.limited === "boolean", J(limited).slice(0, 200));

  console.log("\n▶ Session web inchangée");
  const web = await call("POST", "/api/auth/login", { headers: { "content-type": "application/json" }, body: { email: "admin@test.ne", password: SEED_PW } });
  const cookie = web.cookies.map(c => c.split(";")[0]).join("; ");
  check("connexion web : cookie de session, pas de jeton dans la réponse", web.status === 200 && /auth_token=/.test(cookie) && !web.data?.data?.token, J(web.data));
  const noCsrf = await call("POST", "/api/clients", { headers: { "content-type": "application/json", cookie }, body: { code: "C-WEB", name: "Sans CSRF" } });
  check("cookie sans jeton CSRF : toujours refusé (403)", noCsrf.status === 403, `${noCsrf.status} ${J(noCsrf.data)}`);

  console.log("\n▶ Double authentification sur mobile");
  const setup = await call("POST", "/api/auth/2fa/setup", { headers: bearer(token) });
  const secret = setup.data?.data?.secret;
  const enable = await call("POST", "/api/auth/2fa/enable", { headers: bearer(token), body: { token: totp(secret) } });
  check("2FA activée pour le compte", enable.status === 200, J(enable.data));
  const step1 = await call("POST", "/api/auth/login", { headers: MOBILE, body: { email: "admin@test.ne", password: SEED_PW } });
  const challenge = step1.data?.data?.challenge;
  check("connexion : code demandé, défi rendu dans la réponse, pas encore de jeton", step1.data?.data?.twoFactorRequired === true && typeof challenge === "string" && !step1.data?.data?.token, J(step1.data));
  const wrong = await call("POST", "/api/auth/2fa/verify", { headers: MOBILE, body: { challenge, token: "000000" } });
  check("mauvais code : refusé", wrong.status === 400, J(wrong.data));
  const ok = await call("POST", "/api/auth/2fa/verify", { headers: MOBILE, body: { challenge, token: totp(secret) } });
  check("bon code : jeton de session rendu", ok.status === 200 && typeof ok.data?.data?.token === "string", J(ok.data));
  check("le jeton obtenu après 2FA ouvre l'API", (await call("GET", "/api/dashboard/home", { headers: bearer(ok.data?.data?.token) })).status === 200);
  const forged = await call("POST", "/api/auth/2fa/verify", { headers: MOBILE, body: { challenge: "faux.defi.signature", token: totp(secret) } });
  check("défi falsifié : refusé", forged.status === 401, J(forged.data));
  const webVerify = await call("POST", "/api/auth/2fa/verify", { headers: { "content-type": "application/json" }, body: { challenge, token: totp(secret) } });
  check("défi dans le corps ignoré hors mobile (le web passe par le cookie)", webVerify.status === 401, J(webVerify.data));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
