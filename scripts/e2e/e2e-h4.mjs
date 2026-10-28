// Scénario de bout en bout : lot H4 — facturation automatique des contrats,
// tâches planifiées reprises et dédoublonnées, sortie d'un salarié, jours
// fériés, services, FEC, trésorerie (annulation, devise), reventes, projets
// (tâches, jalons, temps, suppression douce), relances avec lien de
// paiement, relevé envoyé, échéancier, recherche (docs/AUDIT-2026-10.md).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const PW = `Kz-${randomBytes(12).toString("base64url")}!9q`;
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





const { ObjectId } = (await import("module")).createRequire(`${ROOT}/package.json`)("mongodb");
const db = fn => withDb(ROOT, fn);
const oid = x => new ObjectId(String(x));
const cron = async job => (await fetch(`${BASE}/api/cron?job=${job}`, { headers: { "x-cron-key": process.env.CRON_SECRET } })).json();

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const local = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = local();
  const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return local(d); };
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque H4", type: "bank", openingBalance: 1_000_000, openingDate: "2025-01-01" }))._id;
  const cli = D(await g.req("POST", "/api/clients", { code: "H4-CLI", name: "Client Horizon H4", type: "company", email: "client.h4@test.ne" }));

  console.log("\n▶ A4 — contrat récurrent facturé automatiquement (rattrapage)");
  const ct = D(await g.req("POST", "/api/contracts", { title: "Maintenance H4", type: "client", clientId: cli._id, amount: 100_000, status: "active", isRecurring: true, billingFrequency: "monthly", autoGenerateInvoice: true, tvaRate: 0 }));
  await db(d => d.collection("contracts").updateOne({ _id: oid(ct._id) }, { $set: { nextBillingDate: new Date(monthsAgo(2)) } }));
  const r1 = await cron("recurring-contracts");
  const bills = await db(d => d.collection("invoices").find({ contractId: oid(ct._id) }).toArray());
  check("trois périodes échues : trois factures brouillon, au taux du contrat (exonéré)", bills.length === 3 && bills.every(b => b.status === "draft" && b.totalTVA === 0 && b.totalTTC === 100_000), `${J(r1.ran)} ${bills.length}`);
  const r2 = await cron("recurring-contracts");
  check("deuxième passage : rien de plus", (await db(d => d.collection("invoices").countDocuments({ contractId: oid(ct._id) }))) === 3, J(r2.ran));
  const notifInv = await db(d => d.collection("notifications").countDocuments({ type: "invoice_generated", linkedId: oid(ct._id) }));
  check("comptable notifié une seule fois", notifInv >= 1 && notifInv <= 3, notifInv);
  check("bouton : période déjà facturée refusée", (await g.req("POST", `/api/contracts/${ct._id}/generate-invoice`, {})).status === 400);

  console.log("\n▶ R4 / R6 — tâches reprises, notifications dédoublonnées");
  const inv = D(await g.req("POST", "/api/invoices", { clientId: cli._id, issueDate: monthsAgo(2), dueDate: monthsAgo(1), lines: [{ description: "Audit réseau", quantity: 1, unitPrice: 300_000, tvaRate: 0.19 }] }));
  await g.req("POST", `/api/invoices/${inv._id}/send`);
  Object.assign(inv, D(await g.req("GET", `/api/invoices/${inv._id}`)));
  await cron("overdue-invoices"); await cron("overdue-invoices");
  const nOver = await db(d => d.collection("notifications").countDocuments({ type: "invoice_overdue", linkedId: oid(inv._id) }));
  const admins = await db(d => d.collection("users").countDocuments({ isActive: true, $or: [{ role: { $in: ["pme_admin", "pme_accountant", "pme_manager", "svc_compta"] } }, { roles: { $in: ["pme_admin", "pme_accountant", "pme_manager", "svc_compta"] } }] }));
  check("facture en retard : une alerte par destinataire, pas une par passage", nOver > 0 && nOver <= admins, `${nOver} / ${admins}`);
  const g1 = await (await fetch(`${BASE}/api/cron?group=monthly`, { headers: { "x-cron-key": process.env.CRON_SECRET } })).json();
  const g2 = await (await fetch(`${BASE}/api/cron?group=monthly`, { headers: { "x-cron-key": process.env.CRON_SECRET } })).json();
  check("groupe rejoué : les tâches faites sont sautées", g1.ran?.every(x => !x.error) && g2.ran?.every(x => x.skipped === "déjà faite"), J([g1.ran, g2.ran?.map(x => x.skipped)]));
  const runs = await db(d => d.collection("cronruns").find({}).toArray());
  check("passage inscrit par tâche et par période", runs.length >= g1.ran.length && runs.every(r => r.status === "done"), runs.length);

  console.log("\n▶ C11 / R2 — services de l'organisation, jours fériés, plafond");
  const bad = await g.req("PATCH", "/api/companies/hr-settings", { costCenters: [{ value: "Bad Code!", label: "x" }] });
  const okc = await g.req("PATCH", "/api/companies/hr-settings", { costCenters: [{ value: "atelier", label: "Atelier" }, { value: "bureau", label: "Bureau d'études" }], leaveMaxBalanceDays: 40 });
  const opts = D(await g.req("GET", "/api/imputation/options"));
  check("liste de services propre (code invalide refusé)", bad.status === 400 && okc.status === 200 && opts.costCenters?.map(c => c.value).join() === "atelier,bureau", J(opts.costCenters));
  const hr = D(await g.req("GET", "/api/companies/hr-settings?year=2026"));
  check("jours fériés 2026 : 3 août, Tabaski, lundi de Pâques", ["2026-08-03", "2026-05-27", "2026-04-06"].every(x => hr.holidays?.some(h => h.date === x)), J(hr.holidays?.map(h => h.date)));
  const emp = D(await g.req("POST", "/api/employees", { code: "H4-EMP", firstName: "Issa", lastName: "Départ", position: "Technicien", startDate: "2023-01-01", employeeType: "employee", contractNature: "cdd", grossSalary: 260_000, costCenter: "atelier" }));
  check("salarié rattaché à un service de la liste ; service inconnu refusé", emp.costCenter === "atelier" && (await g.req("PATCH", `/api/employees/${emp._id}`, { costCenter: "spot" })).status === 400, J(emp).slice(0, 120));
  const lv = await g.req("POST", "/api/leaves", { employeeId: emp._id, type: "annual", startDate: "2026-08-03", endDate: "2026-08-08" });
  check("congé du 3 au 8 août : 5 jours (le 3 août férié)", lv.status === 201 && D(lv).days === 5, `${lv.status} ${J(lv.data).slice(0, 120)}`);
  const bal = D(await g.req("GET", `/api/leaves?employeeId=${emp._id}`)).balance;
  check("plafond de report : acquis ramené à pris + 40 j", bal && bal.available <= 40 && bal.forfeited > 0, J(bal));

  console.log("\n▶ R1 — sortie, solde de tout compte, bulletin de sortie");
  await db(d => d.collection("employees").updateOne({ _id: oid(emp._id) }, { $set: { contractEndDate: new Date(monthsAgo(1)) } }));
  await cron("employee-contracts");
  check("CDD échu toujours en poste : alerte", (await db(d => d.collection("notifications").countDocuments({ type: "employee_contract_lapsed", linkedId: oid(emp._id) }))) > 0);
  const exitDay = `${today.slice(0, 8)}15`;
  const prev = D(await g.req("GET", `/api/employees/${emp._id}/exit?date=${exitDay}`));
  check("solde prévisionnel : salaire au prorata (15/30) et congés indemnisés", prev.settlement?.proratedBase === 130_000 && prev.settlement?.leaveIndemnity === Math.round(prev.settlement.leaveDays * 260_000 / 26), J(prev.settlement));
  const ex = await g.req("POST", `/api/employees/${emp._id}/exit`, { date: exitDay, reason: "Fin de contrat (CDD)", payslip: true });
  const slip = await db(d => d.collection("payslips").findOne({ employeeId: oid(emp._id) }));
  const empAfter = D(await g.req("GET", `/api/employees/${emp._id}`));
  check("sortie enregistrée, bulletin avec indemnité compensatrice", ex.status === 200 && !empAfter.isActive && slip && JSON.stringify(slip).includes("Indemnité compensatrice"), `${ex.status} ${J(ex.data).slice(0, 160)}`);
  check("deuxième sortie : refusée", (await g.req("POST", `/api/employees/${emp._id}/exit`, { date: exitDay })).status === 400);
  // Bulletin daté de la fin du mois payé.
  const eom = local(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  const cc = D(await g.req("GET", `/api/reports/cost-centers?from=${today.slice(0, 8)}01&to=${eom}`));
  check("rapport par service : la paie du bulletin de sortie sur « Atelier »", cc.items?.some(x => x.key === "atelier" && x.label === "Atelier" && x.payroll > 0), J(cc.items));

  console.log("\n▶ C9 — FEC conforme");
  const fec = await g.req("GET", `/api/exports/generic?format=fec&annee=${today.slice(0, 4)}`);
  const text = Buffer.isBuffer(fec.data) ? fec.data.toString("utf-8") : String(fec.data ?? "");
  const lines = text.split("\r\n").slice(1).map(l => l.split("|"));
  const entriesN = await db(d => d.collection("accountingentries").countDocuments({ entryDate: { $gte: new Date(Number(today.slice(0, 4)), 0, 1) } }));
  const nums = new Set(lines.map(l => l[2]));
  const sale = lines.filter(l => l[4] === "411000" && l[6]);
  check("un numéro par écriture (pas par ligne)", fec.status === 200 && nums.size === entriesN && lines.length > entriesN, `${fec.status} ${nums.size} / ${entriesN} / ${lines.length}`);
  check("tiers renseigné sur les lignes clients (code et nom)", sale.some(l => l[6] === "H4-CLI" && l[7] === "Client Horizon H4"), J(lines.filter(l => l[4] === "411000").slice(0, 2)));

  console.log("\n▶ A6 — trésorerie : annulation d'un mouvement, devise, règlement futur");
  const mv = D(await g.req("POST", "/api/treasury-accounts/movements", { kind: "manual", accountId: bank, direction: "out", amount: 7_000, label: "Frais bancaires H4", counterAccount: "627000" }));
  const balBefore = D(await g.req("GET", "/api/treasury-accounts")).items.find(a => a._id === bank).balance;
  const cx = await g.req("POST", `/api/treasury-accounts/movements/${mv._id}/cancel`, { reason: "Saisie en double" });
  const balAfter = D(await g.req("GET", "/api/treasury-accounts")).items.find(a => a._id === bank).balance;
  const rev = await db(d => d.collection("accountingentries").countDocuments({ linkedDocType: "reversal", reverses: oid(mv.entryId) }));
  check("mouvement manuel annulé : solde rétabli, écriture extournée", cx.status === 200 && balAfter === balBefore + 7_000 && rev === 1, `${cx.status} ${balBefore} → ${balAfter} ${rev}`);
  check("deuxième annulation : refusée", (await g.req("POST", `/api/treasury-accounts/movements/${mv._id}/cancel`, { reason: "bis" })).status === 400);
  const eur = D(await g.req("POST", "/api/treasury-accounts", { label: "Compte euro H4", type: "bank", currency: "EUR", openingBalance: 655_957, openingDate: "2026-01-01" }));
  const eurRow = D(await g.req("GET", "/api/treasury-accounts")).items.find(a => a._id === eur._id);
  check("compte en euro : solde affiché aussi en euros (parité fixe)", eurRow?.foreignBalance === 1000, J(eurRow));
  check("devise inconnue : refusée", (await g.req("POST", "/api/treasury-accounts", { label: "X", type: "bank", currency: "ZZZ" })).status === 400);
  const sup = D(await g.req("POST", "/api/suppliers", { code: "H4-SUP", name: "Fournisseur Sahel H4" }));
  const pur = D(await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup._id, date: today, validate: true, lines: [{ description: "Câbles", accountCode: "605000", amountHT: 50_000 }] }));
  const future = new Date(); future.setDate(future.getDate() + 10);
  check("règlement fournisseur daté dans le futur : refusé", (await g.req("POST", `/api/achats/${pur._id}/pay`, { amount: 10_000, treasuryAccountId: bank, date: local(future) })).status === 400);
  const sum = D(await g.req("GET", "/api/reports/summary"));
  const accts = D(await g.req("GET", "/api/treasury-accounts")).items;
  const y0 = new Date(Number(today.slice(0, 4)), 0, 1), y1 = new Date(Number(today.slice(0, 4)), 11, 31, 23, 59, 59);
  const booked = await db(d => d.collection("invoices").find({ tenantId: oid(cli.tenantId), issueDate: { $gte: y0, $lte: y1 }, status: { $nin: ["draft", "cancelled"] } }).toArray());
  const expectHT = booked.reduce((t, i) => t + (i.documentType === "credit_note" ? -i.totalHT : i.totalHT), 0);
  check("tableau de synthèse : trésorerie = somme des comptes ; CA HT = factures émises (brouillons à part)", sum.treasury === accts.reduce((t, a) => t + a.balance, 0) && sum.ca?.ht === expectHT && sum.ca?.draft >= 300_000, J({ t: sum.treasury, s: accts.reduce((t, a) => t + a.balance, 0), ca: sum.ca, expectHT }));

  console.log("\n▶ A5 — revente d'abonnement facturée");
  const resale = D(await g.req("POST", "/api/abonnements/reventes", { reference: "RV-H4", clientId: cli._id, productName: "Microsoft 365", startDate: today, endDate: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`, quantity: 5, unitPrice: 12_000, tvaRate: 0.19 }));
  const rb = await g.req("POST", `/api/abonnements/reventes/${resale._id}/invoice`);
  const rInv = D(rb).invoice;
  check("facture brouillon : 5 licences × 12 000 HT, revente liée", rb.status === 201 && rInv?.totalHT === 60_000 && rInv?.status === "draft" && (await db(d => d.collection("subscriptionsales").findOne({ _id: oid(resale._id) })))?.invoiceId, `${rb.status} ${J(rb.data).slice(0, 160)}`);
  check("deuxième facturation : refusée", (await g.req("POST", `/api/abonnements/reventes/${resale._id}/invoice`)).status === 400);

  console.log("\n▶ R3 — projets : tâches sans écrasement, jalon facturé, temps, suppression douce");
  const prj = D(await g.req("POST", "/api/projects", { code: "H4-PRJ", name: "Déploiement H4", clientId: cli._id, budget: 2_000_000 }));
  const t1 = D(await g.req("POST", `/api/projects/${prj._id}/tasks`, { label: "Étude" }));
  const t2 = D(await g.req("POST", `/api/projects/${prj._id}/tasks`, { label: "Installation", weight: 3 }));
  const stale = D(await g.req("GET", `/api/projects/${prj._id}`));
  await Promise.all([g.req("PATCH", `/api/projects/${prj._id}/tasks/${t1._id}`, { status: "done" }), g.req("PATCH", `/api/projects/${prj._id}/tasks/${t2._id}`, { status: "in_progress" })]);
  const p1 = D(await g.req("GET", `/api/projects/${prj._id}`));
  check("deux tâches modifiées en même temps : aucune perdue", p1.tasks?.find(t => t._id === t1._id)?.status === "done" && p1.tasks?.find(t => t._id === t2._id)?.status === "in_progress" && p1.executionRate === 25, J(p1.tasks?.map(t => [t.label, t.status])));
  const clash = await g.req("PATCH", `/api/projects/${prj._id}`, { tasks: stale.tasks, ifUpdatedAt: stale.updatedAt });
  check("liste envoyée sur une version périmée : refusée (409)", clash.status === 409, clash.status);
  await g.req("PATCH", `/api/projects/${prj._id}`, { milestones: [{ label: "Recette", amount: 500_000 }], ifUpdatedAt: p1.updatedAt });
  const ms = D(await g.req("GET", `/api/projects/${prj._id}`)).milestones?.[0];
  const mb = await g.req("POST", `/api/projects/${prj._id}/milestones/${ms?._id}/invoice`, {});
  check("jalon facturé : brouillon de 500 000 HT au client, une seule fois", mb.status === 201 && D(mb).invoice?.totalHT === 500_000 && (await g.req("POST", `/api/projects/${prj._id}/milestones/${ms?._id}/invoice`, {})).status === 400, `${mb.status} ${J(mb.data).slice(0, 120)}`);
  const te = await g.req("POST", `/api/projects/${prj._id}/time`, { date: today, hours: 3.5, taskId: t2._id, note: "Pose" });
  await g.req("POST", `/api/projects/${prj._id}/time`, { date: today, hours: 1.25 });
  const tm = D(await g.req("GET", `/api/projects/${prj._id}/time`));
  check("temps saisis : 4,75 h au total", te.status === 201 && tm.totalHours === 4.75 && tm.people?.length === 1, J(tm).slice(0, 160));
  check("temps à venir : refusé", (await g.req("POST", `/api/projects/${prj._id}/time`, { date: local(future), hours: 1 })).status === 400);
  const del = await g.req("DELETE", `/api/projects/${prj._id}`);
  const listed = (D(await g.req("GET", "/api/projects?limit=100")).items ?? []).some(p => p._id === prj._id);
  const stillThere = await db(d => d.collection("projects").findOne({ _id: oid(prj._id) }));
  check("suppression douce : hors des listes, données conservées", del.status === 204 && !listed && stillThere?.tasks?.length === 2, `${del.status} ${listed}`);
  const rs = await g.req("PATCH", `/api/projects/${prj._id}`, { restore: true });
  check("projet restauré", rs.status === 200 && (D(await g.req("GET", "/api/projects?limit=100")).items ?? []).some(p => p._id === prj._id), rs.status);

  console.log("\n▶ Échéancier de paiement");
  await g.req("PUT", "/api/relances/parametres", { enabled: true, sendDays: [0, 1, 2, 3, 4, 5, 6], minIntervalDays: 0 });
  const wrong = await g.req("PUT", `/api/invoices/${inv._id}/schedule`, { installments: [{ dueDate: monthsAgo(1), amount: 100_000 }] });
  const sch = await g.req("PUT", `/api/invoices/${inv._id}/schedule`, { installments: [
    { dueDate: monthsAgo(1), amount: 119_000, label: "Acompte" }, { dueDate: local(future), amount: 119_000 }, { dueDate: `${Number(today.slice(0, 4)) + 1}-01-31`, amount: 119_000 }] });
  check("total faux refusé ; échéancier conforme enregistré", wrong.status === 400 && sch.status === 200 && D(sch).state?.dueNow === 119_000 && D(sch).state?.currentIndex === 0, `${wrong.status} ${sch.status} ${J(D(sch).state).slice(0, 160)}`);
  await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 119_000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  const plan = D(await g.req("GET", "/api/relances")).plan;
  const skip = plan?.skipped?.find(x => x.invoiceId === inv._id);
  check("après le 1er versement : la relance attend le versement suivant", !plan?.actions?.some(a => a.invoiceId === inv._id) && /Échéance dans/.test(skip?.message ?? ""), J(skip));

  console.log("\n▶ Relances avec lien de paiement, relevé envoyé");
  const settings = D(await g.req("GET", "/api/relances/parametres"));
  const inv2 = D(await g.req("POST", "/api/invoices", { clientId: cli._id, issueDate: monthsAgo(2), dueDate: monthsAgo(1), lines: [{ description: "Licence", quantity: 1, unitPrice: 80_000, tvaRate: 0 }] }));
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  await db(d => d.collection("clients").updateOne({ _id: oid(cli._id) }, { $unset: { portalTokenHash: 1, portalTokenEnc: 1 } }));
  const dn = await cron("dunning");
  const cliDoc = await db(d => d.collection("clients").findOne({ _id: oid(cli._id) }));
  const logs = await db(d => d.collection("dunninglogs").countDocuments({ invoiceId: oid(inv2._id) }));
  check("relance partie avec le lien du portail (créé pour l'occasion)", settings.includePayLink !== false && logs >= 1 && !!cliDoc.portalTokenHash, `${J(dn.ran)} ${logs} ${!!cliDoc.portalTokenHash}`);
  const sendSt = await g.req("POST", `/api/clients/${cli._id}/releve/send`, { from: `${today.slice(0, 4)}-01-01`, to: today });
  check("relevé envoyé par e-mail, PDF joint", sendSt.status === 200 && D(sendSt).sentTo === "client.h4@test.ne" && D(sendSt).payLink === true, `${sendSt.status} ${J(sendSt.data)}`);

  console.log("\n▶ Recherche et sélecteurs");
  const sInv = D(await g.req("GET", "/api/invoices?search=Horizon")).items ?? [];
  check("factures : recherche par nom de client", sInv.length >= 2 && sInv.every(i => i.clientId?.name === "Client Horizon H4"), sInv.length);
  check("factures : recherche par libellé de ligne", (D(await g.req("GET", "/api/invoices?search=Audit%20r%C3%A9seau")).items ?? []).some(i => i._id === inv._id));
  check("encaissements : recherche par n° de facture", (D(await g.req("GET", `/api/payments?search=${encodeURIComponent(inv.number)}`)).items ?? []).length === 1);
  await db(d => d.collection("clients").insertMany(Array.from({ length: 110 }, (_, k) => ({ tenantId: oid(cli.tenantId), code: `MASS-${k}`, name: `Client en masse ${String(k).padStart(3, "0")}`, isActive: true, type: "company", createdAt: new Date(), updatedAt: new Date() }))));
  const pick = D(await g.req("GET", "/api/clients?picker=1&isActive=true")).items ?? [];
  check("sélecteur de clients : au-delà de 100", pick.length > 110, pick.length);

  console.log(`\n${pass} vérifications réussies, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
