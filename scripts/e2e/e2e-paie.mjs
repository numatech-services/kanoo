// Scénario de bout en bout : paie 2026 — CNSS (taux 2024, plafond, branches,
// stagiaires, détachés), ITS (CGI 2026 : frais professionnels, charges de
// famille, arrondi), avantages en nature, frais non soumis, déclaration CNSS
// mensuelle ou trimestrielle et bordereau.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { withDb } from "./db.mjs";
const require_oid = () => createRequire(`${process.argv[2]}/package.json`)("mongodb").ObjectId;

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

const post = async (s, path, body) => s.req("POST", path, body);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const YEAR = 2026, MONTH = 9;
  const hired = `${YEAR}-02-01`; // moins d'un an : pas de prime d'ancienneté en septembre

  async function employee(fields) {
    const r = await post(g, "/api/employees", { position: "Agent", startDate: hired, employeeType: "employee", contractNature: "cdi", ...fields });
    check(`fiche ${fields.code} créée`, r.status === 201 || r.status === 200, `${r.status} ${J(r.data).slice(0, 200)}`);
    return D(r);
  }
  const slip = async (emp, extra = {}) => {
    const r = await post(g, "/api/payslips", { employeeId: emp._id, month: MONTH, year: YEAR, ...extra });
    check(`bulletin ${emp.code} généré`, r.status === 201, `${r.status} ${J(r.data).slice(0, 300)}`);
    return D(r);
  };

  console.log("\n▶ Fiche salarié : situation fiscale");
  const a = await employee({ code: "P-A", firstName: "Aïcha", lastName: "Ref", grossSalary: 300_000, familyCharges: 2, cnssNumber: "CNSS-A" });
  check("charges de famille enregistrées", a.familyCharges === 2 && a.cnssCategory === "standard", J({ f: a.familyCharges, c: a.cnssCategory }));
  const bad = await g.req("PATCH", `/api/employees/${a._id}`, { familyCharges: 9 });
  check("plus de 7 charges de famille refusé", bad.status === 400, `${bad.status} ${J(bad.data).slice(0, 160)}`);

  console.log("\n▶ Bulletin de référence (300 000, 2 charges)");
  const pa = await slip(a);
  check("CNSS salariale 5,25 % = 15 750", pa.cnssEmployee === 15_750, pa.cnssEmployee);
  check("CNSS patronale 17,40 % = 52 200", pa.cnssEmployer === 52_200, pa.cnssEmployer);
  check("ventilation PF / AT / pensions / ANPE", J(pa.cnssBranches) === J({ pf: 14_700, atmp: 5_250, pensions: 29_250, anpe: 3_000 }), J(pa.cnssBranches));
  check("base ITS 217 000, ITS 27 000", pa.netImposable === 217_000 && pa.incomeTax === 27_000, J({ b: pa.netImposable, i: pa.incomeTax }));
  check("net à payer 257 250", pa.netSalary === 257_250, pa.netSalary);
  check("paramètres 2026 et détail ITS figés sur le bulletin", pa.paramsVersion === "2026-01-01" && pa.itsDetail?.bareme === "its" && pa.itsDetail?.tauxFamille === 0.12 && pa.familyCharges === 2, J({ v: pa.paramsVersion, d: pa.itsDetail }));
  const entry = await withDb(ROOT, db => db.collection("accountingentries").findOne({ _id: new (require_oid())(pa.accountingEntryId) }));
  const sum = k => entry.lines.reduce((s, l) => s + l[k], 0);
  check("écriture de paie équilibrée, ITS au 447100", entry && sum("debit") === sum("credit") && entry.lines.some(l => l.accountCode === "447100" && l.credit === 27_000 && /ITS/.test(l.accountLabel)), J(entry?.lines));

  console.log("\n▶ Plafond CNSS et avantages en nature");
  const b = await employee({ code: "P-B", firstName: "Bachir", lastName: "Cadre", grossSalary: 800_000, cnssNumber: "CNSS-B", benefitsInKind: [{ kind: "logement", count: 3 }, { kind: "vehicule", count: 1 }] });
  const pb = await slip(b);
  check("assiette plafonnée à 500 000", pb.cnssBase === 500_000 && pb.cnssEmployee === 26_250 && pb.cnssEmployer === 87_000, J({ base: pb.cnssBase, e: pb.cnssEmployee, p: pb.cnssEmployer }));
  check("avantages en nature évalués (60 000 + 20 000), hors net", pb.benefitsInKind === 80_000 && pb.grossTotal === 800_000 && pb.netSalary === 800_000 - 26_250 - pb.incomeTax, J({ bik: pb.benefitsInKind, g: pb.grossTotal, n: pb.netSalary, i: pb.incomeTax }));

  console.log("\n▶ Stagiaire, fonctionnaire détaché, frais non soumis");
  const c = await employee({ code: "P-C", firstName: "Chaïbou", lastName: "Stage", employeeType: "intern", contractNature: "stage", indemnity: 50_000, cnssNumber: "CNSS-C" });
  const pc = await slip(c);
  check("stagiaire : 16,75 % (2 625 + 5 750)", pc.cnssCategory === "stagiaire" && pc.cnssEmployee === 2_625 && pc.cnssEmployer === 5_750, J({ cat: pc.cnssCategory, e: pc.cnssEmployee, p: pc.cnssEmployer }));
  const d = await employee({ code: "P-D", firstName: "Djibo", lastName: "Detache", grossSalary: 200_000, cnssCategory: "detache", cnssNumber: "CNSS-D" });
  const pd = await slip(d, { items: [{ label: "Frais de mission", amount: 40_000, type: "addition", subject: false }] });
  check("détaché : 6,65 % employeur, rien au salarié", pd.cnssEmployee === 0 && pd.cnssEmployer === 13_300, J({ e: pd.cnssEmployee, p: pd.cnssEmployer }));
  check("frais de mission versés hors assiette", pd.grossTotal === 240_000 && pd.cnssBase === 200_000 && pd.items?.[0]?.subject === false, J({ g: pd.grossTotal, b: pd.cnssBase, it: pd.items }));
  const e = await employee({ code: "P-E", firstName: "Elh", lastName: "SansCnss", grossSalary: 100_000 });
  const re = await post(g, "/api/payslips", { employeeId: e._id, month: MONTH, year: YEAR });
  check("alerte : numéro CNSS manquant", re.status === 201 && (D(re).alerts ?? []).some(x => /CNSS/.test(x)), J(D(re).alerts));

  console.log("\n▶ Déclaration CNSS");
  const q = D(await g.req("GET", `/api/fiscal/cnss?annee=${YEAR}&trimestre=3`));
  const assiette = 300_000 + 500_000 + 50_000 + 200_000 + 100_000;
  check("trimestrielle sous 20 salariés", q.periodicite === "trimestrielle" && q.effectif < 20, J({ p: q.periodicite, n: q.effectif }));
  check("assiette plafonnée déclarée", q.totalBrut === assiette, `${q.totalBrut} ≠ ${assiette}`);
  check("branches = part patronale", q.branches && q.branches.pf + q.branches.atmp + q.branches.pensions + q.branches.anpe === q.cnssPatronal, J(q.branches));
  check("échéance : 30 jours après le trimestre (30/10)", new Date(q.echeance).getMonth() === 9 && new Date(q.echeance).getDate() === 30, q.echeance);
  const m = D(await g.req("GET", `/api/fiscal/cnss?annee=${YEAR}&mois=${MONTH}`));
  check("lecture mensuelle identique pour septembre", m.totalCnss === q.totalCnss && m.periode?.mois === MONTH, J({ m: m.totalCnss, q: q.totalCnss }));
  const d1 = await post(g, "/api/fiscal/cnss", { annee: YEAR, mois: MONTH, totalBrut: m.totalBrut, totalCnss: m.totalCnss });
  const d2 = await post(g, "/api/fiscal/cnss", { annee: YEAR, mois: MONTH, totalBrut: m.totalBrut, totalCnss: m.totalCnss });
  const d3 = await post(g, "/api/fiscal/cnss", { annee: YEAR, trimestre: 3, totalBrut: q.totalBrut, totalCnss: q.totalCnss });
  check("déclaration mensuelle enregistrée, doublon refusé, trimestre distinct", d1.status === 200 && d2.status === 409 && d3.status === 200, J([d1.status, d2.status, d3.status]));
  const pdf = await g.req("GET", `/api/reports/dgi-cnss?year=${YEAR}&mois=${MONTH}`);
  check("bordereau PDF mensuel", pdf.status === 200 && Buffer.isBuffer(pdf.data) && pdf.data.subarray(0, 4).toString() === "%PDF", pdf.status);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
