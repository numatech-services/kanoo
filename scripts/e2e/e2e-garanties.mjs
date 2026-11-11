// Scénario de bout en bout : cautions et garanties (commissions périodiques, prorogation, reçues, garanties d'emprunt, plafonds).
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
  const { s: other } = await login("president@test.ne", SEED_PW);
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque cautions", type: "bank", openingBalance: 2000000, openingDate: "2025-01-01" }));
  const bal = async () => (D(await g.req("GET", "/api/treasury-accounts")).items ?? []).find(a => a._id === bank)?.balance;
  check("plafond de cautions enregistré sur la banque", (await g.req("PATCH", `/api/treasury-accounts/${bank}`, { guaranteeLimit: 15000000 })).status === 200);

  console.log("\n▶ Caution donnée, commission trimestrielle");
  const c = await g.req("POST", "/api/cautions", { type: "bonne_execution", beneficiary: "Université", amount: 10000000, issueDate: dayAgo(200), expiryDate: dayAgo(-200), treasuryAccountId: bank, fee: 30000, feeRatePct: 2, feePeriod: "quarterly" });
  const cid = id(c);
  check("caution créée, commission d'émission passée", c.status === 201 && (await bal()) === 1970000, `${c.status} ${await bal()}`);
  check("commission périodique sans taux : refusée", (await g.req("POST", "/api/cautions", { type: "soumission", beneficiary: "X", amount: 100000, treasuryAccountId: bank, feePeriod: "quarterly" })).status === 400);
  let list = D(await g.req("GET", "/api/cautions"));
  let it = list.items.find(x => x._id === cid);
  check("prochaine commission : 50 000 (période 1)", it.nextCommission?.amount === 50000 && it.nextCommission.period === 1, J(it.nextCommission));
  const ch = await g.req("POST", `/api/cautions/${cid}/charge`, { kind: "commission" });
  list = D(await g.req("GET", "/api/cautions")); it = list.items.find(x => x._id === cid);
  check("commission passée : banque − 50 000, période 2 ensuite, coût 80 000", ch.status === 200 && (await bal()) === 1920000 && it.nextCommission?.period === 2 && it.cost === 80000, `${await bal()} ${J(it.nextCommission)} ${it.cost}`);
  const e = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent("Commission")}&limit=50`)).items ?? []).find(x => x.lines.some(l => l.accountCode === "631000" && l.debit === 50000));
  check("écriture 631 / banque", !!e, J(e?.lines));
  const fc = D(await g.req("GET", "/api/treasury-accounts/forecast?weeks=26"));
  check("prévision : commissions à venir", J(fc).includes("Commission de caution"));

  console.log("\n▶ Prorogation avec frais");
  check("prorogation antérieure à l'échéance actuelle : refusée", (await g.req("POST", `/api/cautions/${cid}/extend`, { expiryDate: dayAgo(0) })).status === 400);
  const ex = await g.req("POST", `/api/cautions/${cid}/extend`, { expiryDate: dayAgo(-400), fee: 25000 });
  check("prorogée, frais 25 000 passés", ex.status === 200 && (await bal()) === 1895000 && String(D(ex).expiryDate).startsWith(dayAgo(-400)), `${ex.status} ${await bal()}`);

  console.log("\n▶ Caution reçue, garantie d'emprunt, plafond");
  const r = await g.req("POST", "/api/cautions", { direction: "received", type: "bonne_execution", beneficiary: "Sous-traitant SARL", amount: 3000000, fee: 99999, issueDate: dayAgo(10), expiryDate: dayAgo(-100) });
  check("caution reçue : aucun frais passé", r.status === 201 && D(r).fee === 0 && (await bal()) === 1895000, J(D(r)).slice(0, 120));
  check("frais sur une caution reçue : refusés", (await g.req("POST", `/api/cautions/${id(r)}/charge`, { kind: "dossier", amount: 1000 })).status === 400);
  const loan = id(await g.req("POST", "/api/loans", { label: "Prêt", lender: "Orabank", treasuryAccountId: bank, principal: 5000000, annualRatePct: 10, durationMonths: 12, startDate: dayAgo(5) }));
  check("caution donnée sans banque : refusée", (await g.req("POST", "/api/cautions", { type: "soumission", beneficiary: "X", amount: 100000 })).status === 400);
  const ge = await g.req("POST", "/api/cautions", { type: "garantie_emprunt", guaranteeForm: "Nantissement du matériel", loanId: loan, beneficiary: "Orabank", amount: 6000000, issueDate: dayAgo(5), treasuryAccountId: bank });
  list = D(await g.req("GET", "/api/cautions"));
  check("dépassement de la ligne de cautions signalé à la création", !!D(ge).warning, J(D(ge)).slice(0, 160));
  check("garantie d'emprunt liée à l'emprunt", ge.status === 201 && list.items.some(x => x.loanId?._id === loan), J(D(ge)).slice(0, 120));
  check("engagements : donnés 16 000 000, reçus 3 000 000", list.commitments.total === 16000000 && list.commitments.received === 3000000, J(list.commitments));
  const b = list.banks.find(x => x._id === bank);
  check("ligne de cautions : 16 000 000 utilisés pour 15 000 000 (dépassement signalé)", b?.used === 16000000 && b.limit === 15000000, J(b));
  check("autre organisation : frais refusés", [400, 403, 404].includes((await other.req("POST", `/api/cautions/${cid}/charge`, { kind: "dossier", amount: 1000 })).status));

  console.log("\n▶ Appels de caution");
  const before = await bal();
  const rc = await g.req("POST", `/api/cautions/${id(r)}/call`, { amount: 1000000, treasuryAccountId: bank });
  check("caution reçue appelée : banque + 1 000 000 (produit)", rc.status === 200 && (await bal()) === before + 1000000, `${rc.status} ${await bal()}`);
  const av = id(await g.req("POST", "/api/cautions", { type: "avance_demarrage", beneficiary: "Client", amount: 400000, treasuryAccountId: bank }));
  const avr = await g.req("POST", `/api/cautions/${av}/call`, { amount: 400000 });
  check("caution d'avance sans marché : avertissement rendu", avr.status === 200 && !!D(avr).warning, J(avr.data).slice(0, 160));
  const avc = await g.req("POST", `/api/cautions/${av}/call`, { amount: 400000 });
  check("caution d'avance déjà appelée : second appel refusé", avc.status === 400);
  const ae = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent("Caution appelée")}&limit=50`)).items ?? []).find(x => x.lines.some(l => l.accountCode === "658000" && l.debit === 400000));
  check("caution d'avance sans marché : pas de 419 sans client, charge 658", !!ae && !ae.lines.some(l => l.accountCode === "419000"), J(ae?.lines));
  check("échéance modifiable seulement par prorogation (PATCH sans effet)", (await g.req("PATCH", `/api/cautions/${cid}`, { expiryDate: "2020-01-01" })).status < 300 && !String(D(await g.req("GET", `/api/cautions/${cid}`)).expiryDate).startsWith("2020"));

  console.log("\n▶ Suppression d'une saisie erronée");
  const del = await g.req("DELETE", `/api/cautions/${cid}`);
  check("caution supprimée : commissions et frais extournés, gardée au statut annulée", del.status < 300 && (await bal()) === 2000000 + 1000000 - 400000 && D(await g.req("GET", `/api/cautions/${cid}`)).status === "cancelled", `${del.status} ${await bal()}`);

  console.log("\n▶ Sûreté réelle et garantie d'emprunt appelées");
  check("nantissement appelé : refusé sans écriture de cession", (await g.req("POST", `/api/cautions/${id(ge)}/call`, { amount: 1000000 })).status === 400);
  const b0 = await bal();
  const gr = await g.req("POST", `/api/cautions/${id(ge)}/call`, { amount: 1000000, manualPosting: true });
  check("nantissement appelé avec confirmation : constaté, aucun mouvement de banque", gr.status === 200 && D(gr).status === "called" && (await bal()) === b0, `${gr.status} ${await bal()}`);
  const loan2 = id(await g.req("POST", "/api/loans", { label: "Prêt garanti", lender: "BIA", treasuryAccountId: bank, principal: 5000000, annualRatePct: 0, durationMonths: 5, frequency: "monthly", method: "constant", startDate: dayAgo(5) }));
  await g.req("POST", `/api/loans/${loan2}`, { action: "disburse", date: dayAgo(5) });
  const gl = id(await g.req("POST", "/api/cautions", { type: "garantie_emprunt", guaranteeForm: "Caution bancaire", loanId: loan2, beneficiary: "BIA", amount: 6000000, issueDate: dayAgo(5), treasuryAccountId: bank }));
  const b1 = await bal();
  const glc = await g.req("POST", `/api/cautions/${gl}/call`, { amount: 6000000 });
  const L2 = D(await g.req("GET", `/api/loans/${loan2}`));
  const ce = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent("Caution appelée")}&limit=50`)).items ?? []).find(x => x.lines.some(l => l.accountCode === "162000" && l.debit === 5000000));
  check("garantie d'emprunt appelée : 162 débité du restant (5 000 000), 658 de l'excédent (1 000 000)", !!ce && ce.lines.some(l => l.accountCode === "658000" && l.debit === 1000000), J(ce?.lines));
  check("garantie d'emprunt appelée : emprunt soldé, échéances éteintes", L2.status === "closed" && L2.installments.every(x => x.status === "paid") && (await bal()) === b1 - 6000000, `${L2.status} ${await bal()}`);
  check("échéance éteinte par la caution : annulation refusée", (await g.req("POST", `/api/loans/${loan2}`, { action: "cancel", installmentId: L2.installments.at(-1)._id })).status === 400);
  check("retenue sur intérêts refusée pour un prêteur bancaire", (await g.req("POST", "/api/loans", { label: "X", lender: "Banque", lenderType: "bank", treasuryAccountId: bank, principal: 100000, annualRatePct: 5, durationMonths: 12, startDate: dayAgo(1), interestWithholdingPct: 10 })).status === 400);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
