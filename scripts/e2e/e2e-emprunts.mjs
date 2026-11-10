// Scénario de bout en bout : emprunts (tableau, déblocage, échéances, annulation, reprise, prévision).
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



const dayAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: cpt } = await login("comptable@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque emprunt", type: "bank", openingBalance: 1000000, openingDate: "2025-01-01" }));
  const bal = async () => (D(await g.req("GET", "/api/treasury-accounts")).items ?? []).find(a => a._id === bank)?.balance;
  const entry = async ref => (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(ref)}&limit=50`)).items ?? []);

  console.log("\n▶ Création et tableau");
  check("création refusée sans banque", (await g.req("POST", "/api/loans", { label: "X", lender: "Y", principal: 100, annualRatePct: 5, durationMonths: 12, startDate: today })).status === 400);
  const c = await g.req("POST", "/api/loans", { label: "Équipement", lender: "Orabank", reference: "PRET-1", treasuryAccountId: bank, principal: 10000000, annualRatePct: 12, durationMonths: 12, frequency: "monthly", method: "annuity", startDate: dayAgo(40), firstDueDate: dayAgo(10), fees: 100000 });
  const loanId = id(c);
  check("emprunt créé, 12 échéances de 888 488", c.status === 201 && D(c).installments?.length === 12 && D(c).installments[0].principal + D(c).installments[0].interest === 888488 && D(c).status === "draft", J(D(c)).slice(0, 200));
  check("autre organisation : emprunt invisible", (await other.req("GET", `/api/loans/${loanId}`)).status === 404);
  check("comptable : accès aux emprunts", (await cpt.req("GET", "/api/loans")).status === 200);

  console.log("\n▶ Déblocage");
  check("paiement avant déblocage refusé", (await g.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: D(c).installments[0]._id })).status === 400);
  const dis = await g.req("POST", `/api/loans/${loanId}`, { action: "disburse", date: dayAgo(40) });
  check("déblocage : banque + 9 900 000 (capital moins frais)", dis.status === 200 && (await bal()) === 10900000, `${dis.status} ${await bal()}`);
  const de = (await entry("PRET-1")).find(e => e.lines.some(l => l.accountCode === "162000" && l.credit === 10000000));
  check("écriture de déblocage équilibrée : 162 au crédit, 631 et banque au débit", de && de.lines.reduce((t, l) => t + l.debit, 0) === de.lines.reduce((t, l) => t + l.credit, 0) && de.lines.some(l => l.accountCode === "631000" && l.debit === 100000), J(de?.lines));
  check("double déblocage refusé", (await g.req("POST", `/api/loans/${loanId}`, { action: "disburse" })).status === 400);

  console.log("\n▶ Échéances");
  let L = D(await g.req("GET", `/api/loans/${loanId}`));
  const [i1, i2, i3] = L.installments;
  check("échéance 1 en retard signalée", L.state.overdue.count === 1 && L.state.overdue.amount === 888488, J(L.state));
  check("payer l'échéance 3 avant la 1 : refusé", (await g.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: i3._id })).status === 400);
  const p1 = await g.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: i1._id, date: dayAgo(9) });
  L = D(await g.req("GET", `/api/loans/${loanId}`));
  check("échéance 1 payée : banque − 888 488, capital restant 9 211 512", p1.status === 200 && (await bal()) === 10900000 - 888488 && L.state.remaining === 9211512, `${await bal()} ${L.state.remaining}`);
  const pe = (await entry("PRET-1")).find(e => e.lines.some(l => l.accountCode === "671000"));
  check("écriture d'échéance : 162 et 671 au débit, banque au crédit", pe && pe.lines.some(l => l.accountCode === "162000" && l.debit === 788488) && pe.lines.some(l => l.accountCode === "671000" && l.debit === 100000), J(pe?.lines));
  check("échéance déjà payée : refus", (await g.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: i1._id })).status === 400);
  const fc = D(await g.req("GET", "/api/treasury-accounts/forecast?weeks=8"));
  check("prévision de trésorerie : échéances à venir comptées", J(fc).includes("Emprunts") && J(fc).includes("Échéance 2"), J(fc).slice(0, 120));
  const can = await g.req("POST", `/api/loans/${loanId}`, { action: "cancel", installmentId: i1._id, reason: "Erreur" });
  L = D(await g.req("GET", `/api/loans/${loanId}`));
  check("paiement annulé : banque rétablie, échéance redevenue due", can.status === 200 && (await bal()) === 10900000 && L.installments[0].status === "due", `${await bal()}`);

  console.log("\n▶ Ajustement au tableau de la banque");
  check("ajustement impossible à compenser (capital au-delà de l'emprunt) : refusé", (await g.req("POST", `/api/loans/${loanId}`, { action: "adjust", installmentId: i2._id, principal: 99999999 })).status === 400);
  const adj = await g.req("POST", `/api/loans/${loanId}`, { action: "adjust", installmentId: i2._id, interest: 93000, principal: 800000 });
  const ai = D(adj).installments ?? [];
  check("ajustement du capital : la dernière échéance absorbe l'écart", adj.status === 200 && ai[1].interest === 93000 && ai[1].principal === 800000 && ai.reduce((t, x) => t + x.principal, 0) === 10000000 && ai[11].adjusted, J(ai[1]));
  check("date d'échéance hors ordre refusée", (await g.req("POST", `/api/loans/${loanId}`, { action: "adjust", installmentId: i3._id, dueDate: "2020-01-01" })).status === 400);
  check("paiement daté avant le déblocage refusé", (await g.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: i1._id, date: "2020-01-01" })).status === 400);
  check("emprunt d'une autre organisation : 404", (await other.req("POST", `/api/loans/${loanId}`, { action: "pay", installmentId: i1._id })).status === 404);
  check("suppression d'un emprunt comptabilisé : refusée", (await g.req("DELETE", `/api/loans/${loanId}`)).status === 400);

  console.log("\n▶ Contrôles de saisie");
  for (const [k, v] of [["principal", 1e300], ["annualRatePct", null], ["startDate", "2026-02-31"], ["deferralPeriods", 50], ["fees", 20000000]]) {
    check(`création avec ${k}=${J(v)} refusée`, (await g.req("POST", "/api/loans", { label: "X", lender: "Y", treasuryAccountId: bank, principal: 10000000, annualRatePct: 5, durationMonths: 12, startDate: "2026-01-15", [k]: v })).status === 400);
  }
  const d31 = D(await g.req("POST", "/api/loans", { label: "Fin de mois", lender: "Y", treasuryAccountId: bank, principal: 100000, annualRatePct: 5, durationMonths: 12, startDate: "2026-01-31" }));
  check("première échéance par défaut : 28/02 après un 31/01", String(d31.firstDueDate).startsWith("2026-02-28"), String(d31.firstDueDate));

  console.log("\n▶ Annulation du déblocage");
  const un = await g.req("POST", `/api/loans/${loanId}`, { action: "undisburse", reason: "Erreur de frais" });
  check("déblocage annulé : banque rétablie, emprunt à débloquer", un.status === 200 && D(un).status === "draft" && (await bal()) === 1000000, `${un.status} ${await bal()}`);

  console.log("\n▶ Prêt hors banque, sans intérêt, remboursement libre");
  const caisse = id(await g.req("POST", "/api/treasury-accounts", { label: "Caisse prêt", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }));
  const fr = D(await g.req("POST", "/api/loans", { label: "Avance de l'associé", lender: "M. Associé", lenderType: "associate", treasuryAccountId: caisse, principal: 500000, annualRatePct: 0, method: "free", startDate: dayAgo(5) }));
  check("prêt d'associé : compte 462, sans échéancier", fr.capitalAccountCode === "462000" && fr.installments?.length === 0 && fr.status === "draft", J(fr).slice(0, 160));
  await g.req("POST", `/api/loans/${fr._id}`, { action: "disburse", date: dayAgo(5) });
  const r1 = await g.req("POST", `/api/loans/${fr._id}`, { action: "repay", principal: 200000, date: dayAgo(1), treasuryAccountId: caisse });
  const fs = D(await g.req("GET", `/api/loans/${fr._id}`));
  check("remboursement libre : reste dû 300 000", r1.status === 200 && fs.state.remaining === 300000, J(fs.state));
  check("rembourser plus que le reste : refusé", (await g.req("POST", `/api/loans/${fr._id}`, { action: "repay", principal: 400000 })).status === 400);
  const fe = (await entry("EMPRUNT")).find(e => e.lines.some(l => l.accountCode === "462000" && l.debit === 200000));
  check("écriture : 462 au débit, caisse au crédit", !!fe, J(fe?.lines));

  console.log("\n▶ Emprunt antérieur à la reprise");
  check("antérieur sans reprise ni clôture : refusé", (await g.req("POST", "/api/loans", { label: "Avant", lender: "BOA", treasuryAccountId: bank, principal: 1200000, annualRatePct: 0, durationMonths: 12, method: "constant", startDate: "2025-06-01", prior: true })).status === 400);
  await withDb(ROOT, db => db.collection("tenants").updateOne({ slug: "test-pme" }, { $set: { accountingRestartDate: new Date("2026-01-01T00:00:00Z") } }));
  const old = D(await g.req("POST", "/api/loans", { label: "Ancien prêt", lender: "BOA", treasuryAccountId: bank, principal: 1200000, annualRatePct: 0, durationMonths: 12, frequency: "monthly", method: "constant", startDate: "2025-06-01", firstDueDate: "2025-07-01", prior: true }));
  const prior = (old.installments ?? []).filter(i => i.status === "prior").length;
  const oldState = D(await g.req("GET", `/api/loans/${old._id}`)).state;
  check("échéances avant le 01/01/2026 : hors Kanoo ; emprunt en cours sans déblocage", old.status === "active" && prior === 6 && oldState.remaining === 600000, `${old.status} ${prior} ${oldState?.remaining}`);
  const list = D(await g.req("GET", "/api/loans"));
  check("liste : capital restant total (emprunt annulé à 0, associé 300 000, ancien 600 000)", list.totals?.remaining === 300000 + 600000, J(list.totals));
  check("contrôle de la reprise : 600 000 au compte 162, solde d'ouverture pas encore saisi", list.openingCheck?.some(c => c.accountCode === "162000" && c.loans === 600000 && c.opening === null), J(list.openingCheck));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
