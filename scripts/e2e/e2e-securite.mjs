// Scénario de bout en bout : lot H0 (sécurité). Chaque faille relevée par
// l'audit d'octobre 2026 (docs/AUDIT-2026-10.md, S1 à S11) est rejouée et doit
// être refusée.
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


const anon = async (method, p, body, headers = {}) => {
  const r = await fetch(`${BASE}${p}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: sup } = await login("super@test.ne", SEED_PW);
  const { s: asso } = await login("president@test.ne", SEED_PW);

  console.log("\n▶ S1 — tarifs publics");
  const plans0 = D(await anon("GET", "/api/public/plans"));
  check("lecture publique des plans conservée", Array.isArray(plans0));
  const pp = await anon("POST", "/api/public/plans", { code: "pirate", label: "Pirate", priceMonthly: 1 });
  const pa = await anon("PATCH", "/api/public/plans", { _id: "0".repeat(24), priceMonthly: 1 });
  check("création / modification anonymes refusées", pp.status >= 400 && pa.status >= 400, J([pp.status, pa.status]));
  const pg = await g.req("POST", "/api/superadmin/plans", { code: "gerant-plan", label: "X", priceMonthly: 1 });
  check("un gérant ne crée pas de plan", pg.status === 403, pg.status);
  const ps = await sup.req("POST", "/api/superadmin/plans", { code: "test-sec", label: "Plan test", priceMonthly: 15000, maxUsers: 3, targetType: "pme", features: ["a"], tenantId: "x", _id: "y" });
  check("le superadministrateur crée un plan (champs filtrés)", ps.status === 201 && D(ps).code === "test-sec" && !("tenantId" in D(ps)), `${ps.status} ${J(ps.data).slice(0, 160)}`);
  const pu = await sup.req("PATCH", "/api/superadmin/plans", { _id: D(ps)._id, priceMonthly: 20000 });
  const bad = await sup.req("PATCH", "/api/superadmin/plans", { _id: D(ps)._id, priceMonthly: -5 });
  check("modification tracée et validée (prix négatif refusé)", pu.status === 200 && D(pu).priceMonthly === 20000 && bad.status === 400, J([pu.status, bad.status]));

  console.log("\n▶ S2 — verrous comptables");
  const lockR = await g.req("POST", "/api/accounting/closing", { action: "lock", until: "2025-01-31" });
  const lockBefore = D(await g.req("GET", "/api/accounting/closing")).lockedUntil;
  await g.req("PATCH", "/api/companies", { accountingLockedUntil: null, closedFiscalYears: [], aiUsage: { count: 0, monthlyQuota: 999999 }, phone: "+227 20 00 00 00" });
  const after = await withDb(ROOT, db => db.collection("tenants").findOne({ slug: "test-pme" }));
  check("verrou et exercices clos non modifiables par PATCH /api/companies", lockR.status === 200 && !!lockBefore && !!after.accountingLockedUntil && new Date(after.accountingLockedUntil).getTime() === new Date(lockBefore).getTime() && after.phone === "+227 20 00 00 00" && after.aiUsage?.monthlyQuota !== 999999, J({ lockR: lockR.status, before: lockBefore, after: after.accountingLockedUntil, q: after.aiUsage }));

  console.log("\n▶ S3 — compteurs des notes de frais");
  const emp = D(await g.req("POST", "/api/employees", { code: "SEC-1", firstName: "Sec", lastName: "Test", position: "Agent", startDate: "2026-01-01", employeeType: "employee", grossSalary: 100000 }));
  const nf = await g.req("POST", "/api/expenses", { title: "Mission test", employeeId: emp._id, lines: [] });
  let other = null;
  for (const s of [asso, sup]) { const r = await s.req("GET", "/api/expenses"); if (r.status === 200) { other = r.data; break; } }
  const counts = other?.counts ?? other?.data?.counts ?? {};
  const totalOther = other?.pagination?.total ?? other?.data?.pagination?.total ?? 0;
  const sumCounts = Object.values(counts).reduce((a, b) => a + b, 0);
  check("compteurs d'une autre organisation : sa seule volumétrie", nf.status === 201 && other && sumCounts === totalOther, J({ nf: nf.status, counts, totalOther }));

  console.log("\n▶ S4 — création de facture");
  const client = D(await g.req("GET", "/api/clients?limit=1"))?.items?.[0] ?? D(await g.req("GET", "/api/clients?limit=1"))[0];
  const forged = await g.req("POST", "/api/invoices", {
    clientId: client._id, issueDate: "2026-10-01", dueDate: "2026-10-31",
    lines: [{ description: "Prestation", quantity: 1, unitPrice: 100000, tvaRate: 0.19 }],
    secef: { code: "FAUX-CODE", qrPayload: "x" }, creditedAmount: 119000, kind: "deposit", documentType: "credit_note",
    doubtfulAt: "2026-10-01", contractId: "0".repeat(24), retentionAmount: 5000, status: "paid", paidAmount: 119000,
  });
  const fi = D(forged);
  check("champs internes ignorés (SECeF, avoir, acompte, marché, statut)", forged.status === 201 && !fi.secef?.code && !fi.creditedAmount && fi.kind !== "deposit" && (fi.documentType ?? "invoice") !== "credit_note" && !fi.doubtfulAt && !fi.contractId && !fi.retentionAmount && fi.status === "draft" && fi.paidAmount === 0, J({ s: forged.status, secef: fi.secef, kind: fi.kind, doc: fi.documentType, st: fi.status }));

  console.log("\n▶ S5 — références d'une autre organisation");
  const foreignClient = await withDb(ROOT, async db => { const t = await db.collection("tenants").findOne({ slug: "asso-test" }); const r = await db.collection("clients").insertOne({ tenantId: t._id, code: "ETR-1", name: "Client étranger", type: "company" }); return String(r.insertedId); });
  const dv = await g.req("POST", "/api/devis", { clientId: foreignClient, issueDate: "2026-10-01", validUntil: "2026-11-01", lines: [{ description: "x", quantity: 1, unitPrice: 1000 }] });
  check("devis : client d'une autre organisation refusé", dv.status === 400, dv.status);
  const dv2 = D(await g.req("POST", "/api/devis", { clientId: client._id, issueDate: "2026-10-01", validUntil: "2026-11-01", lines: [{ description: "x", quantity: 1, unitPrice: 1000 }], acceptedOnline: { name: "Faux", at: "2026-10-01" }, contractId: "0".repeat(24) }));
  check("devis : preuve d'acceptation et marché non posés par le formulaire", dv2._id && !dv2.acceptedOnline?.name && !dv2.contractId, J({ a: dv2.acceptedOnline, c: dv2.contractId }));
  const foreignUser = await withDb(ROOT, async db => String((await db.collection("users").findOne({ email: "president@test.ne" }))._id));
  const pj1 = await g.req("POST", "/api/projects", { code: "SEC-P1", name: "Projet", clientId: foreignClient });
  const pj2 = await g.req("POST", "/api/projects", { code: "SEC-P2", name: "Projet", teamIds: [foreignUser] });
  const pj3 = await g.req("POST", "/api/projects", { code: "SEC-P3", name: "Projet", clientId: client._id });
  const pj4 = await g.req("PATCH", `/api/projects/${D(pj3)._id}`, { managerId: foreignUser });
  check("projet : client, équipe ou responsable étrangers refusés", pj1.status === 400 && pj2.status === 400 && pj3.status === 201 && pj4.status === 400, J([pj1.status, pj2.status, pj3.status, pj4.status]));
  const { s: ord } = await login("ordonnateur@test.ne", SEED_PW);
  const rc = await ord.req("POST", "/api/recettes", { budgetChapterId: "0".repeat(24), amount: 5000, payerName: "Contribuable", type: "taxe" });
  check("recette : chapitre budgétaire inconnu refusé (400, pas 500)", rc.status === 400 || rc.status === 403, `${rc.status} ${J(rc.data).slice(0, 120)}`);
  const otherEmp = await withDb(ROOT, async db => { const t = await db.collection("tenants").findOne({ slug: "asso-test" }); const r = await db.collection("employees").insertOne({ tenantId: t._id, code: "E-ETR", firstName: "Etr", lastName: "Anger", position: "x", startDate: new Date() }); return String(r.insertedId); });
  const nf2 = await g.req("POST", "/api/expenses", { title: "Note étrangère", employeeId: otherEmp, lines: [] });
  check("note de frais : salarié d'une autre organisation refusé", nf2.status === 400, nf2.status);

  console.log("\n▶ S6 — fournisseurs");
  const sp = D(await g.req("POST", "/api/suppliers", { code: "SEC-F", name: "Fournisseur Sec", email: "f@sec.ne", accessCodeHash: "$2a$12$abcdefghijklmnopqrstuuJ3w1z8m0q9W3y8v6fX1yq5Qe2bXc4m", bankAccount: "NE001" }));
  const raw = await withDb(ROOT, db => db.collection("suppliers").findOne({ code: "SEC-F" }));
  check("code d'accès au portail non écrit par le formulaire", sp._id && !raw.accessCodeHash, J({ h: raw?.accessCodeHash }));
  await g.req("PATCH", `/api/suppliers/${sp._id}`, { bankAccount: "NE999", accessCodeHash: "x" });
  const audit = await withDb(ROOT, db => db.collection("auditlogs").find({ resource: "suppliers", action: "UPDATE" }).toArray().then(l => l.filter(a => String(a.resourceId) === String(sp._id))));
  const raw2 = await withDb(ROOT, db => db.collection("suppliers").findOne({ code: "SEC-F" }));
  check("changement de RIB tracé avant / après", audit.some(a => a.before?.bankAccount === "NE001" && a.after?.bankAccount === "NE999") && !raw2.accessCodeHash, J(audit.map(a => [a.before, a.after])));

  console.log("\n▶ S8 — recherches");
  const sr = await Promise.all(["/api/clients?search=(", "/api/invoices?search=(a%2B)%2B%24", "/api/suppliers?search=[", "/api/employees?search=*"].map(p => g.req("GET", p)));
  check("caractères spéciaux en recherche : pas d'erreur 500", sr.every(r => r.status === 200), J(sr.map(r => r.status)));
  const lit = D(await g.req("GET", `/api/clients?search=${encodeURIComponent(client.name.slice(0, 3))}`));
  check("recherche ordinaire inchangée", (lit.items ?? lit).length >= 1);

  console.log("\n▶ S9 — export CSV");
  await g.req("POST", "/api/clients", { code: "SEC-CSV", name: "=HYPERLINK(\"http://x\")", type: "company" });
  const csv = await g.req("GET", "/api/data/clients/export");
  const txt = Buffer.isBuffer(csv.data) ? csv.data.toString("utf8") : J(csv.data);
  check("formule neutralisée (apostrophe) dans l'export", csv.status === 200 && txt.includes("'=HYPERLINK") && !/(^|,)"?=HYPERLINK/m.test(txt), txt.split("\n").find(l => l.includes("HYPERLINK")));

  console.log("\n▶ S10 — secret des tâches planifiées");
  const ck = await anon("GET", `/api/cron?job=sequence-reset-check&key=${process.env.CRON_SECRET}`);
  check("secret dans l'URL refusé par défaut", ck.status === 401 && /en-tête/.test(ck.data?.error ?? ""), `${ck.status} ${J(ck.data)}`);
  const ch = await anon("GET", "/api/cron?job=inexistant", undefined, { "x-cron-key": process.env.CRON_SECRET });
  check("secret en en-tête accepté", ch.status === 404, ch.status);

  console.log("\n▶ S11 — déconnexion de l'application mobile");
  const lg = await anon("POST", "/api/auth/login", { email: "comptable@test.ne", password: SEED_PW }, { "x-kanoo-client": "mobile" });
  const tok = lg.data?.data?.token ?? lg.data?.token;
  const bearer = { authorization: `Bearer ${tok}`, "x-kanoo-client": "mobile" };
  const me1 = await anon("GET", "/api/dashboard/home", undefined, bearer);
  const out = await anon("POST", "/api/auth/logout", undefined, bearer);
  const me2 = await anon("GET", "/api/dashboard/home", undefined, bearer);
  check("jeton révoqué à la déconnexion", !!tok && me1.status === 200 && out.status === 200 && me2.status === 401, J([lg.status, me1.status, out.status, me2.status]));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
