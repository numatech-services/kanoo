// Scénario de bout en bout : conditions d'un marché public (redevance, pénalités, délai de paiement, intérêts) et types de dépenses.
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


const dayAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const { s: other } = await login("president@test.ne", SEED_PW);
  const fin = async c => D(await g.req("GET", `/api/contracts/${c}/finance`));
  const row = (f, key) => (f.costs?.byType ?? []).find(r => r.key === key);

  const cli = id(await g.req("POST", "/api/clients", { code: "C-UDH", name: "Université de test" }));
  const bank = id(await g.req("POST", "/api/treasury-accounts", { label: "Banque marché", type: "bank", openingBalance: 5000000, openingDate: "2025-01-01" }));
  const market = async (title, extra) => {
    const r = await g.req("POST", "/api/contracts", { title, type: "client", clientId: cli, buyerType: "public_establishment", tvaRate: 0.19, ...extra });
    return id(r);
  };

  console.log("\n▶ Redevance de régulation et FSSP");
  const l1 = await market("Lot 1", { amount: 18085200, amountTTC: 21521388, paymentDays: 60 });
  const l2 = await market("Lot 2", { amount: 23737477, amountTTC: 28247598 });
  let f = await fin(l1);
  check("Lot 1 : 225 975 FCFA calculés sur le TTC", f.terms?.regulation?.estimate === 225975 && f.terms.baseKind === "TTC", J(f.terms));
  check("Lot 2 : 296 600 FCFA", (await fin(l2)).terms?.regulation?.estimate === 296600);
  check("la redevance calculée entre dans l'engagé", row(f, "regulation")?.committed === 225975 && row(f, "regulation")?.estimated === 225975, J(f.costs?.byType));
  const before = f.margin.atCompletion;
  const small = await market("Petit marché", { amount: 4000000 });
  check("sous le seuil : pas de redevance", (await fin(small)).terms?.regulation?.applicable === false);
  const priv = await market("Marché privé", { amount: 6000000, buyerType: "private", tvaRate: 0 });
  check("marché privé : pas de redevance d'office", (await fin(priv)).terms?.regulation?.estimate === 0);
  await g.req("PATCH", `/api/contracts/${priv}`, { regulationRate: 0.02 });
  check("taux saisi : appliqué", (await fin(priv)).terms?.regulation?.estimate === 120000);
  await g.req("PATCH", `/api/contracts/${priv}`, { regulationRate: null });
  check("taux effacé : retour au défaut", (await fin(priv)).terms?.regulation?.estimate === 0);
  check("taux hors limites refusé", (await g.req("PATCH", `/api/contracts/${priv}`, { regulationRate: 2 })).status === 400);

  console.log("\n▶ Pénalités de retard");
  await g.req("PATCH", `/api/contracts/${l1}`, { serviceOrderDate: dayAgo(40), executionDelay: 30, executionUnit: "days", penaltyDivisor: 2000 });
  f = await fin(l1);
  check("10 jours de retard × 10 761 = 107 607", f.terms?.penalty?.daysLate === 10 && f.terms.penalty.perDay === 10761 && f.terms.penalty.estimate === 107607, J(f.terms?.penalty));
  check("pénalité calculée déduite de la marge à terminaison", f.margin.atCompletion === before - 107607, `${before} → ${f.margin.atCompletion}`);
  await g.req("PATCH", `/api/contracts/${l1}`, { deliveredAt: dayAgo(7) });
  f = await fin(l1);
  check("la livraison arrête le décompte (3 jours)", f.terms?.penalty?.daysLate === 3 && f.terms.penalty.delivered === true, J(f.terms?.penalty));

  console.log("\n▶ Types de dépenses");
  const types = D(await g.req("GET", "/api/contracts/cost-types")).items ?? [];
  const T = k => types.find(t => t.key === k)?._id;
  check("types fournis d'office, sans enregistrement", types.length === 9 && T("regulation") && T("bank") && !types.some(t => /^646/.test(t.accountCode)), J(types.map(t => t.key)));
  check("créer un type : compte de classe 6 exigé", (await g.req("POST", "/api/contracts/cost-types", { label: "Mauvais", accountCode: "401100" })).status === 400);
  check("créer un type sur 646 : refusé", (await g.req("POST", "/api/contracts/cost-types", { label: "Timbres", accountCode: "646200" })).status === 400);
  const dd = await g.req("POST", "/api/contracts/cost-types", { label: "Frais de dédouanement", accountCode: "638000" });
  check("nouveau type créé", dd.status === 201, J(dd.data));
  check("même nom (casse, accents) refusé", (await g.req("POST", "/api/contracts/cost-types", { label: "FRAIS DE DEDOUANEMENT", accountCode: "638000" })).status === 400);
  check("redevance non désactivable", (await g.req("PATCH", `/api/contracts/cost-types/${T("regulation")}`, { isActive: false })).status === 400);
  check("autre organisation : type inaccessible", [403, 404, 400].includes((await other.req("PATCH", `/api/contracts/cost-types/${T("bank")}`, { label: "Piraté" })).status));

  console.log("\n▶ Dépenses saisies");
  const noProject = D(await g.req("GET", `/api/contracts/${l1}`)).projectId;
  const paid = await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("bank"), amountHT: 5000, state: "paid", treasuryAccountId: bank, date: today, payee: "Banque" });
  check("frais bancaires payés", paid.status === 201 && D(paid).status === "paid", J(paid.data));
  const proj = D(await g.req("GET", `/api/contracts/${l1}`)).projectId;
  check("projet d'exécution créé à la première dépense", !noProject && proj?._id, J(proj));
  await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("delivery"), amountHT: 100000, tvaRate: 0.19, state: "due", payee: "Transporteur", date: today });
  await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("goods"), amountHT: 300000, state: "planned", payee: "Fournisseur", date: today });
  const nt = await g.req("POST", `/api/contracts/${l1}/costs`, { newType: { label: "Assurance transport", accountCode: "625000" }, amountHT: 20000, state: "due", date: today });
  check("type créé à la volée avec sa dépense", nt.status === 201, J(nt.data));
  check("paiement sans compte refusé", (await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("bank"), amountHT: 100, state: "paid" })).status === 400);
  check("montant nul refusé", (await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("bank"), amountHT: 0, state: "due" })).status === 400);
  const failed = await g.req("POST", `/api/contracts/${l1}/costs`, { newType: { label: "Type orphelin", accountCode: "638000" }, amountHT: 0, state: "due" });
  const list = D(await g.req("GET", "/api/contracts/cost-types")).items ?? [];
  check("dépense refusée : son nouveau type n'est pas gardé", failed.status === 400 && !list.some(t => t.label === "Type orphelin"), J(list.map(t => t.label)));
  check("marché d'une autre organisation refusé", [400, 403, 404].includes((await other.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("bank"), amountHT: 100, state: "due" })).status));

  f = await fin(l1);
  const cat = Object.fromEntries((f.costs?.categories ?? []).map(c => [c.key, c]));
  check("frais bancaires : catégorie dédiée, 5 000 réalisés", cat.bank?.actual === 5000 && row(f, "bank")?.actual === 5000, J({ c: cat.bank, r: row(f, "bank") }));
  check("livraison 100 000 HT réalisés (TVA hors marge)", row(f, "delivery")?.actual === 100000 && cat.transport?.actual === 100000, J(row(f, "delivery")));
  check("achat prévu : 300 000 engagés", row(f, "goods")?.committed === 300000 && row(f, "goods")?.actual === 0, J(row(f, "goods")));
  check("nouveau type dans le détail", (f.costs.byType ?? []).some(r => r.label === "Assurance transport" && r.actual === 20000), J(f.costs.byType));
  const sumC = f.costs.byType.reduce((t, r) => t + r.committed, 0), sumA = f.costs.byType.reduce((t, r) => t + r.actual, 0);
  check("le détail par type retombe sur les totaux", sumC === f.costs.committed && sumA === f.costs.actual, J({ sumC, sumA, c: f.costs.committed, a: f.costs.actual }));
  check("marge à terminaison = marché − réalisé − engagé", f.margin.atCompletion === f.contractHT - f.costs.actual - f.costs.committed, J(f.margin));

  console.log("\n▶ La dépense saisie remplace le calcul");
  const committedBefore = f.costs.committed;
  const rg = await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("regulation"), amountHT: 225975, state: "paid", treasuryAccountId: bank, date: today, payee: "Trésor", supplierRef: "Q-1" });
  f = await fin(l1);
  check("redevance payée : plus rien de calculé, 225 975 réalisés", row(f, "regulation")?.estimated === 0 && row(f, "regulation")?.actual === 225975 && f.terms.regulation.recorded === 225975, J(row(f, "regulation")));
  check("pas de double compte", f.costs.committed === committedBefore - 225975, `${committedBefore} → ${f.costs.committed}`);
  const e = (D(await g.req("GET", `/api/accounting-entries?search=${encodeURIComponent(D(rg).number)}`)).items ?? []).find(x => x.journalCode === "AC");
  check("écriture équilibrée, charge 648000 imputée au projet", e && e.lines.reduce((t, l) => t + l.debit, 0) === e.lines.reduce((t, l) => t + l.credit, 0) && e.lines.some(l => l.accountCode === "648000" && l.debit === 225975 && String(l.projectId) === String(proj._id)), J(e?.lines));
  const ca = await g.req("POST", `/api/achats/${D(rg)._id}/cancel`, { reason: "Erreur" });
  if (ca.status < 300) {
    f = await fin(l1);
    check("dépense annulée : le calcul revient", row(f, "regulation")?.estimated === 225975 && row(f, "regulation")?.actual === 0, J(row(f, "regulation")));
  } else check("achat payé : annulation refusée tant que le règlement existe", ca.status === 400, `${ca.status} ${J(ca.data).slice(0, 120)}`);

  console.log("\n▶ Délai de paiement et déclaration de créance");
  await g.req("POST", `/api/contracts/${l1}/sign`, { signerName: "Gérant", signerRole: "Gérant", signedDate: today });
  const created = await g.req("POST", `/api/contracts/${l1}/invoice`, { mode: "standard", amountHT: 10000000, issueDate: dayAgo(100) });
  const inv = D(created).invoice;
  const gap = Math.round((new Date(inv?.dueDate) - new Date(inv?.issueDate)) / 86400000);
  check("échéance par défaut : émission + 60 jours", gap === 60, `${created.status} ${gap} ${J(created.data).slice(0, 160)}`);
  check("brouillon : déclaration refusée", (await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(90) })).status === 400);
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  check("date future refusée", (await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(-3) })).status === 400);
  check("date avant émission refusée", (await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(200) })).status === 400);
  check("facture d'un autre marché refusée", (await g.req("PATCH", `/api/contracts/${l2}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(90) })).status === 404);
  const cl = await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(90) });
  check("échéance = réception + 60 jours", cl.status === 200 && D(cl).dueDate?.slice(0, 10) === dayAgo(30), J(cl.data));

  console.log("\n▶ Pénalité retenue par le client");
  const inv2 = D(await g.req("POST", `/api/contracts/${l1}/invoice`, { mode: "standard", amountHT: 1000000 })).invoice;
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  let before2 = await fin(l1);
  check("retenue sur un autre type refusée", (await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("bank"), amountHT: 100, state: "withheld", invoiceId: inv2._id })).status === 400);
  check("retenue supérieure à la facture refusée", (await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("penalty"), amountHT: 9000000, state: "withheld", invoiceId: inv2._id })).status === 400);
  const wh = await g.req("POST", `/api/contracts/${l1}/costs`, { costTypeId: T("penalty"), amountHT: 32282, state: "withheld", invoiceId: inv2._id, date: today });
  let af = await fin(l1);
  check("retenue : charge réalisée, calcul déduit, créance réduite, rien d'encaissé", wh.status === 201 && row(af, "penalty")?.actual === 32282 && row(af, "penalty")?.estimated === 0 && af.billing.dueTTC === before2.billing.dueTTC - 32282 && af.billing.collectedTTC === before2.billing.collectedTTC, J({ w: wh.data, r: row(af, "penalty"), d: [before2.billing, af.billing] }));
  const pays = (D(await g.req("GET", `/api/payments?invoiceId=${inv2._id}`)).items ?? []);
  const pid2 = pays.find(p => p.penaltyAmount === 32282)?._id;
  const cx = await g.req("POST", `/api/payments/${pid2}/cancel`, { reason: "Retenue contestée" });
  af = await fin(l1);
  check("retenue annulée : créance et calcul reviennent", cx.status < 300 && af.billing.dueTTC === before2.billing.dueTTC && row(af, "penalty")?.actual === 0, `${cx.status} ${J(cx.data).slice(0, 120)} ${J(row(af, "penalty"))}`);

  console.log("\n▶ Dépense modifiée ou saisie ailleurs");
  const pl = D(await g.req("POST", `/api/contracts/${l2}/costs`, { costTypeId: T("regulation"), amountHT: 296600, state: "planned", payee: "Trésor", date: today }));
  await g.req("PATCH", `/api/achats/${pl._id}`, { lines: [{ description: "Redevance", accountCode: "648000", amountHT: 296600, projectId: D(await g.req("GET", `/api/contracts/${l2}`)).projectId?._id }] });
  let f2 = await fin(l2);
  check("brouillon modifié : pas de double compte", row(f2, "regulation")?.estimated === 0 && row(f2, "regulation")?.committed === 296600, J(row(f2, "regulation")));
  check("alerte : reste à régler à l'État", f2.terms?.alerts?.some(a => /Reste à régler/.test(a)), J(f2.terms?.alerts));
  const mis = await market("Saisie TTC en HT", { amount: 21521388, amountTTC: 21521388 });
  check("alerte : HT et TTC incohérents", (await fin(mis)).terms?.alerts?.some(a => /ne concordent pas/.test(a)));
  const noTtc = await market("Sans TTC", { amount: 18085200 });
  check("sans TTC saisi : base déduite du HT et de la TVA", (await fin(noTtc)).terms?.regulation?.estimate === 225975);

  console.log("\n▶ Droits constatés avant le projet");
  const pre = await market("Constat avant projet", { amount: 1000000, approvalDate: today, regulationRate: 0 });
  await g.req("POST", `/api/contracts/${pre}/sign`, { signerName: "G", signerRole: "G", signedDate: today });
  await g.req("POST", `/api/contracts/${pre}/registration`, { action: "assess" });
  const a0 = await fin(pre);
  await g.req("POST", `/api/contracts/${pre}/costs`, { costTypeId: T("bank"), amountHT: 1000, state: "due", date: today });
  const a1 = await fin(pre);
  check("le constat reste compté après la création du projet", a0.registration?.assessed > 0 && a1.costs.actual === a0.costs.actual + 1000, J({ a: a0.costs.actual, b: a1.costs.actual }));

  console.log("\n▶ Délai modifié après déclaration");
  await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: dayAgo(90) });
  await g.req("PATCH", `/api/contracts/${l1}`, { paymentDays: 80 });
  check("l'échéance suit le nouveau délai", (await fin(l1)).invoices.find(i => i._id === inv._id)?.dueDate?.slice(0, 10) === dayAgo(10));
  await g.req("PATCH", `/api/contracts/${l1}`, { paymentDays: 60 });

  console.log("\n▶ Intérêts moratoires");
  f = await fin(l1);
  let line = f.invoices.find(i => i._id === inv._id);
  check("sans taux : retard compté, pas d'intérêts", line?.daysLate === 30 && line.lateInterest === 0 && f.terms.lateInterest.rate === null, J(line));
  check("les intérêts ne touchent pas la marge", (() => f.margin.atCompletion)() === f.contractHT - f.costs.actual - f.costs.committed);
  await g.req("PATCH", `/api/contracts/${l1}`, { lateInterestRate: 0.0365 });
  f = await fin(l1);
  line = f.invoices.find(i => i._id === inv._id);
  const expected = Math.round(line.totalTTC * 0.0365 * 30 / 365);
  check("intérêts : solde × taux × jours / 365", line.lateInterest === expected && f.terms.lateInterest.total === expected, `${line.lateInterest} ≠ ${expected}`);
  const pay = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: line.totalTTC, method: "bank_transfer", date: dayAgo(10), treasuryAccountId: bank });
  f = await fin(l1);
  line = f.invoices.find(i => i._id === inv._id);
  const late = Math.round(line.totalTTC * 0.0365 * 20 / 365);
  check("règlement tardif : intérêts arrêtés à sa date, et conservés", pay.status < 300 && line.daysLate === 20 && line.lateInterest === late, `${pay.status} ${J(line)} ≠ ${late}`);
  const reset = await g.req("PATCH", `/api/contracts/${l1}/invoice`, { invoiceId: inv._id, claimReceivedAt: null });
  f = await fin(l1);
  check("date retirée : échéance depuis l'émission, plus d'intérêts", reset.status === 200 && f.invoices.find(i => i._id === inv._id)?.lateInterest === 0, J(reset.data));

  console.log("\n▶ Contrôles du testeur indépendant");
  check("état inconnu refusé", (await g.req("POST", `/api/contracts/${l2}/costs`, { costTypeId: T("bank"), amountHT: 100, state: "foo" })).status === 400);
  check("montant booléen refusé", (await g.req("POST", `/api/contracts/${l2}/costs`, { costTypeId: T("bank"), amountHT: true, state: "due" })).status === 400);
  check("activation non booléenne refusée", (await g.req("PATCH", `/api/contracts/cost-types/${T("penalty")}`, { isActive: "false" })).status === 400);
  for (const [k, v] of [["serviceOrderDate", 5], ["paymentDays", true], ["paymentDays", 1.5], ["amount", null], ["deliveredAt", dayAgo(-5)]]) {
    check(`PATCH ${k}=${J(v)} refusé`, (await g.req("PATCH", `/api/contracts/${l2}`, { [k]: v })).status === 400);
  }
  const { s: cpt } = await login("comptable@test.ne", SEED_PW);
  check("comptable : situation du marché et types accessibles", (await cpt.req("GET", `/api/contracts/${l2}/finance`)).status === 200 && (await cpt.req("GET", "/api/contracts/cost-types")).status === 200);
  check("comptable : conditions modifiables", (await cpt.req("PATCH", `/api/contracts/${l2}`, { paymentDays: 60 })).status === 200);

  const job = id(await g.req("POST", "/api/contracts", { title: "Contrat de travail", type: "employment", amount: 100000 }));
  check("comptable : contrat de travail invisible", (await cpt.req("GET", `/api/contracts/${job}`)).status === 404 && !(D(await cpt.req("GET", "/api/contracts?limit=100")).items ?? []).some(c => c._id === job));
  check("comptable : filtre de type sans effet sur sa portée", (D(await cpt.req("GET", "/api/contracts?type=employment")).items ?? []).every(c => c.type === "client"));
  check("comptable : modification du contrat de travail refusée", (await cpt.req("PATCH", `/api/contracts/${job}`, { paymentDays: 60 })).status === 404);
  check("comptable : objet du marché non modifiable", (await cpt.req("PATCH", `/api/contracts/${l2}`, { title: "Autre", paymentDays: 60 })).status === 403);
  check("comptable : signature refusée", (await cpt.req("POST", `/api/contracts/${l2}/sign`, { signerName: "X", signedDate: today })).status === 403);
  check("gérant : contrat de travail toujours visible", (await g.req("GET", `/api/contracts/${job}`)).status === 200);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
