// Scénario de bout en bout : scellement des écritures et du journal, altérations détectées, rapport d'audit mensuel.
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
import { withDb } from "./db.mjs";
import { execSync } from "child_process";
const today = new Date().toISOString().slice(0, 10);
const KEY = /JWT_SECRET='([^']+)'/.exec(readFileSync(`${ROOT}/.claude/launch.json`, "utf-8"))?.[1] ?? "";
// Serveur en mode production (E2E_PROD=1) : même clé de scellement que lui.
const SEAL_KEY = process.env.E2E_PROD === "1" ? (/AUDIT_SEAL_KEY='([^']+)'/.exec(readFileSync(`${ROOT}/.claude/launch.json`, "utf-8"))?.[1] ?? "") : "";
const run = (mode, offset) => execSync(`npx tsx scripts/e2e/audit-seal-now.ts ${mode} ${offset}`, { cwd: ROOT, env: { ...process.env, JWT_SECRET: KEY, ...(SEAL_KEY ? { AUDIT_SEAL_KEY: SEAL_KEY } : {}) }, encoding: "utf-8" }).trim();
const SETTLE = 15 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = new Date(), YM = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
// Vérification complète lancée hors de l'écran (sans limite de fréquence), puis lecture du rapport.
const report = async (s) => { run("verify", 0); for (let k = 0; ; k++) { try { return D(await s.req("GET", `/api/audit/report?year=${YM.y}&month=${YM.m}`)); } catch (e) { if (k >= 3) throw e; await sleep(3000); } } };
const ent = c => c.integrity?.find(x => x.kind === "entries");

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(500); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  let { s: cpt } = await login("comptable@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const od = (ref, amt) => g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: ref, label: ref, lines: [{ accountCode: "627000", accountLabel: "Publicité", debit: amt }, { accountCode: "471000", accountLabel: "Divers", credit: amt }] });
  const e1 = id(await od("AUD-1", 10000)), e2 = id(await od("AUD-2", 20000)), e3 = id(await od("AUD-3", 30000)), e4 = id(await od("AUD-4", 40000));
  check("écritures de test créées", [e1, e2, e3, e4].every(Boolean));

  console.log("\n▶ Scellement");
  const out = run("seal", SETTLE + 1000);
  check("scellement : pièces scellées", /pièce\(s\) scellée\(s\)/.test(out), out);
  await sleep(2500);
  let r = await report(g);
  check("intégrité sans anomalie après scellement", ent(r)?.seals >= 1 && ent(r).items >= 4 && ent(r).problems.length === 0 && r.counts.Critique === 0, J(ent(r)).slice(0, 300));
  check("empreinte du dernier sceau publiée (64 caractères)", /^[0-9a-f]{64}$/.test(ent(r)?.lastHash ?? ""), ent(r)?.lastHash);
  check("journal d'audit scellé lui aussi", r.integrity.find(x => x.kind === "audit")?.seals >= 1);
  const e5 = id(await od("AUD-5", 50000));
  run("seal", SETTLE + 1000);
  await sleep(2500);
  r = await report(g);
  const seq2 = ent(r).lastSeq, hash2 = ent(r).lastHash;
  check("second sceau chaîné, toujours sans anomalie", seq2 === 2 && ent(r).problems.length === 0, J(ent(r)).slice(0, 200));
  const anc = D(await g.req("GET", `/api/audit/seal?kind=entries&seq=${seq2}&hash=${hash2}`));
  check("empreinte notée : reconnue", anc.match === true, J(anc));
  const rep = run("report", 0);
  const prev = new Date(Date.UTC(YM.y, YM.m - 2, 1));
  const snap = await g.req("GET", `/api/audit/report?year=${prev.getUTCFullYear()}&month=${prev.getUTCMonth() + 1}`);
  check("rapport du mois écoulé figé avec son empreinte", /rapport/.test(rep) && /^[0-9a-f]{64}$/.test(D(snap).snapshot?.hash ?? "") && D(snap).heads?.some(h => h.seq === seq2), `${rep} ${J(D(snap).snapshot)}`);

  console.log("\n▶ Altérations");
  const noReason = await g.req("PATCH", `/api/accounting-entries/${e1}`, { label: "Libellé sans motif" });
  check("modification sans motif : refusée", noReason.status === 400 && /motif/i.test(noReason.data?.error ?? ""), `${noReason.status} ${noReason.data?.error}`);
  const shortReason = await g.req("PATCH", `/api/accounting-entries/${e1}`, { label: "Libellé corrigé", reason: "x" });
  check("motif trop court : refusé", shortReason.status === 400 && /5 caractères/.test(shortReason.data?.error ?? ""), `${shortReason.status} ${shortReason.data?.error}`);
  const mixed = await g.req("PATCH", `/api/accounting-entries/${e1}`, { label: "Libellé corrigé", imputations: [{}, {}], reason: "Deux corrections à la fois" });
  check("libellé et imputation dans la même demande : refusé", mixed.status === 400 && /deux fois/.test(mixed.data?.error ?? ""), `${mixed.status} ${mixed.data?.error}`);
  const lab = await g.req("PATCH", `/api/accounting-entries/${e1}`, { label: "Libellé corrigé", reason: "Faute de frappe sur la pièce" });
  const sameLab = await g.req("PATCH", `/api/accounting-entries/${e1}`, { label: "Libellé corrigé", reason: "Même libellé renvoyé" });
  check("libellé identique : refusé (pas d'entrée vide au journal)", sameLab.status === 400 && /Rien à modifier/.test(sameLab.data?.error ?? ""), `${sameLab.status} ${sameLab.data?.error}`);
  const impSet = await g.req("PATCH", `/api/accounting-entries/${e4}`, { imputations: [{ costCenter: "admin" }, {}], reason: "Rattachement à l'administration" });
  const imp = impSet.status === 200 ? await g.req("PATCH", `/api/accounting-entries/${e4}`, { imputations: [{}, {}], reason: "Imputation analytique retirée" }) : impSet;
  await withDb(ROOT, async db => {
    const col = db.collection("accountingentries");
    const d2 = await col.findOne({ reference: "AUD-2" });
    await col.updateOne({ _id: d2._id }, { $set: { "lines.0.debit": 25000, "lines.1.credit": 25000 } });
    await col.deleteOne({ reference: "AUD-3" });
    const d4 = await col.findOne({ reference: "AUD-4" });
    await col.updateOne({ _id: d4._id }, { $set: { "lines.0.debit": 45000, "lines.1.credit": 45000 } });
    const d1 = await col.findOne({ reference: "AUD-1" });
    const ObjectId = d1._id.constructor;
    await col.insertOne({ ...d1, _id: ObjectId.createFromTime(Math.floor(d1._id.getTimestamp().getTime() / 1000)), reference: "AUD-GLISSEE" });
  });
  r = await report(g);
  const pb = ent(r)?.problems ?? [];
  const audit1 = (D(await g.req("GET", `/api/audit-logs?resource=accountingEntries&limit=5`)).items ?? [])[0];
  check("libellé modifié par l'application : tracé, ancienne valeur gardée", lab.status === 200 && pb.some(p => p.id === e1 && p.type === "modified" && p.traced === true), J(pb));
  check("montant modifié en base : altération non tracée", pb.some(p => p.id === e2 && p.type === "modified" && p.traced === false), J(pb));
  check("réimputation tracée puis montant modifié en base : reste critique", imp.status === 200 && pb.some(p => p.id === e4 && p.type === "modified" && p.traced === false), `${imp.status} ${J(pb)}`);
  check("écriture supprimée en base : détectée", pb.some(p => p.id === e3 && p.type === "deleted"), J(pb));
  check("écriture glissée dans une plage scellée : détectée", pb.some(p => p.type === "inserted"), J(pb));
  check("écriture intacte : non signalée", !pb.some(p => p.id === e5), J(pb));
  check("constat critique d'intégrité au rapport", r.findings.some(f => f.severity === "Critique" && /Intégrité/.test(f.check)), J(r.findings.map(f => f.check)));
  void audit1;
  const labLog = (D(await g.req("GET", `/api/audit-logs?resourceId=${e1}&limit=10`)).items ?? []).find(l => l.after?.label === "Libellé corrigé");
  check("journal : motif, ancienne et nouvelle valeur du libellé, pièce visée", labLog?.metadata?.reason === "Faute de frappe sur la pièce" && typeof labLog?.before?.label === "string" && labLog.before.label !== "Libellé corrigé" && labLog?.metadata?.entry?.reference === "AUD-1", J(labLog));
  const impLog = (D(await g.req("GET", `/api/audit-logs?resourceId=${e4}&limit=10`)).items ?? []).find(l => l.metadata?.action === "reimpute" && l.metadata?.reason === "Imputation analytique retirée");
  check("journal : motif et avant / après de la réimputation", !!impLog && impLog.before?.imputations?.[0]?.costCenter === "admin", J(impLog));
  const badId = D(await g.req("GET", `/api/audit-logs?resourceId=pas-un-id&limit=5`)).items ?? [];
  check("historique : identifiant invalide → aucune entrée", badId.length === 0, J(badId).slice(0, 120));

  console.log("\n▶ Journal : ligne antidatée, changement de rôle");
  await withDb(ROOT, async db => {
    const col = db.collection("auditlogs");
    const any = await col.findOne({});
    const ObjectId = any._id.constructor;
    await col.insertOne({ tenantId: any.tenantId, userEmail: "intrus@x.ne", action: "DELETE", resource: "accountingEntries", createdAt: new Date(Date.now() - 40 * 86400000), _id: new ObjectId() });
  });
  run("seal", SETTLE + 1000);
  await sleep(1500);
  r = await report(g);
  check("ligne du journal antidatée : détectée", (r.integrity.find(x => x.kind === "audit")?.problems ?? []).some(p => p.type === "backdated"), J(r.integrity.find(x => x.kind === "audit")?.problems?.slice(0, 3)));
  const users = D(await g.req("GET", "/api/users")).items ?? D(await g.req("GET", "/api/users")) ?? [];
  const cu = (Array.isArray(users) ? users : []).find(u => u.email === "comptable@test.ne");
  const rc = cu ? await g.req("PATCH", `/api/users/${cu._id}`, { isActive: false }) : { status: 0 };
  if (cu) await g.req("PATCH", `/api/users/${cu._id}`, { isActive: true });
  ({ s: cpt } = await login("comptable@test.ne", SEED_PW)); // sa session a été fermée par la désactivation
  r = await report(g);
  check("compte désactivé puis réactivé : signalé avec l'avant / après", rc.status === 200 && r.findings.some(f => /Comptes et rôles/.test(f.check) && (f.items ?? []).some(i => /désactivé|réactivé/.test(i))), `${rc.status} ${J(r.findings.find(f => /Comptes/.test(f.check)))}`);

  console.log("\n▶ Chaîne supprimée puis refaite");
  await withDb(ROOT, async db => {
    await db.collection("auditseals").deleteOne({ kind: "entries", seq: seq2 });
    await db.collection("accountingentries").updateOne({ reference: "AUD-5" }, { $set: { "lines.0.debit": 55000, "lines.1.credit": 55000 } });
  });
  run("seal", 30 * 3600 * 1000);
  r = await report(g);
  check("rescellement tardif signalé (sceau refait plus de 26 h après ses pièces)", r.findings.some(f => /Scellement tardif/.test(f.check)), J(r.findings.map(f => f.check)));
  check("chaîne différente de l'empreinte publiée au rapport : critique", r.findings.some(f => f.severity === "Critique" && /publiée/.test(f.check)), J(r.findings.map(f => f.check)));
  const anc2 = D(await g.req("GET", `/api/audit/seal?kind=entries&seq=${seq2}&hash=${hash2}`));
  check("empreinte notée : ne correspond plus", anc2.match === false, J(anc2));
  await withDb(ROOT, async db => { await db.collection("auditseals").updateOne({ kind: "entries", seq: 1 }, { $set: { contentHash: "f".repeat(64) } }); });
  r = await report(g);
  check("sceau réécrit en base : signature invalide", (ent(r)?.problems ?? []).some(p => p.type === "signature"), J(ent(r)?.problems?.slice(0, 3)));

  console.log("\n▶ Droits et cloisonnement");
  check("revue des droits : comptes, rôles et double authentification", r.users.list.length >= 2 && r.users.list.every(u => Array.isArray(u.roles) && typeof u.twoFactor === "boolean"), J(r.users).slice(0, 200));
  check("administrateur sans double authentification signalé", r.findings.some(f => /double authentification/.test(f.check)), J(r.findings.map(f => f.check)));
  check("période invalide refusée", (await g.req("GET", "/api/audit/report?year=2026&month=13")).status === 400);
  check("comptable : rapport accessible", (await cpt.req("GET", `/api/audit/report?year=${YM.y}&month=${YM.m}`)).status === 200);
  const o = D(await other.req("GET", `/api/audit/report?year=${YM.y}&month=${YM.m}&live=1`));
  check("autre organisation : aucune anomalie ni compte importés", (ent(o)?.problems ?? []).length === 0 && !(o.users?.list ?? []).some(u => u.email === "admin@test.ne"), J(ent(o)).slice(0, 200));
  const cs = await cpt.req("POST", "/api/audit/seal", {});
  check("scellement manuel : réservé à l'administrateur", cs.status === 403, String(cs.status));
  const anon = await fetch(`${BASE}/api/audit/report`);
  check("sans connexion : refusé", anon.status === 401 || anon.status === 403, String(anon.status));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
