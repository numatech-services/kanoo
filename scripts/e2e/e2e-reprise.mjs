// Scénario de bout en bout : reprise de la comptabilité (export complet, effacement, verrouillage, refus des annulations antérieures).
import { readFileSync } from "fs";
import { createRequire } from "module";
import { createHash } from "crypto";
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
  return { req, cookie, reset: () => { csrf = ""; } };
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

const today = new Date().toISOString().slice(0, 10);
const id = r => D(r)?._id;



(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: cpt } = await login("comptable@test.ne", SEED_PW);
  const JSZip = createRequire(`${ROOT}/package.json`)("jszip");

  console.log("\n▶ Données avant reprise");
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque reprise", type: "bank", openingBalance: 1000000, openingDate: "2025-01-01" }));
  const cli = id(await g.req("POST", "/api/clients", { code: "C-REP", name: "Client reprise" }));
  const ct = id(await g.req("POST", "/api/contracts", { title: "Marché reprise", type: "client", clientId: cli, amount: 1000000, tvaRate: 0.19 }));
  await g.req("POST", `/api/contracts/${ct}/sign`, { signerName: "Gérant", signerRole: "Gérant", signedDate: today });
  const inv = D(await g.req("POST", `/api/contracts/${ct}/invoice`, { mode: "standard", amountHT: 500000 })).invoice;
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  const pay = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 100000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  await g.req("POST", "/api/achats", { kind: "cash", payee: "Taxi", date: today, lines: [{ description: "Course", accountCode: "618000", amountHT: 5000 }], payment: { treasuryAccountId: bank } });
  const foreign = await withDb(ROOT, async db => {
    const t = await db.collection("tenants").findOne({ slug: "asso-test" });
    await db.collection("accountingentries").insertOne({ tenantId: t._id, journalCode: "OD", entryDate: new Date(), reference: "TEMOIN-AUTRE-ORG", label: "Témoin", lines: [] });
    return t._id;
  });
  check("règlement enregistré", pay.status < 300, J(pay.data).slice(0, 160));

  console.log("\n▶ Droits et préalables");
  let p = D(await g.req("GET", "/api/accounting/restart"));
  check("aperçu : écritures et mouvements comptés", p.counts?.find(c => c.key === "entries")?.count > 0 && p.counts.find(c => c.key === "movements")?.count > 0, J(p.counts));
  check("comptable : reprise refusée", (await cpt.req("GET", "/api/accounting/restart")).status === 403 && (await cpt.req("POST", "/api/accounting/restart", {})).status === 403);
  check("aperçu : jamais d'empreinte d'archive", !J(p).includes("exportHash"));
  check("sans export : refusé", (await g.req("POST", "/api/accounting/restart", { confirm: "REPRENDRE", restartDate: today })).status === 400);

  console.log("\n▶ Export complet");
  const res = await fetch(`${BASE}/api/accounting/restart?export=1`, { headers: { cookie: g.cookie?.() ?? "" } });
  let zipOk = false, secrets = true, exportId = res.headers.get("x-export-id"), exportHash = "";
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    exportHash = createHash("sha256").update(buf).digest("hex");
    const zip = await JSZip.loadAsync(buf);
    const users = JSON.parse(await zip.file("users.json")?.async("string") ?? "[]");
    zipOk = !!zip.file("accountingentries.json") && !!zip.file("invoices.json") && users.length > 0;
    secrets = /passwordHash|refreshToken/.test(await zip.file("users.json")?.async("string") ?? "");
    const others = JSON.parse(await zip.file("accountingentries.json").async("string"));
    check("export limité à l'organisation", !others.some(e => e.reference === "TEMOIN-AUTRE-ORG"));
    check("export : types préservés (EJSON)", !!others[0]?._id?.$oid && !!others[0]?.entryDate?.$date, J(others[0]?._id));
  }
  check("export : archive avec écritures, factures, utilisateurs", res.status === 200 && zipOk && !!exportId, String(res.status));
  check("export : mots de passe et jetons retirés", !secrets);

  console.log("\n▶ Effacement");
  check("confirmation absente : refusé", (await g.req("POST", "/api/accounting/restart", { exportId, exportHash, confirm: "oui" })).status === 400);
  check("archive non reçue (empreinte fausse) : refusé", (await g.req("POST", "/api/accounting/restart", { exportId, exportHash: "0".repeat(64), confirm: "REPRENDRE" })).status === 400);
  await g.req("POST", "/api/achats", { kind: "cash", payee: "Après export", date: today, lines: [{ description: "Course", accountCode: "618000", amountHT: 1000 }], payment: { treasuryAccountId: bank } });
  check("saisie après l'export : effacement refusé", (await g.req("POST", "/api/accounting/restart", { exportId, exportHash, confirm: "REPRENDRE" })).status === 400);
  const res2 = await fetch(`${BASE}/api/accounting/restart?export=1`, { headers: { cookie: g.cookie?.() ?? "" } });
  const buf2 = Buffer.from(await res2.arrayBuffer());
  exportId = res2.headers.get("x-export-id"); exportHash = createHash("sha256").update(buf2).digest("hex");
  const [ra, rb] = await Promise.all([g.req("POST", "/api/accounting/restart", { exportId, exportHash, confirm: "REPRENDRE" }), g.req("POST", "/api/accounting/restart", { exportId, exportHash, confirm: "REPRENDRE" })]);
  const r = ra.status === 200 ? ra : rb;
  check("deux effacements simultanés : un seul passe", [ra.status, rb.status].sort().join() === "200,400", `${ra.status} ${rb.status}`);
  check("reprise effectuée", r.status === 200 && D(r).deleted?.entries > 0, J(r.data).slice(0, 200));
  check("export déjà utilisé : refusé", (await g.req("POST", "/api/accounting/restart", { exportId, exportHash, confirm: "REPRENDRE" })).status === 400);
  p = D(await g.req("GET", "/api/accounting/restart"));
  check("plus rien à effacer", p.counts.every(c => c.count === 0), J(p.counts));
  const accounts = D(await g.req("GET", "/api/treasury-accounts")).items ?? [];
  check("trésorerie remise à zéro", accounts.find(a => a._id === bank)?.balance === 0, J(accounts.map(a => [a.label, a.balance])));
  check("factures gardées", (await g.req("GET", `/api/invoices/${inv._id}`)).status === 200);
  check("autre organisation intacte", await withDb(ROOT, db => db.collection("accountingentries").countDocuments({ tenantId: foreign, reference: "TEMOIN-AUTRE-ORG" })) === 1);

  console.log("\n▶ Après la reprise");
  const cancel = await g.req("POST", `/api/payments/${id(pay)}/cancel`, { reason: "Erreur" });
  check("règlement antérieur : annulation refusée", cancel.status === 400 && /reprise/.test(J(cancel.data)), `${cancel.status} ${J(cancel.data).slice(0, 160)}`);
  const late = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: "2020-01-01", reference: "AVANT", label: "Avant reprise", lines: [{ accountCode: "471000", accountLabel: "Attente", debit: 10, credit: 0 }, { accountCode: "658000", accountLabel: "Divers", debit: 0, credit: 10 }] });
  check("écriture avant la date de reprise : refusée", late.status >= 400, String(late.status));
  const pay2 = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 50000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  const after = (D(await g.req("GET", "/api/treasury-accounts")).items ?? []).find(a => a._id === bank)?.balance;
  check("nouvel encaissement après reprise : comptabilisé", pay2.status < 300 && after === 50000, `${pay2.status} ${after}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
