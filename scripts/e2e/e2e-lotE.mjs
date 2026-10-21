// Scénario de bout en bout : lot E — limitation de débit partagée (en base),
// pièces jointes sur stockage S3, lecture de facture (faux service Claude),
// journal des erreurs, contrôles de sécurité.
// Exige les faux services (scripts/e2e/fake-services.mjs) et, côté serveur :
// ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL → faux service, STORAGE_S3_* → faux S3.
import { readFileSync } from "fs";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const FAKE = process.env.FAKE_SERVICES_URL || "http://127.0.0.1:4599";
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
const today = new Date().toISOString().slice(0, 10);
// Plus petit PNG valide (1×1), pour la lecture de facture.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

  console.log("\n▶ Limitation de débit partagée");
  const tries = [];
  for (let i = 0; i < 6; i++) { const s = session(); tries.push((await s.req("POST", "/api/auth/login", { email: "comptable@test.ne", password: "pas-le-bon" })).status); }
  check("compte verrouillé après 5 échecs (429 au 6e)", tries.slice(0, 5).every(s => s === 401) && tries[5] === 429, J(tries));
  const buckets = await withDb(ROOT, db => db.collection("ratelimitbuckets").find({}).toArray());
  check("compteurs tenus en base (partagés entre instances, survivent au redémarrage)", buckets.some(b => b._id === "login:account:comptable@test.ne" && b.count >= 6 && b.expireAt), J(buckets.map(b => b._id)));

  const { s: g } = await login("admin@test.ne", SEED_PW);

  console.log("\n▶ Pièces jointes sur stockage S3");
  const sup = D(await g.req("POST", "/api/suppliers", { code: "F-QF", name: "Quincaillerie du Fleuve", nif: "NIF-QF-2026", paymentTermDays: 30 }));
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup._id, date: today, lines: [{ description: "Fournitures", accountCode: "604000", quantity: 1, unitPrice: 10000, tvaRate: 0 }] }));
  const pdf = Buffer.from("%PDF-1.4\n% Facture de test Kanoo\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), "facture-test.pdf");
  fd.append("host", "purchases"); fd.append("hostId", pur._id); fd.append("category", "facture");
  const up = await g.req("POST", "/api/attachments", fd);
  check("pièce jointe déposée", up.status === 201 || up.status === 200, J(up.data));
  const keys = await (await fetch(`${FAKE}/__s3`)).json();
  check("fichier dans le compartiment (préfixe uploads/), pas sur le disque", keys.some(k => k.startsWith("kanoo-test/uploads/") && k.endsWith(".pdf")), J(keys));
  const attId = D(up)._id;
  const dl = await g.req("GET", `/api/attachments/${attId}`);
  check("relue depuis S3 à l'identique", dl.status === 200 && Buffer.isBuffer(dl.data) && dl.data.equals(pdf), `${dl.status} ${dl.data?.length}`);
  const del = await g.req("DELETE", `/api/attachments/${attId}`);
  const keysAfter = await (await fetch(`${FAKE}/__s3`)).json();
  check("suppression : l'objet quitte le compartiment", (del.status === 200 || del.status === 204) && !keysAfter.some(k => k.endsWith(".pdf")), `${del.status} ${J(keysAfter)}`);

  console.log("\n▶ Lecture de facture (faux service Claude)");
  const st = await g.req("GET", "/api/ai/lire-facture");
  check("lecture disponible (clé configurée)", D(st).configured === true, J(st.data));
  const before = D(st).quota?.remaining;
  const fd2 = new FormData(); fd2.append("file", new Blob([PNG], { type: "image/png" }), "photo.png");
  const rd = await g.req("POST", "/api/ai/lire-facture", fd2);
  const x = D(rd);
  check("extraction renvoyée", rd.status === 200 && x.invoice?.invoiceNumber === "F-2026-118" && x.invoice.lines.length === 2, J(rd.data));
  check("fournisseur reconnu par son NIF", x.supplier?._id === sup._id, J(x.supplier));
  check("comptes et TVA conservés, aucun écart signalé", x.invoice?.lines[0].accountCode === "604000" && x.invoice?.lines[0].tvaRate === 0.19 && x.invoice?.lines[1].accountCode === "611000" && x.warnings?.length === 0, J(x.warnings));
  check("un crédit du quota consommé", typeof before === "number" && x.quota?.remaining === before - 1, `${before} → ${x.quota?.remaining}`);
  const fake = await (await fetch(`${FAKE}/__anthropic`)).json();
  check("requête : modèle, sortie structurée (json_schema), repli serveur", fake.last?.model === "claude-opus-5-5" && fake.last?.outputConfig?.format?.type === "json_schema" && fake.last?.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(fake.last?.headers?.beta ?? ""), J(fake.last));
  check("image transmise avec son type réel", fake.last?.contentTypes?.[0] === "image" && fake.last?.mediaType === "image/png", J(fake.last?.contentTypes));
  const fd3 = new FormData(); fd3.append("file", new Blob([Buffer.from("bonjour")], { type: "image/png" }), "faux.png");
  const bad = await g.req("POST", "/api/ai/lire-facture", fd3);
  check("faux fichier (type annoncé mensonger) refusé sans appel à l'IA", bad.status === 400 && (await (await fetch(`${FAKE}/__anthropic`)).json()).calls === fake.calls, J(bad.data));

  console.log("\n▶ Journal des erreurs");
  const r1 = await fetch(`${BASE}/api/client-errors`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ message: "TypeError: x is undefined (test e2e)", url: "/dashboard?jeton=secret", stack: "at f (app.js:1:2)" }) });
  check("erreur navigateur reçue (même origine)", r1.status === 204, String(r1.status));
  const r2 = await fetch(`${BASE}/api/client-errors`, { method: "POST", headers: { "content-type": "application/json", origin: "https://ailleurs.example" }, body: JSON.stringify({ message: "x" }) });
  check("autre origine refusée", r2.status === 403, String(r2.status));
  for (let i = 0; i < 2; i++) await fetch(`${BASE}/api/client-errors`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ message: "TypeError: x is undefined (test e2e)", url: "/dashboard" }) });
  check("un non super-administrateur ne lit pas le journal", (await g.req("GET", "/api/superadmin/errors")).status === 403);
  const { s: sa } = await login("super@test.ne", SEED_PW);
  const el = D(await sa.req("GET", "/api/superadmin/errors?source=client"));
  const item = el.items?.find(e => /test e2e/.test(e.message));
  check("regroupée : 3 occurrences, une seule ligne", item?.count === 3, J(el.items?.map(e => [e.message, e.count])));
  check("paramètres de requête jamais conservés (jetons)", item && !/jeton|secret/.test(item.url ?? ""), item?.url);
  const res = await sa.req("PATCH", "/api/superadmin/errors", { id: item?._id, resolved: true });
  check("marquée résolue", res.status === 200 && !(D(await sa.req("GET", "/api/superadmin/errors?source=client")).items ?? []).some(e => e._id === item?._id));
  await fetch(`${BASE}/api/client-errors`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ message: "TypeError: x is undefined (test e2e)" }) });
  check("rouverte si elle se reproduit", (D(await sa.req("GET", "/api/superadmin/errors?source=client")).items ?? []).some(e => e._id === item?._id));
  const dg = await (await fetch(`${BASE}/api/cron?job=error-digest`, { headers: { "x-cron-key": process.env.CRON_SECRET } })).json();
  check("résumé quotidien envoyé aux super-administrateurs", /groupe\(s\) d'erreurs, résumé envoyé à 1/.test(dg.ran?.[0]?.summary ?? ""), J(dg));

  console.log("\n▶ Contrôles de sécurité");
  const post = D(await sa.req("GET", "/api/superadmin/security/posture"));
  const ctl = k => post.controls?.find(c => c.key === k);
  check("stockage des pièces jointes : S3", ctl("storage")?.level === "ok" && /S3/.test(ctl("storage")?.value ?? ""), J(ctl("storage")));
  check("sauvegarde : configurée et chiffrée", ctl("backup")?.level === "ok", J(ctl("backup")));
  check("modèles WhatsApp et erreurs suivis", Boolean(ctl("whatsapp")) && Boolean(ctl("errors")), J(post.controls?.map(c => c.key)));
  const auto = D(await g.req("GET", "/api/automations"));
  check("état des modèles WhatsApp exposé aux réglages", auto.channels?.whatsappTemplates && "brief" in auto.channels.whatsappTemplates, J(auto.channels));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
