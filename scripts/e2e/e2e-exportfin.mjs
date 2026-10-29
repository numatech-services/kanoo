// Scénario de bout en bout : export financier complet et ses contrôles de
// cohérence ; corrections IS/BIC, annulation d'un règlement en espèces,
// encodage de l'export Sage.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { withDb } from "./db.mjs";

const BASE = "http://localhost:3099";
const ROOT = process.argv[2];
const SEED_PW = /hash\("([^"]+)"/.exec(readFileSync(`${ROOT}/scripts/seed-test.ts`, "utf-8"))[1];
const require = createRequire(`${ROOT}/package.json`);
const ExcelJS = require("exceljs");
const { Types } = require("mongoose");
let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };
const J = x => JSON.stringify(x);
const db = fn => withDb(ROOT, fn);

function session() {
  const jar = new Map(); let csrf = "";
  const store = r => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(method, p, body) {
    if (!csrf && method !== "GET") { const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookie() } }); store(r); csrf = (await r.json()).csrfToken; }
    const res = await fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { cookie: cookie(), "content-type": "application/json", ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    store(res);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : null;
    return { status: res.status, data, headers: res.headers, bytes: data === null ? Buffer.from(await res.arrayBuffer()) : null };
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
const today = new Date().toISOString().slice(0, 10);
const year = new Date().getFullYear();

async function workbook(g) {
  const r = await g.req("GET", `/api/exports/complet?annee=${year}`);
  const wb = new ExcelJS.Workbook();
  if (r.bytes?.length) await wb.xlsx.load(r.bytes);
  const controls = [];
  wb.getWorksheet("Contrôles")?.eachRow((row, n) => { if (n > 5) controls.push({ severity: row.getCell(1).value, check: row.getCell(2).value, piece: row.getCell(3).value, amount: row.getCell(5).value }); });
  return { r, wb, controls };
}

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const { s: g } = await login("admin@test.ne", SEED_PW);
  const bank = D(await g.req("POST", "/api/treasury-accounts", { label: "Banque export", type: "bank", openingBalance: 0, openingDate: `${year}-01-01` }))._id;
  const cash = D(await g.req("POST", "/api/treasury-accounts", { label: "Caisse export", type: "cash", openingBalance: 0, openingDate: `${year}-01-01` }))._id;
  const client = D(await g.req("POST", "/api/clients", { code: "EXP-1", name: "Société Générale d'Études", type: "company", buyerType: "private" }))._id;
  const sup = D(await g.req("POST", "/api/suppliers", { code: "EXP-F", name: "Fournisseur Export" }))._id;
  const mkInv = async ht => D(await g.req("POST", "/api/invoices", { clientId: client, issueDate: today, dueDate: today, lines: [{ description: "Prestation d'étude", quantity: 1, unitPrice: ht, tvaRate: 0.19 }] }));
  const inv = await mkInv(100_000);
  check("facture émise", (await g.req("POST", `/api/invoices/${inv._id}/send`)).status === 200);
  const pay = await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 50_000, method: "bank_transfer", date: today, treasuryAccountId: bank });
  check("règlement par virement", pay.status === 200 || pay.status === 201, `${pay.status} ${J(pay.data).slice(0, 150)}`);
  const ach = await g.req("POST", "/api/achats", { kind: "invoice", supplierId: sup, date: today, dueDate: today, validate: true, lines: [{ description: "Fournitures", accountCode: "604000", quantity: 1, unitPrice: 50_000, tvaRate: 0 }] });
  check("achat validé", ach.status === 200 || ach.status === 201, `${ach.status} ${J(ach.data).slice(0, 150)}`);

  console.log("\n▶ Annulation d'un règlement en espèces : règlement et timbre-quittance extournés");
  const cashPay = D(await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 10_000, method: "cash", date: today, treasuryAccountId: cash }));
  const before = await db(d => d.collection("accountingentries").find({ linkedDocType: "payment", linkedDocId: new Types.ObjectId(cashPay._id) }).toArray());
  check("deux écritures pour un règlement en espèces (règlement + timbre)", before.length === 2, J(before.map(e => e.journalCode)));
  const cancel = await g.req("POST", `/api/payments/${cashPay._id}/cancel`, { reason: "erreur de saisie" });
  check("règlement annulé", cancel.status === 200, `${cancel.status} ${J(cancel.data)}`);
  const after = await db(d => d.collection("accountingentries").find({ linkedDocType: "payment", linkedDocId: new Types.ObjectId(cashPay._id) }).toArray());
  check("les deux écritures sont extournées", after.length === 2 && after.every(e => e.reversedBy), J(after.map(e => [e.journalCode, !!e.reversedBy])));
  const cashPay2 = D(await g.req("POST", "/api/payments", { invoiceId: inv._id, amount: 10_000, method: "cash", date: today, treasuryAccountId: cash }));
  const cancel2 = await g.req("POST", `/api/payments/${cashPay2._id}/cancel`, { reason: "chèque rendu, reçu remis", keepStamp: true });
  const after2 = await db(d => d.collection("accountingentries").find({ linkedDocType: "payment", linkedDocId: new Types.ObjectId(cashPay2._id) }).toArray());
  check("reçu remis : règlement extourné, timbre-quittance conservé", cancel2.status === 200 && after2.some(e => e.journalCode === "CA" && e.reversedBy) && after2.some(e => e.journalCode === "OD" && !e.reversedBy), J(after2.map(e => [e.journalCode, !!e.reversedBy])));

  console.log("\n▶ Note de frais : soumission, approbation, compte SYSCOHADA");
  const emp = D(await g.req("POST", "/api/employees", { code: "EXP-EMP", firstName: "Awa", lastName: "Test", position: "Chargée d'études", startDate: `${year - 1}-01-01`, employeeType: "employee", grossSalary: 200_000 }));
  // Saisie par la comptable, approbation par le gérant (on n'approuve pas sa propre note).
  const { s: acc } = await login("comptable@test.ne", SEED_PW);
  const nf = D(await acc.req("POST", "/api/expenses", { title: "Mission Zinder", employeeId: emp._id, lines: [{ date: today, category: "mission", description: "Indemnité de mission", amountTTC: 4_500 }] }));
  const sub = await acc.req("PATCH", `/api/expenses/${nf._id}`, { status: "submitted" });
  check("note de frais soumise (lignes relues correctement)", sub.status === 200, `${sub.status} ${J(sub.data).slice(0, 160)}`);
  const appr = await g.req("PATCH", `/api/expenses/${nf._id}`, { status: "approved" });
  check("note de frais approuvée", appr.status === 200, `${appr.status} ${J(appr.data).slice(0, 160)}`);
  const nfEntry = await db(d => d.collection("accountingentries").findOne({ linkedDocType: "expense", linkedDocId: new Types.ObjectId(nf._id) }));
  check("mission passée au 638200 (SYSCOHADA), pas au 625300 (assurances)", nfEntry?.lines?.some(l => l.accountCode === "638200") && !nfEntry.lines.some(l => /^625/.test(l.accountCode)), J(nfEntry?.lines?.map(l => l.accountCode)));

  console.log("\n▶ Export complet : base saine");
  const clean = await workbook(g);
  check("classeur Excel téléchargé", clean.r.status === 200 && /spreadsheetml/.test(clean.r.headers.get("content-type") || ""), `${clean.r.status}`);
  const names = clean.wb.worksheets.map(w => w.name);
  for (const n of ["Mode d'emploi", "Synthèse", "Contrôles", "Écritures", "Balance", "Bilan actif", "Bilan passif", "Compte de résultat", "Flux de trésorerie", "TVA", "Déclarations", "Factures", "Encaissements", "Achats", "Règlements fournisseurs", "Notes de frais", "Paie", "Trésorerie", "Mouvements de trésorerie", "Comptoir", "Clients", "Fournisseurs", "Immobilisations", "Par activité", "Plan comptable"]) check(`feuille « ${n} »`, names.includes(n));
  check("nom du fichier : organisation, exercice, date", /filename="[a-z0-9-]+_export-financier_\d{4}_\d{8}\.xlsx"/.test(clean.r.headers.get("content-disposition") || ""), clean.r.headers.get("content-disposition"));
  check("aucun compte utilisé par Kanoo signalé absent du plan", !clean.controls.some(c => /absent du plan/.test(String(c.check))), J(clean.controls.filter(c => /plan/.test(String(c.check)))));
  check("timbre conservé signalé pour information", clean.controls.some(c => c.severity === "Information" && /Timbre-quittance conservé/.test(String(c.check))));
  // Le jeu d'essai (seed-test.ts) écrit FAC-2025-00001 directement en base, sans écriture : le contrôle doit la voir.
  const SEED = "Facture FAC-2025-00001";
  check("facture du jeu d'essai sans écriture : détectée", clean.controls.some(c => c.piece === SEED && c.check === "Facture sans écriture de vente" && c.severity === "Critique"));
  const serious = clean.controls.filter(c => (c.severity === "Critique" || c.severity === "Majeur") && c.piece !== SEED);
  check("aucun autre constat critique ni majeur", !serious.length, J(serious));
  check("en-tête X-Kanoo-Critiques à 1 (le jeu d'essai)", clean.r.headers.get("x-kanoo-critiques") === "1", clean.r.headers.get("x-kanoo-critiques"));
  const jr = clean.wb.getWorksheet("Écritures");
  let debit = 0, credit = 0, rows = 0;
  const invNumber = await db(d => d.collection("invoices").findOne({ _id: new Types.ObjectId(inv._id) }).then(x => x.number));
  let firstDate = null, invRow = null;
  jr.eachRow((row, n) => { if (n > 5) { rows++; debit += Number(row.getCell(12).value) || 0; credit += Number(row.getCell(13).value) || 0; if (row.getCell(9).value === invNumber && !invRow) { invRow = row; firstDate = row.getCell(4).value; } } });
  check("journal équilibré et complet", rows > 0 && debit === credit, `${rows} lignes, ${debit} / ${credit}`);
  check("date d'écriture exacte dans Excel (pas la veille)", firstDate instanceof Date && firstDate.toISOString().slice(0, 10) === today, String(firstDate?.toISOString?.()));
  check("numéro d'écriture séquentiel (comme le FEC)", /^\d{8}$/.test(String(invRow?.getCell(3).value)), String(invRow?.getCell(3).value));
  check("libellés lisibles (origine en français)", invRow?.getCell(20).value === "Facture ou avoir", String(invRow?.getCell(20).value));
  const cli = clean.wb.getWorksheet("Clients");
  let cliRow = null; cli.eachRow((row, n) => { if (n > 5 && row.getCell(1).value === "Société Générale d'Études") cliRow = row; });
  check("compte client = reste dû (119 000 − 50 000)", cliRow && cliRow.getCell(3).value === 69_000 && cliRow.getCell(4).value === 69_000, cliRow ? J(cliRow.values) : "absent");
  check("charges sans secteur signalées (information)", clean.controls.some(c => c.severity === "Information" && /secteur/.test(c.check)));

  console.log("\n▶ Export complet : les erreurs injectées sont détectées");
  const inv2 = await mkInv(200_000);
  await g.req("POST", `/api/invoices/${inv2._id}/send`);
  const tenantId = await db(d => d.collection("invoices").findOne({ _id: new Types.ObjectId(inv._id) }).then(x => x.tenantId));
  await db(async d => {
    await d.collection("accountingentries").deleteOne({ linkedDocType: "invoice", linkedDocId: new Types.ObjectId(inv2._id), journalCode: "VT" });
    await d.collection("accountingentries").insertOne({ tenantId, journalCode: "OD", entryDate: new Date(), reference: "DESEQ-1", label: "Écriture déséquilibrée", createdBy: new Types.ObjectId(),
      lines: [{ accountCode: "601000", accountLabel: "Achats", debit: 1000, credit: 0 }, { accountCode: "401100", accountLabel: "Fournisseurs", debit: 0, credit: 900 }], createdAt: new Date(), updatedAt: new Date() });
    await d.collection("purchases").updateOne({ _id: new Types.ObjectId(D(ach)._id) }, { $set: { status: "cancelled" } });
    await d.collection("fiscaldeclarations").insertOne({ tenantId, type: "tva", period: { mois: new Date().getMonth() + 1, annee: year }, amounts: { net: 1 }, status: "submitted" });
    await d.collection("treasurymovements").insertOne({ tenantId, accountId: new Types.ObjectId(bank), date: new Date(), amount: 7_777, label: "Mouvement sans écriture", source: "manual", createdBy: new Types.ObjectId() });
  });
  const dirty = await workbook(g);
  const has = (re, sev) => dirty.controls.some(c => re.test(String(c.check)) && (!sev || c.severity === sev));
  check("facture sans écriture de vente (critique)", has(/Facture sans écriture de vente/, "Critique"));
  check("écriture déséquilibrée (critique)", has(/déséquilibrée/, "Critique"));
  check("achat annulé encore comptabilisé (critique)", has(/Achat annulé encore comptabilisé/, "Critique"));
  check("TVA déclarée ≠ TVA comptable (majeur)", has(/TVA déclarée/, "Majeur"));
  check("trésorerie ≠ comptabilité, écart de 7 777", dirty.controls.some(c => /Trésorerie ≠/.test(String(c.check)) && c.amount === 7_777), J(dirty.controls.filter(c => /Trésorerie/.test(String(c.check)))));
  check("compte client ≠ factures non réglées (à vérifier)", has(/Compte client/, "À vérifier"));
  check("constats triés par gravité", dirty.controls.findIndex(c => c.severity !== "Critique") > 0 && dirty.controls.slice(dirty.controls.findIndex(c => c.severity !== "Critique")).every(c => c.severity !== "Critique"));
  check("en-tête X-Kanoo-Critiques ≥ 4", Number(dirty.r.headers.get("x-kanoo-critiques")) >= 4, dirty.r.headers.get("x-kanoo-critiques"));
  check("exercice invalide refusé", (await g.req("GET", "/api/exports/complet?annee=abc")).status === 400);
  const anon = await fetch(`${BASE}/api/exports/complet?annee=${year}`, { redirect: "manual" });
  check("export refusé sans connexion", anon.status === 401 || anon.status === 307 || anon.status === 302, String(anon.status));
  const audit = await db(d => d.collection("auditlogs").findOne({ action: "EXPORT", resource: "accountingEntries", "metadata.document": "export-financier-complet" }));
  check("export tracé au journal d'audit", !!audit);

  console.log("\n▶ IS/BIC : exercice terminé, classe 8 comptée, montants recalculés, rectification motivée");
  const prev = year - 1;
  await db(d => d.collection("accountingentries").insertMany([
    { tenantId, journalCode: "OD", entryDate: new Date(prev, 5, 15), reference: "HAO-1", label: "Cession d'immobilisation", createdBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
      lines: [{ accountCode: "485000", accountLabel: "Créance sur cession", debit: 300_000, credit: 0 }, { accountCode: "822000", accountLabel: "Produits des cessions", debit: 0, credit: 300_000 }] },
    { tenantId, journalCode: "OD", entryDate: new Date(prev, 6, 1), reference: "HAO-2", label: "Charge HAO et impôt", createdBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
      lines: [{ accountCode: "831000", accountLabel: "Charges HAO", debit: 40_000, credit: 0 }, { accountCode: "891000", accountLabel: "Impôt sur le résultat", debit: 60_000, credit: 0 }, { accountCode: "471000", accountLabel: "Attente", debit: 0, credit: 100_000 }] },
  ]));
  const isGet = D(await g.req("GET", `/api/fiscal/isbic?annee=${prev}&secteur=normal`));
  check("produits HAO (82) comptés, charges HAO (83) déduites, impôt (89) exclu", isGet.produits === 300_000 && isGet.charges === 40_000, J({ produits: isGet.produits, charges: isGet.charges }));
  check("exercice en cours : déclaration refusée", (await g.req("POST", "/api/fiscal/isbic", { annee: year })).status === 400);
  const isPost = await g.req("POST", "/api/fiscal/isbic", { annee: prev, secteur: "normal", montantDu: 1, resultatFiscal: 1 });
  check("déclaration IS/BIC enregistrée (type isbic accepté)", isPost.status === 200, `${isPost.status} ${J(isPost.data).slice(0, 200)}`);
  check("montant recalculé par le serveur, pas celui du navigateur", D(isPost).amounts?.net === isGet.calcul?.montantDu && D(isPost).amounts?.base === isGet.resultatFiscal, J(D(isPost).amounts));
  check("déclaration déposée : réécriture sans motif refusée", (await g.req("POST", "/api/fiscal/isbic", { annee: prev })).status === 400);
  const rect = await g.req("POST", "/api/fiscal/isbic", { annee: prev, motif: "écriture de cession corrigée" });
  const rectAudit = await db(d => d.collection("auditlogs").findOne({ resource: "fiscalDeclarations", action: "UPDATE", "after.motif": "écriture de cession corrigée" }));
  check("rectification motivée : acceptée, état précédent tracé", rect.status === 200 && !!rectAudit?.before?.amounts, `${rect.status} ${J(rectAudit?.before)}`);
  const isCount = await db(d => d.collection("fiscaldeclarations").countDocuments({ tenantId, type: "isbic", "period.annee": prev }));
  check("une seule déclaration IS/BIC pour l'exercice", isCount === 1, String(isCount));

  console.log("\n▶ TVA : montants recalculés par le serveur, mois terminé seulement");
  const pm = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const tvaGet = D(await g.req("GET", `/api/fiscal/tva?annee=${pm.getFullYear()}&mois=${pm.getMonth() + 1}`));
  const tvaPost = await g.req("POST", "/api/fiscal/tva", { annee: pm.getFullYear(), mois: pm.getMonth() + 1, tvaNette: 1, tvaCollectee: 1 });
  check("TVA enregistrée avec les montants de la comptabilité", tvaPost.status === 200 && D(tvaPost).amounts?.net === tvaGet.tvaNette, `${tvaPost.status} ${J(D(tvaPost).amounts)} / ${tvaGet.tvaNette}`);
  check("mois en cours : déclaration de TVA refusée", (await g.req("POST", "/api/fiscal/tva", { annee: year, mois: new Date().getMonth() + 1 })).status === 400);

  console.log("\n▶ Export Sage 100 : fichier en Windows-1252");
  const sage = await g.req("GET", `/api/exports/sage?annee=${year}`);
  const bytes = sage.bytes ?? Buffer.alloc(0);
  check("« é » encodé sur un octet (0xE9)", bytes.includes(Buffer.from([0xe9])) && !bytes.includes(Buffer.from([0xc3, 0xa9])), `${bytes.length} octets`);
  check("période Sage invalide refusée", (await g.req("GET", "/api/exports/sage?annee=abc")).status === 400 && (await g.req("GET", `/api/exports/sage?annee=${year}&mois=13`)).status === 400);

  console.log(`\n${pass} réussis, ${fail} en échec`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
