// Scénario de bout en bout : lot 4 (lettrage automatique, Go/No-Go, contrôles des états financiers).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const PW = `Kz-${randomBytes(12).toString("base64url")}!9q`;
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

const today = new Date().toISOString().slice(0, 10);
const id = r => D(r)?._id;
const entriesOf = async (g, q) => D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(q)}&limit=50`)).items ?? [];
const balancedE = e => e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0);
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d.toISOString(); };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque lot 4", type: "bank", openingBalance: 5000000, openingDate: "2025-01-01" }));
  const lettered = async (acc) => D(await g.req("GET", `/api/accounting-entries/lettrage?account=${acc}&state=lettered`)) ?? [];
  const open = async (acc) => D(await g.req("GET", `/api/accounting-entries/lettrage?account=${acc}&state=open`)) ?? [];

  console.log("\n▶ Lettrage automatique — clients");
  const cl = id(await g.req("POST", "/api/clients", { code: "C-LET", name: "Client lettrage" }));
  const mk = async (amount) => { const i = D(await g.req("POST", "/api/invoices", { clientId: cl, issueDate: today, dueDate: today, lines: [{ description: "Prestation", quantity: 1, unitPrice: amount, tvaRate: 0 }] })); await g.req("POST", `/api/invoices/${i._id}/send`); return i; };
  const pay = (inv, amount) => g.req("POST", "/api/payments", { invoiceId: inv._id, amount, method: "bank_transfer", date: today, treasuryAccountId: bank._id });
  const f1 = await mk(100000), f2 = await mk(250000), f3 = await mk(80000);
  await pay(f1, 60000); await pay(f1, f1.totalTTC - 60000);       // f1 soldée en deux règlements (timbre compris)
  await pay(f2, 100000);                                            // f2 en partie
  const bad = D(await pay(f3, f3.totalTTC));
  await g.req("POST", `/api/payments/${bad._id}/cancel`, { reason: "chèque impayé" });   // règlement puis extourne
  const dry = await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "411" });
  check("proposition : facture + 2 règlements, et règlement + extourne", dry.status === 200 && D(dry).byRule?.document === 1 && D(dry).byRule?.reversal === 1 && D(dry).applied === 0, J(dry.data));
  check("proposition sans effet", (await lettered("411")).length === 0);
  const app = await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "411", apply: true });
  const L = await lettered("411");
  check("lettrage appliqué : 5 écritures, 2 références", app.status === 200 && D(app).applied === 2 && L.length === 5 && new Set(L.map(l => l.letterRef)).size === 2, `${J(app.data)} ${L.length}`);
  const O = await open("411");
  check("restent ouvertes : facture partielle, son règlement, la facture impayée", O.length === 3 && O.some(l => l.reference === f2.number) && O.some(l => l.reference === f3.number), J(O.map(l => l.reference)));
  check("deuxième passage : rien de plus", D(await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "411" })).proposed === 0);
  await pay(f2, f2.totalTTC - 100000);
  check("facture soldée ensuite : lettrée au passage suivant", D(await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "411", apply: true })).applied === 1);
  check("compte hors classe 4 : refusé", (await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "521" })).status === 400);

  console.log("\n▶ Lettrage automatique — fournisseurs");
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-LET", name: "Fournisseur lettrage" }));
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, validate: true, lines: [{ description: "Fournitures", accountCode: "604000", quantity: 1, unitPrice: 50000, tvaRate: 0 }] }));
  await g.req("POST", `/api/achats/${pur._id}/pay`, { amount: 50000, treasuryAccountId: bank._id, date: today });
  const ap = await g.req("POST", "/api/accounting-entries/lettrage/auto", { account: "401", apply: true });
  check("achat et son règlement lettrés", ap.status === 200 && D(ap).applied === 1 && D(ap).byRule?.document === 1, J(ap.data));

  console.log("\n▶ Go / No-Go");
  const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d.toISOString(); };
  const a = D(await g.req("POST", "/api/appels", { title: "Équipement de laboratoire", organism: "Université de Niamey", submissionDeadline: plusDays(10), estimatedAmount: 20000000, requiredDocuments: ["Attestation fiscale", "Caution de soumission"] }));
  const gg = D(await g.req("GET", `/api/appels/${a._id}/go-no-go`));
  check("grille : 7 critères, délai et pièces pré-évalués, trésorerie évaluée", gg.criteria?.length === 7 && gg.suggestions?.lead === 3 && gg.suggestions?.compliance === 0 && gg.suggestions?.finance >= 1 && !!gg.suggestions?.reasons?.finance, J(gg.suggestions));
  check("note hors 0-5 : refusée", (await g.req("PUT", `/api/appels/${a._id}/go-no-go`, { scores: { fit: 9 } })).status === 400);
  const scores = { fit: 4, capacity: 3, finance: 3, compliance: 1, winChance: 3, margin: 3, lead: 3 };
  const dec = await g.req("PUT", `/api/appels/${a._id}/go-no-go`, { scores });
  check("conformité à 1 : No-Go recommandé et enregistré", dec.status === 200 && D(dec).decision === "no_go" && D(dec).score > 0, J(dec.data));
  check("liste : décision visible", (D(await g.req("GET", "/api/appels")).items ?? []).find(x => x._id === a._id)?.goNoGo?.decision === "no_go");
  check("No-Go : plus de rappel dans le brief", !(D(await g.req("GET", "/api/brief?limit=20")).items ?? []).some(i => i.kind === "tender_deadline"));
  const go = await g.req("PUT", `/api/appels/${a._id}/go-no-go`, { scores: { ...scores, compliance: 4 }, decision: "go", note: "Pièces en cours, partenaire local" });
  check("décision revue : Go, motif conservé", D(go).decision === "go" && D(go).note?.includes("partenaire"));
  const br = D(await g.req("GET", "/api/brief?limit=20")).items ?? [];
  check("Go : rappel de dépôt de retour dans le brief", br.some(i => i.kind === "tender_deadline" && !/Go\/No-Go/.test(i.why)), J(br.map(i => i.why)));

  console.log("\n▶ États financiers : contrôles");
  const fs = D(await g.req("GET", `/api/accounting/financial-statements?annee=${new Date().getFullYear()}`));
  check("contrôles présents, bilan équilibré, flux rapprochés", Array.isArray(fs.warnings) && fs.balanceSheet.totalActif === fs.balanceSheet.totalPassif && fs.cashFlow.gap === 0, J({ w: fs.warnings, gap: fs.cashFlow?.gap }));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
