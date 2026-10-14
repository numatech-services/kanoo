// Scénario de bout en bout : moteur comptable (étape 3) — fournisseur unique,
// TVA des charges récurrentes, origine des immobilisations, banque protégée.
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

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque compta", type: "bank", openingBalance: 5000000, openingDate: "2025-01-01" }));
  const sup = id(await g.req("POST", "/api/suppliers", { code: "F-CPT", name: "Nigelec" }));

  console.log("\n▶ Banque et caisse protégées en saisie manuelle");
  const manual = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "BQ-MAN", label: "x",
    lines: [{ accountCode: "521000", accountLabel: "Banque", debit: 1000 }, { accountCode: "471000", accountLabel: "Attente", credit: 1000 }] });
  check("écriture manuelle sur 521 : refusée, orientée vers Trésorerie", manual.status === 400 && /Trésorerie/.test(manual.data?.error ?? ""), `${manual.status} ${J(manual.data)}`);

  console.log("\n▶ Charge récurrente : TVA récupérable et compte fournisseur");
  const rc = id(await g.req("POST", "/api/recurring-expenses", { label: "Électricité", amount: 119000, frequency: "monthly", startDate: today,
    accountCode: "605200", tvaRate: 0.19, supplierId: sup, treasuryAccountId: bank }));
  const pay = await g.req("POST", `/api/recurring-expenses/${rc}`, { treasuryAccountId: bank, date: today });
  check("échéance payée", pay.status === 200, `${pay.status} ${J(pay.data).slice(0, 150)}`);
  const rcEntries = (await entriesOf(g, "DEP-")).filter(e => e.label.includes("Électricité"));
  const ac = rcEntries.find(e => e.journalCode === "AC"), rg = rcEntries.find(e => e.journalCode !== "AC");
  check("charge HT 100 000 + TVA 4452 19 000, dette fournisseur 401100 au nom de Nigelec", ac && balancedE(ac)
    && ac.lines.some(l => l.accountCode === "605200" && l.debit === 100000)
    && ac.lines.some(l => l.accountCode === "445200" && l.debit === 19000)
    && ac.lines.some(l => l.accountCode === "401100" && l.credit === 119000 && String(l.thirdPartyId?._id ?? l.thirdPartyId) === sup), J(ac?.lines));
  check("règlement : 401100 soldé par la banque", rg && balancedE(rg) && rg.lines.some(l => l.accountCode === "401100" && l.debit === 119000) && rg.lines.some(l => /^52/.test(l.accountCode) && l.credit === 119000), J(rg?.lines));

  console.log("\n▶ Immobilisations : une seule écriture d'entrée");
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, validate: true,
    lines: [{ description: "Ordinateur portable", accountCode: "244000", quantity: 1, unitPrice: 600000, tvaRate: 0.19 }] }));
  check("achat d'immobilisation validé", ["validated", "partial", "paid"].includes(pur.status), J(pur).slice(0, 150));
  const fa1 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-ACH", name: "Ordinateur portable", category: "computer", acquisitionDate: today, acquisitionCost: 600000, origin: "purchase", purchaseId: pur._id });
  check("immobilisation issue de l'achat : créée", fa1.status === 201, `${fa1.status} ${J(fa1.data).slice(0, 150)}`);
  check("… sans seconde écriture d'acquisition", (await entriesOf(g, "IMMO-ACH")).length === 0);
  const fa2 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-DET", name: "Groupe électrogène", category: "equipment", acquisitionDate: today, acquisitionCost: 900000, origin: "supplier", supplierId: sup });
  const e2 = (await entriesOf(g, "IMMO-DET"))[0];
  check("dette fournisseur : 2… au débit, 401100 au nom du fournisseur", fa2.status === 201 && e2 && balancedE(e2)
    && e2.lines.some(l => /^2/.test(l.accountCode) && l.debit === 900000) && e2.lines.some(l => l.accountCode === "401100" && l.credit === 900000), J(e2?.lines));
  const fa3 = await g.req("POST", "/api/fixed-assets", { code: "IMMO-REP", name: "Bureau", category: "furniture", acquisitionDate: "2024-01-10", acquisitionCost: 150000, origin: "existing" });
  check("reprise d'un bien déjà au bilan : aucune écriture", fa3.status === 201 && (await entriesOf(g, "IMMO-REP")).length === 0);
  check("achat d'origine sans compte 2… : refusé", (await g.req("POST", "/api/fixed-assets", { code: "IMMO-X", name: "x", category: "other", acquisitionDate: today, acquisitionCost: 1, origin: "purchase", purchaseId: id(await g.req("POST", "/api/achats", { kind: "invoice", payee: "x", date: today, validate: true, lines: [{ description: "x", accountCode: "605000", amountHT: 1000 }] })) })).status === 400);

  console.log("\n▶ Retenue à la source sur le compte fournisseur commun");
  const rt = await g.req("POST", "/api/fiscal/retenues", { type: "prestation_service", beneficiaire: "Prestataire", montantBrut: 100000 });
  const rtE = (await entriesOf(g, "RTS-"))[0];
  check("retenue enregistrée sur 401100 (et plus 401000)", rt.status === 201 && rtE && rtE.lines.some(l => l.accountCode === "401100") && !rtE.lines.some(l => l.accountCode === "401000"), `${rt.status} ${J(rtE?.lines ?? rt.data).slice(0, 200)}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
