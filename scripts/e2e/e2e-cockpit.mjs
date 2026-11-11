// Scénario de bout en bout : cockpit consolidé (résultat, trésorerie, dettes, cautions, ratios, cloisonnement).
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
const today = new Date().toISOString().slice(0, 10);
const Y = today.slice(0, 4);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: cpt } = await login("comptable@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const base = D(await g.req("GET", `/api/cockpit?year=${Y}`));
  check("cockpit accessible (administrateur)", base.result !== undefined, J(base).slice(0, 160));

  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque cockpit", type: "bank", openingBalance: 1000000, openingDate: `${Y}-01-01` }));
  const od = (ref, lines) => g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: ref, label: ref, lines });
  const e1 = await od("CK-VTE", [{ accountCode: "471000", accountLabel: "Divers", debit: 1000000 }, { accountCode: "706000", accountLabel: "Services vendus", credit: 1000000 }]);
  const e2 = await od("CK-CHG", [{ accountCode: "627000", accountLabel: "Publicité", debit: 200000 }, { accountCode: "471000", accountLabel: "Divers", credit: 200000 }]);
  const e3 = await od("CK-INT", [{ accountCode: "671000", accountLabel: "Intérêts", debit: 50000 }, { accountCode: "471000", accountLabel: "Divers", credit: 50000 }]);
  check("écritures de test passées", [e1, e2, e3].every(e => e.status === 201), [e1, e2, e3].map(e => e.status + " " + J(e.data).slice(0, 80)).join(" | "));
  const loan = id(await g.req("POST", "/api/loans", { label: "Crédit cockpit", lender: "Banque", treasuryAccountId: bank, principal: 1200000, annualRatePct: 0, durationMonths: 12, frequency: "monthly", method: "constant", startDate: today }));
  const dis = await g.req("POST", `/api/loans/${loan}`, { action: "disburse", date: today });
  const cau = await g.req("POST", "/api/cautions", { type: "soumission", beneficiary: "Ministère", amount: 500000, treasuryAccountId: bank, issueDate: today, expiryDate: `${Number(Y) + 1}-06-30` });
  check("emprunt débloqué et caution créée", dis.status === 200 && cau.status === 201, `${dis.status} ${cau.status} ${J(cau.data).slice(0, 120)}`);

  const c = D(await g.req("GET", `/api/cockpit?year=${Y}`));
  const dr = k => (c.result?.[k] ?? 0) - (base.result?.[k] ?? 0);
  check("produits : + 1 000 000", dr("revenue") === 1000000, J(c.result));
  check("intérêts : + 50 000", dr("interest") === 50000, J(c.result));
  check("résultat net : + 750 000", dr("net") === 750000, J(c.result));
  check("EBE : + 800 000 (intérêts exclus)", dr("ebitda") === 800000, J(c.result));
  const acc = (c.treasury?.accounts ?? []).find(a => String(a._id ?? a.id) === bank);
  check("trésorerie : banque à 2 200 000 (ouverture + emprunt)", acc && Math.round(acc.balance) === 2200000, J(c.treasury).slice(0, 300));
  check("emprunts restant dus : + 1 200 000", c.debt.loans - (base.debt?.loans ?? 0) === 1200000, J(c.debt));
  check("cautions données en cours : + 500 000", c.debt.guaranteesGiven - (base.debt?.guaranteesGiven ?? 0) === 500000, J(c.debt));
  check("12 mois restitués", Array.isArray(c.months) && c.months.length === 12, J(c.months?.length));
  check("ratios calculés (marge nette, couverture des intérêts)", c.ratios && c.ratios.netMargin !== null && c.ratios.interestCover !== null, J(c.ratios));
  check("année bornée (année 1900 ramenée à 2000)", D(await g.req("GET", "/api/cockpit?year=1900")).year === 2000);

  console.log("\n▶ Résultat SYSCOHADA, découvert, exercice passé");
  const his = await od("CK-HAO", [{ accountCode: "812000", accountLabel: "Valeurs comptables des cessions", debit: 100000 }, { accountCode: "471000", accountLabel: "Divers", credit: 100000 }]);
  const dec = await g.req("POST", "/api/treasury-accounts", { label: "Banque découvert", type: "bank", openingBalance: -500000, openingDate: `${Y}-01-01` });
  const c2 = D(await g.req("GET", `/api/cockpit?year=${Y}`));
  check("charge hors activités ordinaires (81) : résultat net − 100 000, EBE inchangé", his.status === 201 && c2.result.net - c.result.net === -100000 && c2.result.ebitda === c.result.ebitda, J(c2.result));
  if (dec.status === 201) {
    const pos = c2.treasury.accounts.filter(a => a.balance > 0).reduce((t, a) => t + a.balance, 0), neg = c2.treasury.accounts.filter(a => a.balance < 0).reduce((t, a) => t - a.balance, 0);
    check("endettement net : emprunts + découvert − soldes positifs (pas de double compte)", c2.ratios.netDebt === c2.debt.loans + neg - pos && neg >= 500000, J({ nd: c2.ratios.netDebt, loans: c2.debt.loans, pos, neg }));
  } else check("compte à découvert créé pour le test", false, `${dec.status} ${J(dec.data).slice(0, 120)}`);
  const past = D(await g.req("GET", `/api/cockpit?year=${Number(Y) - 1}`));
  check("exercice passé : signalé, délais clients/fournisseurs non calculés", past.currentYear === false && past.ratios.dso === null && past.ratios.dpo === null, J({ cy: past.currentYear, r: past.ratios }));

  console.log("\n▶ Droits et cloisonnement");
  check("comptable : cockpit accessible", (await cpt.req("GET", `/api/cockpit?year=${Y}`)).status === 200);
  const o = D(await other.req("GET", `/api/cockpit?year=${Y}`));
  check("autre organisation : aucun chiffre de cette organisation", (o.result?.revenue ?? 0) < 1000000 && !(o.treasury?.accounts ?? []).some(a => String(a._id ?? a.id) === bank), J(o.result));
  const anon = await fetch(`${BASE}/api/cockpit`);
  check("sans connexion : refusé", anon.status === 401 || anon.status === 403, String(anon.status));
  const page = await g.req("GET", "/cockpit");
  check("page Cockpit servie", page.status === 200, String(page.status));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} vérifications réussies, ${fail + 1} en échec`); process.exit(1); });
