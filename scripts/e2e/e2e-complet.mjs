// Scénario de bout en bout : organisation cloisonnée (services × niveaux).
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

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);

  console.log("\n▶ Trésorerie");
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque BIA", type: "bank", openingBalance: 5000000, openingDate: "2026-01-01" }));
  const cash = id(await g.req("POST", "/api/treasury-accounts", { label: "Caisse siège", type: "cash", openingBalance: 200000, openingDate: "2026-01-01" }));
  const tr = await g.req("POST", "/api/treasury-accounts/movements", { kind: "transfer", fromAccountId: bank, toAccountId: cash, amount: 100000, date: today, label: "Alimentation caisse" });
  const bal = async () => Object.fromEntries((D(await g.req("GET", "/api/treasury-accounts")).items ?? []).map(a => [a._id, a.balance]));
  let b = await bal();
  check("virement interne : soldes recalculés à partir des mouvements", tr.status === 201 && b[bank] === 4900000 && b[cash] === 300000, `${tr.status} ${J(b)} ${J(tr.data).slice(0, 150)}`);
  const man = await g.req("POST", "/api/treasury-accounts/movements", { kind: "manual", accountId: bank, direction: "out", amount: 5000, date: today, label: "Frais de tenue de compte", counterAccount: "631000" });
  b = await bal();
  check("opération manuelle (frais bancaires) : écriture + mouvement", man.status === 201 && b[bank] === 4895000, `${man.status} ${J(man.data).slice(0, 150)}`);
  check("compte avec mouvements : suppression refusée", (await g.req("DELETE", `/api/treasury-accounts/${bank}`)).status === 400);

  console.log("\n▶ Stock (CMUP, contre-mouvement, réception de commande)");
  const prod = D(await g.req("POST", "/api/products", { code: "ART-E2E", label: "Clavier USB", unitPrice: 8000, initialQty: 10, initialCost: 1000, category: "Informatique", location: "Magasin A" }));
  check("article créé avec stock initial passé en mouvement", prod?.stockQty === 10 && prod?.purchaseCost === 1000, J(prod));
  const e1 = await g.req("POST", "/api/stock/movements", { productId: prod._id, type: "entry", quantity: 10, unitCost: 2000, reason: "Achat comptant" });
  check("entrée valorisée : CMUP recalculé (1 500)", e1.status === 201 && D(e1).avgCost === 1500, J(e1.data));
  check("sortie au-delà du stock : refusée", (await g.req("POST", "/api/stock/movements", { productId: prod._id, type: "exit", quantity: 25, reason: "Test" })).status === 400);
  const ex = await g.req("POST", "/api/stock/movements", { productId: prod._id, type: "exit", quantity: 5, reason: "Consommation" });
  const rv = await g.req("DELETE", `/api/stock/movements/${D(ex).movementId}?reason=erreur`);
  const p2 = D(await g.req("GET", `/api/products/${prod._id}`));
  check("annulation d'un mouvement par contre-mouvement (stock rétabli)", rv.status === 200 && p2.stockQty === 20, `${rv.status} ${p2.stockQty}`);
  const csv = await g.req("GET", `/api/stock/movements?productId=${prod._id}&format=csv`);
  check("journal des mouvements exportable (CSV)", csv.status === 200 && /Clavier USB/.test(csv.data));
  const sup = (D(await g.req("GET", "/api/suppliers?limit=5")).items ?? [])[0] ?? D(await g.req("POST", "/api/suppliers", { code: "FRN-E2E", name: "Fournisseur E2E" }));
  const bc = D(await g.req("POST", "/api/commandes", { supplierId: sup._id, orderDate: today, lines: [{ productId: prod._id, quantity: 4, unitPrice: 3000, tvaRate: 0.19 }, { description: "Transport", quantity: 1, unitPrice: 5000, tvaRate: 0 }] }));
  check("commande : article lié, totaux serveur", bc?.lines?.[0]?.productId && bc.totalHT === 17000, J(bc).slice(0, 200));
  check("réception avant confirmation : refusée", (await g.req("POST", `/api/commandes/${bc._id}/receive`, { all: true })).status === 400);
  await g.req("PATCH", `/api/commandes/${bc._id}`, { status: "confirmed" });
  const rc1 = await g.req("POST", `/api/commandes/${bc._id}/receive`, { lines: [{ index: 0, quantity: 2 }] });
  const p3 = D(await g.req("GET", `/api/products/${prod._id}`));
  check("réception partielle : +2 en stock, statut partiel", rc1.status === 200 && D(rc1).status === "partially_received" && p3.stockQty === 22, `${rc1.status} ${D(rc1).status} ${p3.stockQty}`);
  check("réception au-delà du commandé : refusée", (await g.req("POST", `/api/commandes/${bc._id}/receive`, { lines: [{ index: 0, quantity: 3 }] })).status === 400);
  check("statut « reçu » forcé à la main : refusé", (await g.req("PATCH", `/api/commandes/${bc._id}`, { status: "received" })).status === 400);
  const rc2 = await g.req("POST", `/api/commandes/${bc._id}/receive`, { all: true });
  const p4 = D(await g.req("GET", `/api/products/${prod._id}`));
  check("réception du solde : commande reçue, stock 24", D(rc2).status === "received" && p4.stockQty === 24, `${D(rc2).status} ${p4.stockQty}`);

  console.log("\n▶ Achats imputés, coût réel des projets, rentabilité par secteur");
  const sector = id(await g.req("POST", "/api/analytics/activities", { name: "Communication E2E" }));
  const prj = id(await g.req("POST", "/api/projects", { code: "PRJ-COST", name: "Campagne client", budget: 1000000 }));
  const pu = await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup._id, supplierRef: "F-889", date: today, validate: true,
    lines: [{ description: "Impression affiches", accountCode: "627000", quantity: 1, unitPrice: 50000, tvaRate: 0.19, projectId: prj, activityId: sector }] });
  const pid = id(pu);
  check("facture fournisseur validée (écriture AC, TVA récupérable, 401)", pu.status === 201 && D(pu).status === "validated" && D(pu).totalTTC === 59500, `${pu.status} ${J(pu.data).slice(0, 200)}`);
  const pay1 = await g.req("POST", `/api/achats/${pid}/pay`, { amount: 30000, treasuryAccountId: bank });
  check("règlement partiel", pay1.status === 200 && D(pay1).status === "partial", `${pay1.status} ${J(pay1.data).slice(0, 150)}`);
  const payId = D(pay1).payments?.[0]?._id;
  const cp = await g.req("DELETE", `/api/achats/${pid}/payments/${payId}`);
  check("annulation du règlement : extourne, reste à payer rouvert", cp.status === 200 && D(cp).status === "validated" && D(cp).paidAmount === 0, `${cp.status} ${J(cp.data).slice(0, 150)}`);
  const pay2 = await g.req("POST", `/api/achats/${pid}/pay`, { treasuryAccountId: bank });
  check("règlement du solde : payé", D(pay2).status === "paid", J(pay2.data).slice(0, 120));
  const cashExp = await g.req("POST", "/api/achats", { kind: "cash", payee: "Station Total", date: today,
    lines: [{ description: "Carburant tournage", accountCode: "605300", amountHT: 20000, projectId: prj, activityId: sector }], payment: { treasuryAccountId: cash } });
  check("dépense au comptant validée et payée en caisse", cashExp.status === 201 && D(cashExp).status === "paid", `${cashExp.status} ${J(cashExp.data).slice(0, 150)}`);
  b = await bal();
  check("caisse débitée de la dépense", b[cash] === 280000, J(b));
  const draft = id(await g.req("POST", "/api/achats", { kind: "invoice", payee: "Divers", lines: [{ description: "x", accountCode: "658000", amountHT: 1000 }] }));
  check("brouillon supprimable", (await g.req("DELETE", `/api/achats/${draft}`)).status === 204);
  check("compte hors classes 6/2 refusé sur un achat", (await g.req("POST", "/api/achats", { payee: "x", lines: [{ description: "x", accountCode: "411000", amountHT: 1000 }] })).status === 400);

  const client = (D(await g.req("GET", "/api/clients?limit=1")).items ?? [])[0];
  const inv = await g.req("POST", "/api/invoices", { clientId: client._id, issueDate: today, dueDate: today, projectId: prj, activityId: sector,
    lines: [{ description: "Conception campagne", quantity: 1, unitPrice: 300000, tvaRate: 0.19 }, { productId: prod._id, description: "Clavier USB", quantity: 2, unitPrice: 8000, tvaRate: 0.19 }] });
  check("facture de vente imputée au projet et au secteur", inv.status === 201, `${inv.status} ${J(inv.data).slice(0, 150)}`);
  let pf = D(await g.req("GET", `/api/projects/${prj}`));
  check("brouillon : aucune recette comptabilisée", pf.finance?.revenue === 0, J(pf.finance));
  check("émission de la facture", (await g.req("POST", `/api/invoices/${D(inv)._id}/send`)).status === 200);
  pf = D(await g.req("GET", `/api/projects/${prj}`));
  check("coût réel du projet = charges imputées (70 000)", pf.finance?.cost === 70000, J(pf.finance));
  check("recettes du projet = CA HT imputé (316 000)", pf.finance?.revenue === 316000, J(pf.finance));
  const rep = D(await g.req("GET", "/api/analytics/report"));
  const sec = (rep.sectors ?? []).find(x => x.activityId === sector);
  check("rentabilité du secteur alimentée par la comptabilité", sec?.fromAccounting?.revenue === 316000 && sec?.fromAccounting?.expense === 70000, J(sec));
  const invId = id(inv);
  const pay = await g.req("POST", "/api/payments", { invoiceId: invId, amount: 100000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  const cpay = await g.req("POST", `/api/payments/${id(pay)}/cancel`, { reason: "chèque impayé" });
  const invAfter = D(await g.req("GET", `/api/invoices/${invId}`));
  check("encaissement annulé : facture rouverte", pay.status === 201 && cpay.status === 200 && invAfter.paidAmount === 0, `${pay.status} ${cpay.status} ${invAfter.paidAmount}`);
  const canc = await g.req("POST", `/api/invoices/${invId}/cancel`);
  const pf2 = D(await g.req("GET", `/api/projects/${prj}`));
  check("facture annulée : recette du projet extournée", canc.status === 200 && pf2.finance?.revenue === 0, `${canc.status} ${J(pf2.finance)}`);

  console.log("\n▶ Paie");
  const emps = D(await g.req("GET", "/api/employees?limit=100")).items ?? [];
  const t01 = emps.find(e => e.code === "EMP-T01");
  const ps = await g.req("POST", "/api/payslips", { employeeId: t01._id, month: 1, year: 2026, grossSalary: 0, items: [{ label: "Prime de rendement", amount: 50000, type: "addition" }] });
  check("bulletin calculé sur le salaire de la fiche (brut 0 envoyé)", ps.status === 201 && D(ps).grossSalary === 500000 && D(ps).incomeTax > 0 && D(ps).grossTotal >= 550000, `${ps.status} ${J(ps.data).slice(0, 200)}`);
  const batch = await g.req("POST", "/api/payslips/batch", { month: 1, year: 2026 });
  check("paie du mois : les autres salariés générés, le doublon écarté", batch.status === 200 && D(batch).created.length >= 1 && D(batch).skipped.some(x => /déjà/.test(x.reason)), J(batch.data).slice(0, 250));
  check("paiement sans compte : refusé", (await g.req("POST", `/api/payslips/${id(ps)}/pay`, {})).status === 400);
  const pp = await g.req("POST", `/api/payslips/${id(ps)}/pay`, { treasuryAccountId: bank });
  check("paiement du salaire depuis la banque", pp.status === 200, `${pp.status} ${J(pp.data).slice(0, 150)}`);
  check("bulletin payé : suppression refusée", (await g.req("DELETE", `/api/payslips/${id(ps)}`)).status === 400);
  const other = (D(await g.req("GET", "/api/payslips?month=1&year=2026")).items ?? []).find(x => !x.isPaid);
  check("bulletin non payé : supprimé avec extourne", other && (await g.req("DELETE", `/api/payslips/${other._id}`)).status === 204);
  const pdet = D(await g.req("GET", `/api/payslips/${id(ps)}`));
  check("bulletin imprimé : identité réelle de l'employeur, détail des primes", pdet.employer?.name && pdet.items?.length === 1, J({ e: pdet.employer?.name, i: pdet.items }));

  console.log("\n▶ Congés");
  const PW2 = PW;
  const devChef = id(await g.req("POST", "/api/users", { email: "dev.chef@test.ne", password: PW2, firstName: "Chef", lastName: "Dev", roles: ["svc_dev"], roleLevels: { svc_dev: "chef" } }));
  const devEmp = id(await g.req("POST", "/api/users", { email: "dev.emp@test.ne", password: PW2, firstName: "Emp", lastName: "Dev", roles: ["svc_dev"], roleLevels: { svc_dev: "employe" } }));
  const t02 = emps.find(e => e.code === "EMP-T02");
  const link = await g.req("PATCH", `/api/employees/${t02._id}`, { userId: devEmp });
  check("fiche salarié rattachée à un compte", link.status === 200, `${link.status} ${J(link.data).slice(0, 120)}`);
  const { s: se } = await login("dev.emp@test.ne", PW2);
  const { s: sc } = await login("dev.chef@test.ne", PW2);
  const lv = await se.req("POST", "/api/leaves", { type: "annual", startDate: "2026-11-02", endDate: "2026-11-04" });
  check("demande de congé : 3 jours ouvrables", lv.status === 201 && D(lv).days === 3, `${lv.status} ${J(lv.data).slice(0, 150)}`);
  check("chevauchement refusé", (await se.req("POST", "/api/leaves", { type: "annual", startDate: "2026-11-03", endDate: "2026-11-05" })).status === 400);
  check("l'employé ne valide pas", (await se.req("PATCH", `/api/leaves/${id(lv)}`, { action: "approve" })).status === 403);
  const ap = await sc.req("PATCH", `/api/leaves/${id(lv)}`, { action: "approve" });
  const mine = D(await se.req("GET", "/api/leaves?scope=mine"));
  check("le chef de service valide ; solde mis à jour", ap.status === 200 && mine.balance?.taken === 3 && mine.balance.acquired > 100, `${ap.status} ${J(mine.balance)}`);

  console.log("\n▶ Comptabilité");
  check("saisie sur un compte hors plan : refusée", (await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "T1", label: "x", lines: [{ accountCode: "999999", accountLabel: "x", debit: 10 }, { accountCode: "521000", accountLabel: "Banque", credit: 10 }] })).status === 400);
  check("ligne au débit ET au crédit : refusée", (await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "T2", label: "x", lines: [{ accountCode: "627000", accountLabel: "x", debit: 10, credit: 10 }, { accountCode: "521000", accountLabel: "Banque", credit: 0, debit: 0 }] })).status === 400);
  const me1 = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: today, reference: "T3", label: "Publicité", lines: [{ accountCode: "627000", accountLabel: "Publicité", debit: 15000, projectId: prj }, { accountCode: "471000", accountLabel: "Divers", credit: 15000 }] });
  check("saisie manuelle imputée", me1.status === 201, `${me1.status} ${J(me1.data).slice(0, 150)}`);
  const ext = await g.req("POST", `/api/accounting-entries/${id(me1)}/reverse`, { reason: "doublon" });
  check("extourne d'une écriture manuelle (journal EX)", ext.status === 201 && D(ext).journalCode === "EX", `${ext.status} ${J(ext.data).slice(0, 120)}`);
  check("double extourne refusée", (await g.req("POST", `/api/accounting-entries/${id(me1)}/reverse`, { reason: "x" })).status === 400);
  const invEntry = (D(await g.req("GET", "/api/accounting-entries?journal=AC&limit=5")).items ?? [])[0];
  check("écriture d'un document : extourne manuelle refusée", invEntry && (await g.req("POST", `/api/accounting-entries/${invEntry._id}/reverse`, { reason: "x" })).status === 400);
  const bl = D(await g.req("GET", `/api/accounting/reports?type=balance&from=2020-01-01&to=${today}`));
  check("balance générale équilibrée", bl.totals && bl.totals.debit === bl.totals.credit && bl.totals.debit > 0, J(bl.totals));
  const bs = D(await g.req("GET", `/api/accounting/reports?type=bs&to=${today}`));
  check("bilan équilibré (actif = passif)", Math.abs(bs.totalActif - bs.totalPassif) <= 1, `${bs.totalActif} / ${bs.totalPassif}`);
  const gl = D(await g.req("GET", `/api/accounting/reports?type=ledger&account=521&from=2026-01-01&to=${today}`));
  check("grand livre de la banque avec solde progressif", gl.lines?.length > 0 && gl.closingBalance === gl.lines[gl.lines.length - 1].balance, J({ n: gl.lines?.length, c: gl.closingBalance }));
  const plan = D(await g.req("GET", "/api/ledger-accounts?q=627"));
  check("plan comptable initialisé (SYSCOHADA)", Array.isArray(plan) && plan.some(a => a.code === "627000"), J(plan).slice(0, 120));
  const lock = await g.req("POST", "/api/accounting/closing", { action: "lock", until: "2026-06-30" });
  const locked = await g.req("POST", "/api/accounting-entries", { journalCode: "OD", entryDate: "2026-05-10", reference: "T4", label: "Ancienne", lines: [{ accountCode: "627000", accountLabel: "Pub", debit: 100 }, { accountCode: "471000", accountLabel: "Divers", credit: 100 }] });
  check("période verrouillée : écriture datée dedans refusée", lock.status === 200 && locked.status === 400 && /clôturée/.test(locked.data?.error), `${lock.status} ${locked.status} ${J(locked.data)}`);

  console.log("\n▶ Charges récurrentes, prévision, budget");
  const recR = await g.req("POST", "/api/recurring-expenses", { label: "Loyer bureau", category: "loyer", amount: 400000, frequency: "monthly", startDate: today, accountCode: "622100", treasuryAccountId: bank, activityId: sector });
  const rec = D(recR);
  check("charge créée, première échéance = date de début", rec?.nextDueDate?.slice(0, 10) === today, `${recR.status} ${J(recR.data).slice(0, 200)}`);
  const ex1 = await g.req("POST", `/api/recurring-expenses/${rec._id}`, {});
  const rec2 = D(await g.req("GET", `/api/recurring-expenses/${rec._id}`));
  check("paiement de l'échéance : échéance suivante (+1 mois)", ex1.status === 200 && new Date(rec2.nextDueDate) > new Date(today), `${ex1.status} ${rec2.nextDueDate}`);
  const fc = D(await g.req("GET", "/api/treasury-accounts/forecast?weeks=13"));
  check("prévision de trésorerie sur 13 semaines", fc.weeks?.length === 13 && typeof fc.opening === "number" && fc.totals.out > 0, J({ o: fc.opening, t: fc.totals }));
  const bud = await g.req("POST", "/api/budget-previsionnel", { year: 2026, lines: [{ accountPrefix: "62", label: "Services extérieurs", nature: "expense", annualAmount: 6000000 }] });
  const put = await g.req("PUT", "/api/budget-previsionnel", { year: 2026, lines: [{ accountPrefix: "62", label: "Services extérieurs", nature: "expense", annualAmount: 7000000 }, { accountPrefix: "70", label: "Ventes", nature: "revenue", annualAmount: 20000000 }] });
  const del = await g.req("DELETE", "/api/budget-previsionnel?year=2026");
  check("budget : création, révision, suppression", bud.status === 201 && put.status === 200 && del.status === 200, `${bud.status} ${put.status} ${del.status}`);

  console.log("\n▶ Cloisonnement des nouveaux modules");
  check("employé Développement : achats et plan comptable fermés", (await se.req("GET", "/api/achats")).status === 403 && (await se.req("GET", "/api/ledger-accounts")).status === 403 && (await se.req("GET", "/api/treasury-accounts/forecast")).status === 403);
  const cc = D(await sc.req("GET", `/api/projects/${prj}`));
  check("chef Développement : projet sans coût ni budget", cc._id && !cc.finance && !("budget" in cc), J(Object.keys(cc)));

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
