// Scénario de bout en bout : filtre commun recettes / dépenses / période.
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

const today = new Date().toISOString().slice(0, 10);
const id = r => D(r)?._id;

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const past = "2025-03-15";

  console.log("\n▶ Comptoir : caisse filtrée");
  const desk = id(await g.req("POST", "/api/comptoir/desks", { name: "Spot flux" }));
  for (const [direction, amount, date] of [["in", 1000, today], ["in", 2500, today], ["out", 400, today], ["in", 9999, past]])
    await g.req("POST", "/api/comptoir/cash", { deskId: desk, direction, amount, label: `${direction} ${amount}`, method: "cash", date });
  const all = D(await g.req("GET", `/api/comptoir/cash?deskId=${desk}&from=${today}&to=${today}`));
  check("période du jour : 3 écritures, totaux recettes 3 500 / dépenses 400 / solde 3 100", all.items?.length === 3 && all.totals?.in === 3500 && all.totals?.out === 400 && all.totals?.balance === 3100, J(all.totals));
  const rec = D(await g.req("GET", `/api/comptoir/cash?deskId=${desk}&flow=in&from=${today}&to=${today}`));
  check("filtre recettes : seulement les entrées, totaux inchangés", rec.items?.length === 2 && rec.items.every(e => e.direction === "in") && rec.totals?.out === 400, J(rec.items?.map(e => e.direction)));
  const dep = D(await g.req("GET", `/api/comptoir/cash?deskId=${desk}&flow=out`));
  check("filtre dépenses sans période : la dépense seule", dep.items?.length === 1 && dep.items[0].amount === 400 && dep.totals?.in === 13499);
  const pdf = await g.req("GET", `/api/comptoir/report?deskId=${desk}&from=${today}&to=${today}&flow=out`);
  check("rapport PDF limité aux dépenses", pdf.status === 200);

  console.log("\n▶ Trésorerie : virements internes hors recettes / dépenses");
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque flux", type: "bank", openingBalance: 1000000, openingDate: "2025-01-01" }));
  const caisse = id(await g.req("POST", "/api/treasury-accounts", { label: "Caisse flux", type: "cash", openingBalance: 0, openingDate: "2025-01-01" }));
  await g.req("POST", "/api/treasury-accounts/movements", { kind: "manual", accountId: bank, direction: "out", amount: 5000, date: today, label: "Frais bancaires", counterAccount: "631000" });
  await g.req("POST", "/api/treasury-accounts/movements", { kind: "manual", accountId: bank, direction: "in", amount: 70000, date: today, label: "Subvention", counterAccount: "758000" });
  await g.req("POST", "/api/treasury-accounts/movements", { kind: "transfer", fromAccountId: bank, toAccountId: caisse, amount: 100000, date: today, label: "Alimentation caisse" });
  const tAll = D(await g.req("GET", `/api/treasury-accounts/movements?accountId=${bank}&from=${today}&to=${today}`));
  check("compte : 3 mouvements listés, totaux hors virement (70 000 / 5 000)", tAll.items?.length === 3 && tAll.totals?.in === 70000 && tAll.totals?.out === 5000, `${tAll.items?.length} ${J(tAll.totals)}`);
  const tOut = D(await g.req("GET", `/api/treasury-accounts/movements?accountId=${bank}&flow=out&from=${today}&to=${today}`));
  check("dépenses du compte : le virement n'y figure pas", tOut.items?.length === 1 && tOut.items[0].amount === -5000, J(tOut.items?.map(m => m.amount)));
  const tGlobal = D(await g.req("GET", `/api/treasury-accounts/movements?flow=in&from=${today}&to=${today}`));
  check("tous comptes, recettes : la subvention, pas l'arrivée du virement en caisse", tGlobal.items?.length === 1 && tGlobal.items[0].amount === 70000, J(tGlobal.items?.map(m => [m.amount, m.source])));

  console.log("\n▶ Analytique et journal");
  await g.req("POST", "/api/analytics/entries", { kind: "revenue", label: "Vente", amount: 8000, date: today });
  await g.req("POST", "/api/analytics/entries", { kind: "expense", label: "Achat", amount: 3000, date: today });
  const an = D(await g.req("GET", `/api/analytics/entries?flow=out&from=${today}&to=${today}`));
  check("analytique : filtre dépenses + totaux de la période", an.items?.length >= 1 && an.items.every(e => e.kind === "expense") && an.totals?.in >= 8000 && an.totals?.out >= 3000, J(an.totals));
  const ac = D(await g.req("GET", `/api/accounting-entries?flow=out&from=${today}&to=${today}`));
  check("journal : dépenses = écritures avec une charge (classe 6)", ac.items?.length >= 1 && ac.items.every(e => e.lines.some(l => /^6/.test(l.accountCode))), J(ac.items?.map(e => e.reference)));
  const acIn = D(await g.req("GET", `/api/accounting-entries?flow=in&from=${today}&to=${today}`));
  check("journal : recettes = écritures avec un produit (classe 7), totaux 7 / 6", acIn.items?.every(e => e.lines.some(l => /^7/.test(l.accountCode))) && acIn.totals?.in >= 70000 && acIn.totals?.out >= 5000, J(acIn.totals));
  const rep = D(await g.req("GET", `/api/analytics/report?from=${today}&to=${today}`));
  check("rentabilité : date de fin incluse", (rep.consolidated?.revenue ?? rep.general?.revenue ?? 0) >= 8000, J(rep.consolidated ?? rep.general));

  console.log("\n▶ Contrats : champs protégés, facture équilibrée");
  const cli = id(await g.req("POST", "/api/clients", { code: "C-FLUX", name: "Client flux" }));
  const ct = await g.req("POST", "/api/contracts", { title: "Maintenance", type: "client", clientId: cli, amount: 100000, reference: "PIRATE", invoiceIds: ["000000000000000000000000"], status: "active", isRecurring: true, billingFrequency: "monthly" });
  const ctId = id(ct);
  check("création : référence et factures liées ignorées", ct.status === 201 && D(ct).reference !== "PIRATE" && (D(ct).invoiceIds ?? []).length === 0, J(D(ct)).slice(0, 150));
  const hijack = await g.req("PATCH", `/api/contracts/${ctId}`, { tenantId: "000000000000000000000000", title: "Maintenance annuelle" });
  const after = await g.req("GET", `/api/contracts/${ctId}`);
  check("modification : l'organisation ne se réécrit pas, le titre si", hijack.status === 200 && after.status === 200 && D(after).title === "Maintenance annuelle", `${hijack.status} ${after.status}`);
  check("modification : client d'une autre organisation refusé", (await g.req("PATCH", `/api/contracts/${ctId}`, { clientId: "000000000000000000000000" })).status === 400);
  const gen = await g.req("POST", `/api/contracts/${ctId}/generate-invoice`);
  const inv = D(gen).invoice;
  check("facture de contrat créée en brouillon, sans écriture", inv?.status === "draft"
    && !(D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(inv?.number ?? "x")}`)).items ?? []).length);
  await g.req("POST", `/api/invoices/${inv?._id}/send`); Object.assign(inv ?? {}, D(await g.req("GET", `/api/invoices/${inv?._id}`)));
  const vt = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(inv?.number ?? "x")}`)).items ?? [])[0];
  const deb = vt?.lines?.reduce((t, l) => t + l.debit, 0), cred = vt?.lines?.reduce((t, l) => t + l.credit, 0);
  check("facture depuis un contrat : écriture équilibrée, timbre en 447", gen.status === 200 && vt && deb === cred && deb === inv.totalTTC && (inv.totalDTS === 0 || vt.lines.some(l => l.accountCode === "447000")), `${gen.status} ${deb}/${cred} TTC ${inv?.totalTTC} DTS ${inv?.totalDTS}`);

  console.log("\n▶ Étape 1 : TVA, marché-cadre, reste à payer, trésorerie obligatoire");
  const supT = id(await g.req("POST", "/api/suppliers", { code: "F-TVA", name: "Fournisseur TVA" }));
  await g.req("POST", "/api/achats", { kind: "invoice", supplierId: supT, date: today, validate: true, lines: [{ description: "Fournitures", accountCode: "604000", quantity: 1, unitPrice: 100000, tvaRate: 0.19 }] });
  const now = new Date();
  const tva = D(await g.req("GET", `/api/fiscal/tva?annee=${now.getFullYear()}&mois=${now.getMonth() + 1}`));
  check("TVA déductible des achats reprise dans l'état de TVA", tva.tvaDeductible >= 19000, J(tva));
  const cliF = id(await g.req("POST", "/api/clients", { code: "C-MCF", name: "Client marché-cadre" }));
  const fo = id(await g.req("POST", "/api/marches-cadres", { clientId: cliF, title: "Fourniture annuelle", totalQuantity: 100, unitPrice: 5000 }));
  const lot = D(await g.req("POST", `/api/marches-cadres/${fo}/lots`, { quantity: 10 }));
  const lotId = lot._id ?? (D(await g.req("GET", `/api/marches-cadres/${fo}/lots`)).items ?? [])[0]?._id;
  const fac = await g.req("POST", `/api/marches-cadres/${fo}/lots/${lotId}/facturer`, {});
  const facInv = D(fac);
  const vtF = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(facInv.number ?? "x")}`)).items ?? [])[0];
  check("facture de lot : timbre et écriture de vente équilibrée", fac.status === 201 && facInv.totalDTS > 0 && vtF && vtF.lines.reduce((t, l) => t + l.debit, 0) === vtF.lines.reduce((t, l) => t + l.credit, 0), `${fac.status} ${J(facInv).slice(0, 120)}`);
  check("encaissement effectif sans compte de trésorerie : refusé", (await g.req("POST", "/api/payments", { invoiceId: facInv._id, amount: 1000, method: "cash", date: today })).status === 400);
  await g.req("POST", `/api/invoices/${facInv._id}/credit-note`, { reason: "Remise", lines: [{ lineIndex: 0, quantity: 2 }] });
  const over = await g.req("POST", "/api/payments", { invoiceId: facInv._id, amount: facInv.totalTTC, method: "bank_transfer", date: today, treasuryAccountId: bank });
  check("après un avoir partiel, payer le TTC d'origine est refusé", over.status === 400, `${over.status} ${J(over.data)}`);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
