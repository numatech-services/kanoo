import ExcelJS from "exceljs";
import type { Writable } from "stream";
import { Types } from "mongoose";
import { TenantModel } from "@/models/Tenant";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { PurchaseModel } from "@/models/Purchase";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { FixedAssetModel } from "@/models/FixedAsset";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityModel } from "@/models/Activity";
import { ProjectModel } from "@/models/Project";
import { LedgerAccountModel } from "@/models/LedgerAccount";
import { trialBalance, balanceFloor } from "@/lib/accounting-reports";
import { financialStatements } from "@/lib/financial-statements-server";
import { closingChecks } from "@/lib/closing";
import { vatFromEntries } from "@/lib/vat";
import { invoiceDue } from "@/lib/payments";
import { ledgerFor } from "@/lib/treasury";
import { unknownAccounts } from "@/lib/ledger";
import { JOURNAL_LABEL } from "@/lib/fec";
import { localDay } from "@/lib/format";

/**
 * Export financier complet d'un exercice, en un classeur : mode d'emploi,
 * synthèse, **contrôles de cohérence**, écritures (colonnes du FEC et
 * imputation), balance, bilan, compte de résultat et tableau des flux au
 * format SYSCOHADA (N et N-1), TVA, déclarations, pièces (factures,
 * encaissements, achats, règlements fournisseurs, notes de frais, paie,
 * comptoir), trésorerie et mouvements, tiers, immobilisations, résultat par
 * activité, plan comptable. Lancé par l'organisation elle-même, sur sa propre
 * base : rien ne sort sans elle.
 *
 * Les contrôles ne corrigent rien : ils désignent la pièce, l'écart et la
 * démarche. Ils suivent les règles de comptabilisation du code : vente =
 * écriture VT liée (411 + 4117 = TTC), règlement = écriture de trésorerie
 * liée, achat = écriture AC (401 = TTC), note de frais = OD à l'approbation
 * puis trésorerie au remboursement, bulletin = OD à l'émission puis
 * trésorerie au paiement.
 *
 * Le classeur est écrit en flux (une ligne à la fois) : construit en mémoire,
 * un exercice chargé occupait plusieurs centaines de mégaoctets.
 */

export type Severity = "Critique" | "Majeur" | "À vérifier" | "Information";
export interface Anomaly { severity: Severity; check: string; piece: string; date?: Date; amount?: number; detail: string; fix: string }

type Line = { accountCode: string; accountLabel?: string; debit: number; credit: number; thirdPartyId?: unknown; projectId?: unknown; activityId?: unknown; costCenter?: string; letterRef?: string; letteredAt?: Date };
type Entry = { _id: Types.ObjectId; entryDate: Date; createdAt?: Date; journalCode: string; reference?: string; label?: string; lines: Line[]; linkedDocType?: string; linkedDocId?: unknown; reversedBy?: unknown; reverses?: unknown };

const SEVERITY_ORDER: Record<Severity, number> = { "Critique": 0, "Majeur": 1, "À vérifier": 2, "Information": 3 };
const round = (n: number) => Math.round(n);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const net = (lines: Line[], re: RegExp) => sum(lines.filter(l => re.test(l.accountCode ?? "")).map(l => (l.debit || 0) - (l.credit || 0)));
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** Créance client sur factures : 411 hors retenue de garantie (4117) et ardoises du comptoir (4118), et créances douteuses 416. */
const AR_ACCOUNT = /^(411(?![78])|416)/;

// Valeurs internes → libellés lisibles par le gérant et le cabinet.
const fr = (map: Record<string, string>) => (v?: string | null) => (v ? map[v] ?? v : "");
const INVOICE_STATUS = fr({ draft: "brouillon", sent: "émise", partial: "réglée en partie", paid: "réglée", overdue: "en retard", cancelled: "annulée", written_off: "passée en perte" });
const PAYMENT_STATUS = fr({ pending: "en attente", effective: "encaissé", cancelled: "annulé" });
const METHOD = fr({ cash: "espèces", bank_transfer: "virement", cheque: "chèque", mobile_money: "mobile money", other: "autre", credit: "ardoise", easypay: "carte EasyPay", card: "carte" });
const PURCHASE_STATUS = fr({ draft: "brouillon", validated: "validé", partial: "payé en partie", paid: "payé", cancelled: "annulé" });
const EXPENSE_STATUS = fr({ draft: "brouillon", submitted: "soumise", approved: "approuvée", rejected: "refusée", reimbursed: "remboursée" });
const TREASURY_TYPE = fr({ bank: "banque", cash: "caisse", mobile_money: "mobile money" });
const DECL_STATUS = fr({ draft: "brouillon", submitted: "déclarée", paid: "payée", late: "en retard" });
const DECL_TYPE = fr({ tva: "TVA", cnss: "CNSS", bic: "BIC", is: "IS", isbic: "IS/BIC", dts: "Droits de timbre", retenue: "Retenue à la source", acompte: "Acompte" });
const ASSET_METHOD = fr({ linear: "linéaire", degressive: "dégressif", none: "non amortissable" });
const ASSET_CATEGORY = fr({ building: "bâtiment", equipment: "matériel", vehicle: "véhicule", furniture: "mobilier", computer: "informatique", software: "logiciel", land: "terrain", other: "autre" });
const ORIGIN = fr({
  invoice: "Facture ou avoir", payment: "Règlement client", supplier_invoice: "Facture fournisseur", supplier_payment: "Règlement fournisseur",
  payslip: "Paie", expense: "Note de frais", credit_note: "Remboursement d'avoir", recurringExpense: "Charge récurrente", delivery: "Livraison",
  stock: "Stock", inventory: "Inventaire", fixed_asset: "Immobilisation", treasury: "Trésorerie", reversal: "Extourne", closing: "Clôture",
  manual: "Saisie manuelle", withholding: "Retenue à la source", desk_cash: "Caisse d'activité", attendee: "Inscription", membership: "Adhésion",
  donation: "Don", retention: "Retenue de garantie", guarantee: "Caution", result_allocation: "Affectation du résultat",
  registration: "Droits d'enregistrement", comptoir_sale: "Ticket de comptoir", cash_closing: "Arrêté de caisse", easypay_remittance: "Reversement EasyPay",
  vat_settlement: "Liquidation de TVA", vat_payment: "Paiement de TVA",
});
const MOVEMENT_SOURCE = fr({ payment: "règlement", expense: "dépense", payroll: "paie", transfer: "virement interne", manual: "saisie", import: "relevé importé" });

/** Démarche commune quand une écriture de pièce manque ou est en trop : jamais de saisie manuelle de compensation. */
const EDITOR = "Ne rien saisir à la main : transmettre la pièce à l'équipe technique de Kanoo, qui régénère ou extourne l'écriture liée (procédure tracée : document « Benchmark Sage », annexe 1)";

/**
 * Date « jour » pour Excel. ExcelJS convertit les dates depuis l'heure UTC ;
 * le serveur est à Niamey (UTC+1) : une écriture datée du 1er janvier à
 * minuit s'affichait au 31 décembre. Midi UTC du jour local.
 */
const xlDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));

export interface ExportOptions {
  /** Feuille de paie et matricules (droit de lecture sur les bulletins). */
  payroll: boolean;
}

export interface PreparedExport {
  anomalies: Anomaly[];
  counts: Record<Severity, number>;
  /** Base du nom de fichier : organisation, exercice, date d'extraction. */
  filename: string;
  /** Écrit le classeur dans le flux, puis le ferme. */
  write(out: Writable): Promise<void>;
}

export async function prepareFinancialExport(tenantId: string, year: number, opts: ExportOptions): Promise<PreparedExport> {
  const tid = new Types.ObjectId(tenantId);
  const tenant = await TenantModel.findById(tid).select("name slug nif rccm closedFiscalYears accountingLockedUntil")
    .lean<{ name?: string; slug?: string; nif?: string; rccm?: string; closedFiscalYears?: number[]; accountingLockedUntil?: Date } | null>();
  const closed = tenant?.closedFiscalYears ?? [];
  const from = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const now = new Date();
  // Date d'arrêté : fin d'exercice, ou aujourd'hui pour l'exercice en cours.
  const at = end < now ? end : now;
  const current = end >= now;
  const floor = balanceFloor(at, closed);
  const anomalies: Anomaly[] = [];
  const add = (a: Anomaly) => anomalies.push(a);
  const inYear = { $gte: from, $lte: end };

  // ── Données ───────────────────────────────────────────────────────────────
  // Lectures par petits groupes : un seul export ne doit pas occuper tout le pool de connexions.
  const [entries, invoices, payments, purchases] = await Promise.all([
    AccountingEntryModel.find({ tenantId: tid, entryDate: inYear }).sort({ entryDate: 1, journalCode: 1, createdAt: 1, _id: 1 })
      .select("entryDate createdAt journalCode reference label lines linkedDocType linkedDocId reversedBy reverses").lean<Entry[]>(),
    InvoiceModel.find({ tenantId: tid, issueDate: inYear }).sort({ issueDate: 1, number: 1 })
      .select("number documentType kind status issueDate dueDate clientId totalHT totalTVA totalDTS totalTTC paidAmount creditedAmount retentionAmount doubtfulAt secef")
      .lean<Array<{ _id: Types.ObjectId; number: string; documentType?: string; kind?: string; status: string; issueDate: Date; dueDate?: Date; clientId?: Types.ObjectId; totalHT: number; totalTVA: number; totalDTS?: number; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; doubtfulAt?: Date; secef?: { code?: string } }>>(),
    PaymentModel.find({ tenantId: tid, date: inYear }).sort({ date: 1 })
      .select("invoiceId amount method status date treasuryAccountId withholdingAmount reference")
      .lean<Array<{ _id: Types.ObjectId; invoiceId: Types.ObjectId; amount: number; method: string; status: string; date: Date; treasuryAccountId?: Types.ObjectId; withholdingAmount?: number; reference?: string }>>(),
    PurchaseModel.find({ tenantId: tid, $or: [{ date: inYear }, { "payments.date": inYear }] }).sort({ date: 1 })
      .select("number kind status date supplierId payee totalHT totalTVA totalTTC paidAmount payments")
      .lean<Array<{ _id: Types.ObjectId; number: string; kind?: string; status: string; date: Date; supplierId?: Types.ObjectId; payee?: string; totalHT: number; totalTVA: number; totalTTC: number; paidAmount?: number; payments?: Array<{ date: Date; amount: number; treasuryAccountId?: unknown; reference?: string; cancelledAt?: Date }> }>>(),
  ]);
  const [expenses, accounts, assets, declarations, payslips] = await Promise.all([
    ExpenseReportModel.find({ tenantId: tid, $or: [{ approvedAt: inYear }, { reimbursedAt: inYear }, { createdAt: inYear }] }).sort({ createdAt: 1 })
      .select("reference title status totalTTC approvedAt reimbursedAt")
      .lean<Array<{ _id: Types.ObjectId; reference: string; title: string; status: string; totalTTC?: number; approvedAt?: Date; reimbursedAt?: Date }>>(),
    TreasuryAccountModel.find({ tenantId: tid }).select("label type ledgerCode openingBalance openingDate balance currency")
      .lean<Array<{ _id: Types.ObjectId; label: string; type: string; ledgerCode?: string; openingBalance?: number; openingDate?: Date; balance?: number; currency?: string }>>(),
    FixedAssetModel.find({ tenantId: tid }).select("code name category acquisitionDate acquisitionCost currentNetValue depreciationMethod status depreciationSchedule")
      .lean<Array<{ code?: string; name?: string; category?: string; acquisitionDate?: Date; acquisitionCost?: number; currentNetValue?: number; depreciationMethod?: string; status?: string; depreciationSchedule?: Array<{ year: number; annuity: number; cumulative: number; netValue: number; posted?: boolean }> }>>(),
    FiscalDeclarationModel.find({ tenantId: tid, "period.annee": year }).sort({ type: 1, "period.mois": 1, updatedAt: 1 })
      .lean<Array<{ _id: Types.ObjectId; type: string; period: { mois?: number; trimestre?: number; annee: number }; status: string; amounts?: { base?: number; taux?: number; montant?: number; deductible?: number; net?: number }; submittedAt?: Date; paidAt?: Date; reference?: string; updatedAt?: Date }>>(),
    PayslipModel.find({ tenantId: tid, year }).sort({ month: 1 })
      .select("employeeId month year grossTotal cnssEmployee cnssEmployer incomeTax otherDeductions netSalary isPaid paidAt")
      .lean<Array<{ _id: Types.ObjectId; employeeId: Types.ObjectId; month: number; year: number; grossTotal?: number; cnssEmployee?: number; cnssEmployer?: number; incomeTax?: number; otherDeductions?: number; netSalary?: number; isPaid?: boolean; paidAt?: Date }>>(),
  ]);
  const [clients, suppliers, employees, activities, projects, desks, ledger] = await Promise.all([
    ClientModel.find({ tenantId: tid }).select("name code").lean<Array<{ _id: Types.ObjectId; name: string; code?: string }>>(),
    SupplierModel.find({ tenantId: tid }).select("name code").lean<Array<{ _id: Types.ObjectId; name: string; code?: string }>>(),
    EmployeeModel.find({ tenantId: tid }).select("code").lean<Array<{ _id: Types.ObjectId; code?: string }>>(),
    ActivityModel.find({ tenantId: tid }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>(),
    ProjectModel.find({ tenantId: tid }).select("code name").lean<Array<{ _id: Types.ObjectId; code?: string; name: string }>>(),
    ActivityDeskModel.find({ tenantId: tid }).select("name treasuryAccountId").lean<Array<{ _id: Types.ObjectId; name: string; treasuryAccountId?: Types.ObjectId }>>(),
    LedgerAccountModel.find({ tenantId: tid }).sort({ code: 1 }).select("code label accountClass isActive").lean<Array<{ code: string; label: string; accountClass?: string; isActive?: boolean }>>(),
  ]);
  const clientOf = new Map(clients.map(c => [String(c._id), c]));
  const supplierOf = new Map(suppliers.map(s => [String(s._id), s]));
  const employeeCode = new Map(employees.map(e => [String(e._id), e.code || `S${String(e._id).slice(-6)}`]));
  const activityOf = new Map(activities.map(a => [String(a._id), a.name]));
  const projectOf = new Map(projects.map(p => [String(p._id), p.code ? `${p.code} — ${p.name}` : p.name]));
  const deskOf = new Map(desks.map(d => [String(d._id), d]));
  // Tiers d'une ligne : un salarié n'apparaît que par son matricule (minimisation des données personnelles).
  const tiers = (id?: unknown): { code: string; name: string } | undefined => {
    if (!id) return undefined;
    const k = String(id);
    const t = clientOf.get(k) ?? supplierOf.get(k);
    if (t) return { code: t.code ?? "", name: t.name };
    const e = employeeCode.get(k);
    return e ? { code: e, name: "Salarié" } : undefined;
  };
  const payslipOf = new Map(payslips.map(p => [String(p._id), p]));

  // Écritures par pièce d'origine, y compris celles datées d'un autre exercice.
  const byDoc = new Map<string, Entry[]>();
  const index = (e: Entry) => { if (e.linkedDocId) { const k = String(e.linkedDocId); byDoc.set(k, [...(byDoc.get(k) ?? []), e]); } };
  entries.forEach(index);
  const docIds = [...invoices, ...payments, ...purchases, ...expenses, ...payslips].map(d => d._id);
  if (docIds.length) {
    (await AccountingEntryModel.find({ tenantId: tid, linkedDocId: { $in: docIds }, $or: [{ entryDate: { $lt: from } }, { entryDate: { $gt: end } }] })
      .select("entryDate journalCode reference lines linkedDocType linkedDocId reversedBy reverses").lean<Entry[]>()).forEach(index);
  }
  /** Écritures actives (ni extournées ni extournes) d'une pièce, d'un type et de journaux donnés. */
  const active = (id: unknown, type: string, journals?: (j: string) => boolean) =>
    (byDoc.get(String(id)) ?? []).filter(e => e.linkedDocType === type && !e.reversedBy && !e.reverses && (!journals || journals(e.journalCode)));
  const isVT = (j: string) => j === "VT";
  const isAC = (j: string) => j === "AC";
  const isOD = (j: string) => j === "OD";
  const isTreasury = (j: string) => j === "BQ" || j === "CA";

  // ── Contrôles ─────────────────────────────────────────────────────────────
  // 1. Équilibre de chaque écriture (même tolérance que l'enregistrement : 1 FCFA) ; dates hors de l'avenir.
  const tomorrow = new Date(now.getTime() + 86_400_000);
  for (const e of entries) {
    const lines = e.lines ?? [];
    const d = sum(lines.map(l => l.debit || 0)), c = sum(lines.map(l => l.credit || 0));
    const piece = `${e.journalCode} ${e.reference ?? ""}`.trim();
    if (Math.abs(d - c) > 1) add({ severity: "Critique", check: "Écriture déséquilibrée", piece, date: e.entryDate, amount: round(d - c), detail: `Débits ${round(d)} ≠ crédits ${round(c)}`, fix: "Ne pas extourner (l'extourne serait elle aussi déséquilibrée) : correction par l'équipe technique de Kanoo, tracée au journal d'audit" });
    if (e.entryDate > tomorrow) add({ severity: "À vérifier", check: "Écriture datée dans le futur", piece, date: e.entryDate, detail: e.label ?? "", fix: "Vérifier la date de la pièce d'origine" });
  }
  // 2. Comptes utilisés absents du plan comptable ou désactivés.
  const usage = new Map<string, number>();
  for (const e of entries) for (const code of new Set((e.lines ?? []).map(l => l.accountCode))) usage.set(code, (usage.get(code) ?? 0) + 1);
  const known = new Map(ledger.map(a => [a.code, a]));
  for (const code of usage.size ? await unknownAccounts(tenantId, [...usage.keys()]) : []) {
    const inactive = known.get(code)?.isActive === false;
    add({ severity: "Majeur", check: inactive ? "Compte désactivé encore utilisé" : "Compte absent du plan comptable", piece: code, detail: `Utilisé dans ${usage.get(code) ?? 0} écriture(s)`, fix: `Comptabilité → Plan comptable : ${inactive ? "réactiver" : "créer"} le compte` });
  }
  // 3. Factures et avoirs : une écriture de vente active, du montant de la pièce (TTC, HT et TVA), dans l'exercice de la pièce.
  const series = new Map<string, number[]>();
  for (const inv of invoices) {
    const isCredit = inv.documentType === "credit_note";
    const key = `${isCredit ? "Avoir" : "Facture"} ${inv.number}`;
    const m = inv.status === "draft" || /^BROUILLON/i.test(inv.number ?? "") ? null : /^(.*?)(\d+)$/.exec(inv.number ?? "");
    if (m) series.set(m[1], [...(series.get(m[1]) ?? []), Number(m[2])]);
    const sale = active(inv._id, "invoice", isVT);
    if (inv.status === "draft") {
      // Les brouillons d'avant octobre 2026 étaient comptabilisés dès leur création.
      if (sale.length) add({ severity: "Critique", check: "Brouillon comptabilisé", piece: key, date: inv.issueDate, amount: round(inv.totalTTC), detail: "Chiffre d'affaires et TVA comptés pour une facture jamais émise", fix: "Vente réelle : Factures → Émettre (l'écriture existante est conservée). Sinon : Factures → Supprimer le brouillon (l'écriture est extournée). Si le mois a déjà été déclaré : signaler au fiscaliste la TVA déclarée en trop" });
      continue;
    }
    if (inv.status === "cancelled") {
      // Annulée par avoir total : la vente reste, l'avoir la compense. Sinon elle doit être extournée.
      if (sale.length && (inv.creditedAmount ?? 0) < inv.totalTTC - 1) add({ severity: "Critique", check: "Facture annulée encore comptabilisée", piece: key, date: inv.issueDate, amount: round(inv.totalTTC), detail: "Ni extournée ni compensée par un avoir : chiffre d'affaires et TVA restent comptés", fix: EDITOR });
      continue;
    }
    if (!sale.length) { add({ severity: "Critique", check: `${isCredit ? "Avoir" : "Facture"} sans écriture de vente`, piece: key, date: inv.issueDate, amount: round(inv.totalTTC), detail: "Chiffre d'affaires, TVA et créance absents de la comptabilité", fix: EDITOR }); continue; }
    const n = sale.length;
    if (n > 1) add({ severity: "Critique", check: "Vente comptabilisée plusieurs fois", piece: key, date: inv.issueDate, amount: round(inv.totalTTC * (n - 1)), detail: `${n} écritures de vente actives pour une seule pièce`, fix: EDITOR });
    const lines = sale.flatMap(e => e.lines ?? []);
    const sign = isCredit ? -1 : 1;
    const receivable = net(lines, /^411/);
    if (Math.abs(receivable - sign * inv.totalTTC * n) >= 1) add({ severity: "Majeur", check: "Écriture de vente ≠ TTC de la pièce", piece: key, date: inv.issueDate, amount: round(receivable - sign * inv.totalTTC * n), detail: `Créance comptable (411 + 4117) ${round(receivable)} ; pièce ${round(sign * inv.totalTTC)}`, fix: "Factures → correction contrôlée si la facture est fausse ; sinon transmettre à l'équipe technique de Kanoo" });
    else if (n === 1) {
      const vat = -net(lines, /^443/), ht = -net(lines, /^(7|419)/);
      if (Math.abs(vat - sign * inv.totalTVA) >= 1 || Math.abs(ht - sign * inv.totalHT) >= 1) add({ severity: "Majeur", check: "Ventilation HT / TVA de l'écriture ≠ pièce", piece: key, date: inv.issueDate, amount: round(vat - sign * inv.totalTVA), detail: `Écriture : HT ${round(ht)}, TVA ${round(vat)} ; pièce : HT ${round(sign * inv.totalHT)}, TVA ${round(sign * inv.totalTVA)}`, fix: "Transmettre à l'équipe technique de Kanoo : la TVA collectée du mois est faussée d'autant" });
    }
    if (sale.some(e => e.entryDate.getFullYear() !== inv.issueDate.getFullYear())) add({ severity: "À vérifier", check: "Écriture de vente hors de l'exercice de la pièce", piece: key, date: inv.issueDate, amount: round(inv.totalTTC), detail: "Le chiffre d'affaires est rattaché à un autre exercice que la facture", fix: "Vérifier la date ; si l'exercice est clôturé : régularisation sur l'exercice en cours, validée par le cabinet" });
  }
  // Série continue (exigence du SECeF et du contrôle fiscal) : un numéro manquant = une pièce supprimée.
  for (const [prefix, nums] of series) {
    const seen = new Set(nums), lo = Math.min(...nums), hi = Math.max(...nums), missing: number[] = [];
    for (let i = lo; i <= hi && missing.length <= 50; i++) if (!seen.has(i)) missing.push(i);
    if (missing.length) add({ severity: "À vérifier", check: "Numéros manquants dans la série", piece: `${prefix}…`, detail: `${missing.length > 50 ? "plus de 50" : missing.length} numéro(s) absent(s) entre ${lo} et ${hi} : ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? "…" : ""}`, fix: "Retrouver la pièce de chaque numéro (supprimée ? autre exercice ?) et en garder la justification" });
  }
  // 4. Règlements clients : écriture de trésorerie si effectif, aucune si annulé.
  for (const p of payments) {
    const piece = `Règlement ${p.reference || String(p._id).slice(-6).toUpperCase()}`;
    const live = active(p._id, "payment");
    if (p.status === "effective" && !live.some(e => !isOD(e.journalCode))) add({ severity: "Critique", check: "Encaissement sans écriture", piece, date: p.date, amount: round(p.amount), detail: "Trésorerie et créance client non mouvementées en comptabilité", fix: "Ventes → Encaissements : annuler l'encaissement, puis le ressaisir" });
    if (p.status === "cancelled" && live.some(e => !isOD(e.journalCode))) add({ severity: "Critique", check: "Encaissement annulé encore comptabilisé", piece, date: p.date, amount: round(p.amount), detail: "L'écriture de règlement n'est pas extournée : trésorerie et créance client faussées", fix: EDITOR });
    else if (p.status === "cancelled" && live.length) add({ severity: "Information", check: "Timbre-quittance conservé après annulation", piece, date: p.date, detail: "Seule l'écriture de timbre (OD) reste", fix: "Normal si le reçu avait été remis au client ; sinon transmettre à l'équipe technique de Kanoo" });
  }
  // 5. Achats : écriture AC active du montant de l'achat si validé, aucune si annulé ; règlements avec leur écriture.
  for (const p of purchases) {
    if (p.status === "draft" || p.date < from || p.date > end) continue;
    const piece = `Achat ${p.number}`;
    const act = active(p._id, "supplier_invoice", isAC);
    if (p.status === "cancelled") {
      if (act.length) add({ severity: "Critique", check: "Achat annulé encore comptabilisé", piece, date: p.date, amount: round(p.totalTTC), detail: "La charge et la dette fournisseur restent comptées", fix: EDITOR });
      continue;
    }
    if (!act.length) { add({ severity: "Critique", check: "Achat validé sans écriture", piece, date: p.date, amount: round(p.totalTTC), detail: "Charge, TVA déductible et dette fournisseur absentes de la comptabilité", fix: "Achats & stock → Factures & dépenses : annuler les règlements de l'achat, puis l'achat, puis ressaisir les deux" }); continue; }
    const debt = -net(act.flatMap(e => e.lines ?? []), /^40/);
    if (act.length > 1) add({ severity: "Critique", check: "Achat comptabilisé plusieurs fois", piece, date: p.date, amount: round(debt - p.totalTTC), detail: `${act.length} écritures d'achat actives`, fix: EDITOR });
    else if (Math.abs(debt - p.totalTTC) >= 1) add({ severity: "Majeur", check: "Écriture d'achat ≠ montant de l'achat", piece, date: p.date, amount: round(debt - p.totalTTC), detail: `Dette comptable ${round(debt)} ; achat ${round(p.totalTTC)}`, fix: "Achats & stock → Factures & dépenses : annuler les règlements, puis l'achat, puis ressaisir" });
  }
  const supplierPayments = purchases.flatMap(p => (p.payments ?? []).filter(x => x.date >= from && x.date <= end).map(x => ({ ...x, purchase: p })));
  for (const p of purchases) {
    const paid = (p.payments ?? []).filter(x => !x.cancelledAt).length;
    const posted = active(p._id, "supplier_payment", isTreasury).length;
    if (paid > posted) add({ severity: "Critique", check: "Règlement fournisseur sans écriture", piece: `Achat ${p.number}`, date: p.date, amount: round(p.paidAmount ?? 0), detail: `${paid} règlement(s) non annulé(s), ${posted} écriture(s) de règlement`, fix: EDITOR });
  }
  // 6. Notes de frais : OD à l'approbation, trésorerie au remboursement.
  for (const x of expenses) {
    if (!["approved", "reimbursed"].includes(x.status)) continue;
    const piece = `Note de frais ${x.reference}`;
    if (!active(x._id, "expense", isOD).length) add({ severity: "Critique", check: "Note de frais approuvée sans écriture", piece, date: x.approvedAt, amount: round(x.totalTTC ?? 0), detail: "La charge et la dette envers le salarié manquent", fix: EDITOR });
    if (x.status === "reimbursed" && !active(x._id, "expense", isTreasury).length) add({ severity: "Critique", check: "Remboursement de note de frais sans écriture", piece, date: x.reimbursedAt, amount: round(x.totalTTC ?? 0), detail: "La sortie de trésorerie n'est pas en comptabilité", fix: EDITOR });
  }
  // Anciens comptes des notes de frais (numéros du plan français) : 6251-6253 sont des
  // primes d'assurance en SYSCOHADA, 6241 l'entretien, 6288-6289 des télécommunications.
  // 6051 est l'eau : les fournitures de bureau vont au 6055. Les OD de reclassement
  // référencées « RECL-NDF » viennent en déduction : le constat disparaît une fois traité.
  const MISFILED: Record<string, string> = { "605100": "605500", "624100": "618000", "625100": "638200", "625200": "638200", "625300": "638200", "628800": "633000", "628900": "638000" };
  const misfiled = new Map<string, number>();
  for (const e of entries) {
    const reclass = /^RECL-NDF/i.test(e.reference ?? "");
    if (!(e.linkedDocType === "expense" && !e.reversedBy) && !reclass) continue;
    for (const l of e.lines ?? []) if (MISFILED[l.accountCode]) misfiled.set(l.accountCode, (misfiled.get(l.accountCode) ?? 0) + (l.debit || 0) - (l.credit || 0));
  }
  for (const [code, amount] of misfiled) if (Math.abs(amount) >= 1) add({ severity: "Majeur", check: "Notes de frais sur un compte non conforme au SYSCOHADA", piece: `${code} → ${MISFILED[code]}`, amount: round(amount), detail: `Charges de notes de frais passées au ${code} (numérotation du plan français), à reclasser au ${MISFILED[code]}`, fix: "OD de reclassement validée par le cabinet, avec une référence commençant par RECL-NDF (le constat disparaît alors). Les notes approuvées depuis la correction vont au bon compte" });
  // 7. Paie : OD à l'émission du bulletin, trésorerie au paiement.
  for (const s of payslips) {
    const piece = `Bulletin ${String(s.month).padStart(2, "0")}/${s.year} — ${employeeCode.get(String(s.employeeId)) ?? "salarié"}`;
    if (!active(s._id, "payslip", isOD).length) add({ severity: "Critique", check: "Bulletin de paie sans écriture", piece, date: new Date(s.year, s.month - 1, 1), amount: round(s.grossTotal ?? 0), detail: "Salaires, cotisations et ITS absents de la comptabilité", fix: EDITOR });
    if (s.isPaid && !active(s._id, "payslip", isTreasury).length) add({ severity: "Critique", check: "Salaire payé sans écriture", piece, date: s.paidAt, amount: round(s.netSalary ?? 0), detail: "Le paiement du net n'est pas en comptabilité", fix: EDITOR });
  }
  // 8. Comptoir : un ticket n'est comptabilisé que si le comptoir est relié à une caisse.
  const tickets = await ComptoirSaleModel.aggregate<{ _id: { desk: Types.ObjectId; month: number }; n: number; ttc: number; ht: number; tva: number; unposted: number; unpostedTTC: number }>([
    { $match: { tenantId: tid, date: inYear, status: "paid" } },
    { $group: { _id: { desk: "$deskId", month: { $month: { date: "$date", timezone: "Africa/Niamey" } } }, n: { $sum: 1 }, ttc: { $sum: "$totalTTC" }, ht: { $sum: "$totalHT" }, tva: { $sum: "$totalTVA" },
      unposted: { $sum: { $cond: [{ $ifNull: ["$entryId", false] }, 0, 1] } }, unpostedTTC: { $sum: { $cond: [{ $ifNull: ["$entryId", false] }, 0, "$totalTTC"] } } } },
    { $sort: { "_id.desk": 1, "_id.month": 1 } },
  ]);
  const unpostedByDesk = new Map<string, { n: number; ttc: number }>();
  for (const t of tickets) if (t.unposted) { const k = String(t._id.desk); const c = unpostedByDesk.get(k) ?? { n: 0, ttc: 0 }; unpostedByDesk.set(k, { n: c.n + t.unposted, ttc: c.ttc + t.unpostedTTC }); }
  for (const [k, v] of unpostedByDesk) add({ severity: "Majeur", check: "Tickets de comptoir hors comptabilité", piece: deskOf.get(k)?.name ?? "Comptoir supprimé", amount: round(v.ttc), detail: `${v.n} ticket(s) sans écriture : ventes et TVA collectée absentes${deskOf.get(k)?.treasuryAccountId ? "" : " (comptoir non relié à une caisse)"}`, fix: "Comptoir : relier le comptoir à une caisse (Trésorerie). Tickets passés : écriture de régularisation validée par le cabinet" });

  // 9. Trésorerie : solde des mouvements = solde du compte comptable, à la même date.
  const [treasuryCumul, movementTotals] = await Promise.all([
    AccountingEntryModel.aggregate<{ _id: string; d: number; c: number }>([
      { $match: { tenantId: tid, entryDate: { ...(floor ? { $gte: floor } : {}), $lte: at } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $regex: "^5" } } },
      { $group: { _id: "$lines.accountCode", d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
    ]),
    TreasuryMovementModel.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { tenantId: tid, date: { $lte: at } } }, { $group: { _id: "$accountId", total: { $sum: "$amount" } } },
    ]),
  ]);
  const ledgerBalance = new Map(treasuryCumul.map(r => [r._id, r.d - r.c]));
  const movOf = new Map(movementTotals.map(m => [String(m._id), m.total]));
  const codeOf = (a: { ledgerCode?: string; type: string }) => a.ledgerCode || ledgerFor(a.type).accountCode;
  const sharing = new Map<string, number>();
  for (const a of accounts) sharing.set(codeOf(a), (sharing.get(codeOf(a)) ?? 0) + 1);
  const treasuryRows = accounts.map(a => {
    const code = codeOf(a);
    // Solde d'ouverture : seulement s'il est antérieur à la date d'arrêté.
    const opening = !a.openingDate || a.openingDate <= at ? (a.openingBalance ?? a.balance ?? 0) : 0;
    const treasury = opening + (movOf.get(String(a._id)) ?? 0);
    const shared = (sharing.get(code) ?? 0) > 1;
    const ledgerAmount = ledgerBalance.get(code) ?? 0;
    return { label: a.label, type: a.type, code, opening, treasury, ledger: ledgerAmount, shared, gap: shared ? null : treasury - ledgerAmount };
  });
  for (const code of new Set(treasuryRows.map(t => t.code))) {
    const rows = treasuryRows.filter(t => t.code === code);
    const ledgerAmount = ledgerBalance.get(code) ?? 0;
    const gap = sum(rows.map(t => t.treasury)) - ledgerAmount;
    if (Math.abs(gap) >= 1) add({ severity: "Majeur", check: "Trésorerie ≠ comptabilité", piece: `${rows.map(t => t.label).join(" + ")} (${code})`, amount: round(gap), detail: `Solde des mouvements ${round(gap + ledgerAmount)} ; solde comptable ${round(ledgerAmount)} au ${at.toLocaleDateString("fr-FR")}${rows.some(r => Math.abs(r.opening - gap) < 1) ? " — l'écart vaut le solde d'ouverture" : ""}`, fix: "Trésorerie → compte → Rapprochement. Si l'écart vaut le solde d'ouverture : Comptabilité → Reprise d'ouverture, à faire valider par le cabinet" });
  }
  const treasuryCodes = new Set(treasuryRows.map(t => t.code));
  for (const [code, bal] of ledgerBalance) {
    if (treasuryCodes.has(code) || Math.abs(bal) < 1) continue;
    if (/^58/.test(code)) add({ severity: "Majeur", check: "Virements internes non soldés", piece: code, amount: round(bal), detail: "Un virement entre comptes n'a qu'une de ses deux jambes", fix: "Un virement Kanoo est une seule écriture équilibrée : l'écart vient d'écritures manuelles ou anciennes sur ce compte. Les retrouver dans la feuille « Écritures » et les faire justifier par le cabinet" });
    else add({ severity: "Majeur", check: "Compte de trésorerie comptable sans compte de trésorerie", piece: code, amount: round(bal), detail: "Mouvements sur ce compte sans compte de trésorerie correspondant (encaissements saisis sans compte, saisies anciennes) : rien ne le rapproche", fix: "Créer ou rattacher le compte de trésorerie ; reclassement par une OD validée par le cabinet" });
  }
  if (sharing.size < accounts.length) add({ severity: "À vérifier", check: "Plusieurs comptes de trésorerie sur un même compte comptable", piece: [...sharing].filter(([, k]) => k > 1).map(([c]) => c).join(", "), detail: "Le grand livre ne distingue pas ces comptes : rapprochement banque par banque impossible", fix: "Trésorerie → compte → Attribuer un compte comptable : Kanoo reclasse lui-même les mouvements (OD « RECL- »). Ne pas ajouter d'OD manuelle ; seul un écart résiduel est à justifier" });

  // 10. Déclarations : la plus récente de chaque période fait foi ; TVA déclarée = TVA comptable du mois.
  const periodKey = (d: { type: string; period: { mois?: number; trimestre?: number } }) => `${d.type}:${d.period?.mois ?? ""}:${d.period?.trimestre ?? ""}`;
  const byPeriod = new Map<string, typeof declarations>();
  for (const d of declarations.filter(x => x.status !== "draft")) byPeriod.set(periodKey(d), [...(byPeriod.get(periodKey(d)) ?? []), d]);
  for (const list of byPeriod.values()) if (list.length > 1) add({ severity: "À vérifier", check: "Plusieurs déclarations pour une même période", piece: `${DECL_TYPE(list[0].type)} ${list[0].period?.mois ? MONTHS[list[0].period.mois - 1] + " " : ""}${year}`, detail: `${list.length} déclarations enregistrées ; la plus récente est retenue`, fix: "Garder la déclaration réellement déposée ; signaler les autres à l'équipe technique de Kanoo" });
  const vatRows = MONTHS.map((month, i) => {
    const v = vatFromEntries(entries.filter(e => e.entryDate.getMonth() === i));
    const list = byPeriod.get(`tva:${i + 1}:`) ?? [];
    const decl = list[list.length - 1];
    const declared = decl ? (decl.amounts?.net ?? decl.amounts?.montant ?? null) : null;
    if (decl && declared !== null && Math.abs(declared - v.net) >= 1) add({ severity: "Majeur", check: "TVA déclarée ≠ TVA comptable", piece: `TVA ${month} ${year}`, amount: round(declared - v.net), detail: `Déclarée ${round(declared)} ; comptable ${round(v.net)} (écritures passées ou corrigées après la déclaration ?)`, fix: "Fiscalité → TVA : vérifier les écritures du mois ; si la déclaration est fausse, la rectifier (motif obligatoire) et déposer une rectificative" });
    return { month, ...v, declared, status: decl?.status ?? "" };
  });

  // 11. Comptes clients et fournisseurs, à ce jour (le reste dû des pièces est un état présent).
  const nowFloor = balanceFloor(now, closed);
  const [tiersCumul, open, openPurchases] = await Promise.all([
    AccountingEntryModel.aggregate<{ _id: { code: string; tiers: unknown }; d: number; c: number }>([
      { $match: { tenantId: tid, ...(nowFloor ? { entryDate: { $gte: nowFloor } } : {}) } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $regex: "^(40|41)" } } },
      { $group: { _id: { code: "$lines.accountCode", tiers: "$lines.thirdPartyId" }, d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
    ]),
    InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: { $nin: ["draft", "cancelled", "paid", "written_off"] } })
      .select("clientId totalTTC paidAmount creditedAmount retentionAmount status").lean<Array<{ clientId?: Types.ObjectId; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status?: string }>>(),
    PurchaseModel.find({ tenantId: tid, status: { $in: ["validated", "partial"] } }).select("supplierId totalTTC paidAmount").lean<Array<{ supplierId?: Types.ObjectId; totalTTC: number; paidAmount?: number }>>(),
  ]);
  const dueByClient = new Map<string, number>();
  for (const inv of open) { const k = String(inv.clientId ?? ""); dueByClient.set(k, (dueByClient.get(k) ?? 0) + invoiceDue(inv)); }
  const sideBy = (re: RegExp) => { const m = new Map<string, number>(); for (const r of tiersCumul) if (re.test(r._id.code)) { const k = String(r._id.tiers ?? ""); m.set(k, (m.get(k) ?? 0) + r.d - r.c); } return m; };
  const arByClient = sideBy(AR_ACCOUNT), retentionBy = sideBy(/^4117/), advanceBy = sideBy(/^419/);
  const clientRows = [...new Set([...dueByClient.keys(), ...arByClient.keys()])].map(k => {
    const due = dueByClient.get(k) ?? 0, ar = arByClient.get(k) ?? 0;
    const name = k ? clientOf.get(k)?.name ?? "(fiche supprimée)" : "(sans client)";
    if (current && Math.abs(due - ar) >= 1) add({ severity: Math.abs(due - ar) >= 1_000_000 ? "Majeur" : "À vérifier", check: "Compte client ≠ factures non réglées", piece: name, amount: round(ar - due), detail: `Solde 411/416 ${round(ar)} ; reste dû des factures ${round(due)}`, fix: k ? "Comptabilité → Lettrage du compte client ; Clients → relevé. Écart = avoir non remboursé, règlement hors facture ou écriture manuelle" : "Écritures sur 411 sans client (saisies manuelles) : les retrouver dans la feuille « Écritures » et les faire rattacher au client par l'équipe technique de Kanoo" });
    return { name, code: k ? clientOf.get(k)?.code ?? "" : "", ar, due, gap: ar - due, retention: retentionBy.get(k) ?? 0, advance: -(advanceBy.get(k) ?? 0) };
  }).filter(r => Math.abs(r.ar) >= 1 || Math.abs(r.due) >= 1 || Math.abs(r.retention) >= 1 || Math.abs(r.advance) >= 1);
  const supplierBalance = new Map<string, number>();
  for (const r of tiersCumul) if (/^40/.test(r._id.code)) { const k = String(r._id.tiers ?? ""); supplierBalance.set(k, (supplierBalance.get(k) ?? 0) + r.c - r.d); }
  const dueBySupplier = new Map<string, number>();
  for (const p of openPurchases) if (p.supplierId) { const k = String(p.supplierId); dueBySupplier.set(k, (dueBySupplier.get(k) ?? 0) + Math.max(0, p.totalTTC - (p.paidAmount ?? 0))); }
  const supplierRows = [...new Set([...supplierBalance.keys(), ...dueBySupplier.keys()])].map(k => {
    const balance = supplierBalance.get(k) ?? 0, due = k ? dueBySupplier.get(k) ?? 0 : null;
    const name = k ? supplierOf.get(k)?.name ?? "(fiche supprimée)" : "(sans fournisseur)";
    if (current && due !== null && Math.abs(balance - due) >= 1) add({ severity: "À vérifier", check: "Compte fournisseur ≠ achats non payés", piece: name, amount: round(balance - due), detail: `Solde 40 ${round(balance)} ; reste à payer des achats ${round(due)}`, fix: "Achats & stock → Factures & dépenses ; Fiscalité → Retenues à la source (une retenue réduit la dette)" });
    return { name, code: k ? supplierOf.get(k)?.code ?? "" : "", balance, due };
  }).filter(r => Math.abs(r.balance) >= 1 || Math.abs(r.due ?? 0) >= 1);
  const orphan40 = supplierBalance.get("") ?? 0;
  if (current && Math.abs(orphan40) >= 1) add({ severity: "À vérifier", check: "Dette fournisseur sans fournisseur", piece: "Comptes 40", amount: round(orphan40), detail: "Solde non rattaché à un fournisseur (achats au comptant sans fournisseur, retenues à la source opérées, saisies manuelles) : non lettrable", fix: "Retrouver ces écritures dans la feuille « Écritures » (compte 40, colonne CompAuxNum vide) et les faire justifier par le cabinet" });

  // 12. Charges et produits sans secteur d'activité.
  const plLines = entries.flatMap(e => (e.lines ?? []).filter(l => /^[67]/.test(l.accountCode ?? "")));
  const unassigned = plLines.filter(l => !l.activityId);
  if (unassigned.length) add({ severity: "Information", check: "Charges et produits sans secteur d'activité", piece: `${unassigned.length} ligne(s)`, amount: round(sum(unassigned.map(l => (l.credit || 0) - (l.debit || 0)))), detail: "Absents de toute rentabilité par activité (feuille « Par activité », ligne « Non imputé »)", fix: "Imputer factures, achats et notes de frais ; répartir paie et dotations" });

  // 13. Contrôles avant clôture de l'exercice, et exercice précédent non clôturé.
  for (const c of await closingChecks(tenantId, year)) {
    if (c.code === "current_year") continue;
    add({ severity: c.level === "block" ? "Majeur" : "À vérifier", check: "Avant clôture", piece: c.code, detail: c.message, fix: "Comptabilité → Clôture : contrôles avant clôture" });
  }
  const priorOpen = !closed.includes(year - 1) && !!(await AccountingEntryModel.exists({ tenantId: tid, entryDate: { $lt: from } }));
  if (priorOpen) add({ severity: "Information", check: `Exercice ${year - 1} non clôturé`, piece: String(year - 1), detail: "Balance et bilan cumulent les exercices non clôturés ; le résultat du bilan inclut celui des exercices précédents", fix: `Comptabilité → Clôture : clôturer ${year - 1} une fois ses comptes arrêtés` });

  // 14. TVA liquidée : crédit négatif (4449 créditeur), TVA due non réglée (4441).
  const vatAccounts = await AccountingEntryModel.aggregate<{ _id: string; d: number; c: number }>([
    { $match: { tenantId: tid, "lines.accountCode": { $in: ["444100", "444900"] }, entryDate: { ...(floor ? { $gte: floor } : {}), $lte: at } } },
    { $unwind: "$lines" }, { $match: { "lines.accountCode": { $in: ["444100", "444900"] } } },
    { $group: { _id: "$lines.accountCode", d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]);
  const vatBal = (code: string) => { const r = vatAccounts.find(x => x._id === code); return r ? r.d - r.c : 0; };
  if (vatBal("444900") <= -1) add({ severity: "Majeur", check: "Crédit de TVA négatif", piece: "Compte 444900", amount: round(vatBal("444900")), detail: "Plus de crédit de TVA imputé qu'il n'en existait (rectification d'un mois déjà suivi d'une liquidation ?)", fix: "Fiscalité → TVA : à régulariser par le cabinet, puis repasser les liquidations dans l'ordre" });
  if (vatBal("444100") >= 1) add({ severity: "Majeur", check: "TVA payée plus qu'elle n'était due", piece: "Compte 444100", amount: round(vatBal("444100")), detail: "Le compte de TVA à payer est débiteur : paiement en double ou liquidation repassée après paiement", fix: "Fiscalité → TVA : vérifier les paiements du mois ; trop-payé à imputer sur la prochaine échéance, avec le cabinet" });
  if (vatBal("444100") <= -1) add({ severity: "À vérifier", check: "TVA due non réglée", piece: "Compte 444100", amount: round(-vatBal("444100")), detail: `TVA liquidée restant à payer au ${at.toLocaleDateString("fr-FR")} (la dernière peut être dans son délai)`, fix: "Fiscalité → TVA → Enregistrer le paiement, mois par mois" });

  // États : balance cumulée et états SYSCOHADA (N et N-1).
  const balance = await trialBalance(tenantId, floor, at);
  const fs = await financialStatements(tenantId, year, at);
  if (Math.abs(fs.balanceSheet.totalActif - fs.balanceSheet.totalPassif) >= 1) add({ severity: "Critique", check: "Bilan déséquilibré", piece: `Bilan au ${at.toLocaleDateString("fr-FR")}`, amount: round(fs.balanceSheet.totalActif - fs.balanceSheet.totalPassif), detail: `Actif ${round(fs.balanceSheet.totalActif)} ; passif ${round(fs.balanceSheet.totalPassif)} : comptes hors des classes 1 à 8, ou écritures déséquilibrées`, fix: "Voir les constats « Écriture déséquilibrée » et « Compte absent du plan comptable » ; correction par l'équipe technique de Kanoo" });

  anomalies.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const counts = { "Critique": 0, "Majeur": 0, "À vérifier": 0, "Information": 0 } as Record<Severity, number>;
  for (const a of anomalies) counts[a.severity]++;


  const slug = (tenant?.slug || tenant?.name || "organisation").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const filename = `${slug}_export-financier_${year}_${localDay(now).replace(/-/g, "")}.xlsx`;

  // ── Classeur ─────────────────────────────────────────────────────────────
  async function write(out: Writable) {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
    wb.creator = "Kanoo";
    wb.created = now;
    const money = "#,##0;[Red]-#,##0";
    const atLabel = at.toLocaleDateString("fr-FR");
    type Col = { h: string; w: number; kind?: "money" | "date" };
    const sheet = (name: string, title: string, cols: Col[]) => {
      const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5 }] });
      ws.columns = cols.map(c => ({ width: c.w }));
      const put = (values: unknown[], font?: Partial<ExcelJS.Font>) => { const r = ws.addRow(values); if (font) r.font = font; r.commit(); };
      put([tenant?.name ?? ""], { bold: true, size: 13 });
      put([`${title} — exercice ${year}`], { bold: true });
      put([`NIF ${tenant?.nif || "—"} · RCCM ${tenant?.rccm || "—"} · montants en FCFA · arrêté au ${atLabel}${current ? " (exercice en cours : chiffres provisoires)" : ""} · extrait le ${now.toLocaleString("fr-FR")}`], { italic: true, color: { argb: "FF6B717B" } });
      put([]);
      const head = ws.addRow(cols.map(c => c.h));
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17375C" } }; });
      head.commit();
      ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: cols.length } };
      return {
        row(values: unknown[], font?: Partial<ExcelJS.Font>, firstCell?: Partial<ExcelJS.Font>) {
          const r = ws.addRow(values.map((v, i) => {
            const kind = cols[i]?.kind;
            if (v instanceof Date) return isNaN(v.getTime()) ? null : xlDay(v);
            if (kind === "money") return v === null || v === undefined || v === "" ? null : Number(v) || 0;
            return typeof v === "string" ? v.slice(0, 32_000) : v;
          }));
          cols.forEach((c, i) => { if (c.kind) r.getCell(i + 1).numFmt = c.kind === "money" ? money : "dd/mm/yyyy"; });
          if (font) r.font = font;
          if (firstCell) r.getCell(1).font = firstCell;
          r.commit();
        },
        done: () => ws.commit(),
      };
    };
    const B = { bold: true };

    // Mode d'emploi
    const how = sheet("Mode d'emploi", "Mode d'emploi du classeur", [{ h: "Rubrique", w: 26 }, { h: "Contenu", w: 120 }]);
    for (const [k, v] of [
      ["1. Commencer", "Ouvrir la feuille « Contrôles ». Traiter d'abord les constats « Critique », puis « Majeur ». Noter dans les colonnes de suivi qui traite, quand, et la réponse."],
      ["2. Gravités", "Critique : la comptabilité est fausse (montant, TVA ou trésorerie). Majeur : écart à corriger avant clôture. À vérifier : écart à expliquer, pas forcément une erreur. Information : à connaître."],
      ["3. Corriger", "Suivre la colonne « Où corriger ». Ne jamais compenser une écriture de pièce par une saisie manuelle : elle ne serait pas liée à la pièce et le constat reviendrait."],
      ["4. Exercice clôturé", "Sur un exercice clôturé ou une période verrouillée, ne rien annuler : passer une régularisation sur l'exercice en cours, validée par le cabinet."],
      ["5. Vérifier", "Relancer l'export après les corrections : les constats traités disparaissent. Exceptions : les tickets de comptoir régularisés par une écriture globale et les écarts justifiés par le cabinet restent affichés ; noter alors la référence de l'écriture ou de la justification dans « Commentaire »."],
      ["Couvert", "Écritures, balance, bilan, compte de résultat et flux de trésorerie SYSCOHADA, TVA, déclarations enregistrées, factures et avoirs, encaissements, achats et règlements fournisseurs, notes de frais, paie" + (opts.payroll ? "" : " (non incluse : droit de lecture des bulletins requis)") + ", comptoir, trésorerie et mouvements, clients, fournisseurs, immobilisations, résultat par activité, plan comptable."],
      ["Non couvert", "Valorisation du stock (Achats & stock → Stock, Inventaires), cautions bancaires (Cautions), devis, commandes et bons de livraison non facturés, balance âgée (Relances)."],
      ["Dates", "Clients et Fournisseurs : soldes à ce jour (leurs contrôles ne figurent que dans l'export de l'exercice en cours). Balance, Bilan et Trésorerie : à la date d'arrêté. Autres feuilles : l'exercice entier."],
      ["Confidentialité", "Le classeur contient des données nominatives (clients, fournisseurs) et la paie par matricule. Le transmettre au seul cabinet comptable, par un canal sûr, et supprimer les copies inutiles."],
    ]) how.row([k, v]);
    how.done();

    // Synthèse
    const syn = sheet("Synthèse", "Export financier complet", [{ h: "Rubrique", w: 52 }, { h: "Valeur", w: 24, kind: "money" }]);
    const allLines = entries.flatMap(e => e.lines ?? []);
    const bs = fs.balanceSheet, is = fs.incomeStatement;
    for (const [k, v] of [
      ["Écritures de l'exercice", entries.length],
      ["Total des débits", sum(allLines.map(l => l.debit || 0))], ["Total des crédits", sum(allLines.map(l => l.credit || 0))],
      ["Chiffre d'affaires (SYSCOHADA)", is.chiffreAffaires],
      ["Résultat net de l'exercice (SYSCOHADA)", is.resultat + is.unclassified],
      [`Bilan au ${atLabel} — total actif`, bs.totalActif], [`Bilan au ${atLabel} — total passif`, bs.totalPassif], ["Écart actif − passif (doit être nul)", bs.totalActif - bs.totalPassif],
      [`Trésorerie comptable (classe 5) au ${atLabel}`, sum([...ledgerBalance.values()])],
      ["Factures et avoirs émis", invoices.filter(i => i.status !== "draft").length], ["Achats enregistrés", purchases.filter(p => p.status !== "draft" && p.date >= from && p.date <= end).length],
      ["Constats critiques", counts["Critique"]], ["Constats majeurs", counts["Majeur"]], ["Constats à vérifier", counts["À vérifier"]], ["Informations", counts["Information"]],
      ["Exercices clôturés", closed.length ? [...closed].sort().join(", ") : "aucun"],
      ["Période verrouillée jusqu'au", tenant?.accountingLockedUntil ? tenant.accountingLockedUntil.toLocaleDateString("fr-FR") : "—"],
    ] as Array<[string, number | string]>) syn.row([k, v]);
    syn.done();

    const SEVERITY_COLOR: Record<Severity, string> = { "Critique": "FFB23B2E", "Majeur": "FFB7791F", "À vérifier": "FF2F78C2", "Information": "FF6B717B" };
    const ctl = sheet("Contrôles", "Contrôles de cohérence", [{ h: "Gravité", w: 12 }, { h: "Contrôle", w: 40 }, { h: "Pièce", w: 30 }, { h: "Date", w: 12, kind: "date" }, { h: "Écart / montant", w: 16, kind: "money" }, { h: "Détail", w: 62 }, { h: "Où corriger", w: 70 }, { h: "Traité le", w: 12 }, { h: "Par", w: 16 }, { h: "Commentaire", w: 40 }, { h: "Validé par le cabinet", w: 14 }]);
    if (!anomalies.length) ctl.row(["—", "Aucun constat", "", null, null, "", ""]);
    for (const a of anomalies) ctl.row([a.severity, a.check, a.piece, a.date ?? null, a.amount ?? null, a.detail, a.fix], undefined, { bold: true, color: { argb: SEVERITY_COLOR[a.severity] } });
    ctl.done();

    const jr = sheet("Écritures", "Journal des écritures (colonnes du FEC, imputation en plus)", [
      { h: "JournalCode", w: 9 }, { h: "JournalLib", w: 16 }, { h: "EcritureNum", w: 11 }, { h: "EcritureDate", w: 12, kind: "date" }, { h: "CompteNum", w: 11 }, { h: "CompteLib", w: 30 },
      { h: "CompAuxNum", w: 12 }, { h: "CompAuxLib", w: 26 }, { h: "PieceRef", w: 20 }, { h: "PieceDate", w: 12, kind: "date" }, { h: "EcritureLib", w: 44 },
      { h: "Debit", w: 14, kind: "money" }, { h: "Credit", w: 14, kind: "money" }, { h: "EcritureLet", w: 10 }, { h: "DateLet", w: 12, kind: "date" }, { h: "ValidDate", w: 12, kind: "date" },
      { h: "Projet", w: 22 }, { h: "Secteur", w: 20 }, { h: "Service", w: 14 }, { h: "Origine", w: 20 }, { h: "Extourne", w: 12 },
    ]);
    // Même numérotation que le FEC de l'exercice (même tri, à partir de 1).
    entries.forEach((e, i) => {
      const num = String(i + 1).padStart(8, "0");
      const slip = e.linkedDocType === "payslip" ? payslipOf.get(String(e.linkedDocId)) : undefined;
      const label = e.linkedDocType === "payslip" ? `Paie ${slip ? `${String(slip.month).padStart(2, "0")}/${slip.year} — matricule ${employeeCode.get(String(slip.employeeId)) ?? "?"}` : "(bulletin)"}` : e.label ?? "";
      for (const l of e.lines ?? []) {
        const t = /^4/.test(l.accountCode ?? "") ? tiers(l.thirdPartyId) : undefined;
        jr.row([e.journalCode, JOURNAL_LABEL[e.journalCode] ?? e.journalCode, num, e.entryDate, l.accountCode, l.accountLabel ?? "", t?.code ?? "", t?.name ?? "", e.reference || num, e.entryDate, label,
          l.debit || 0, l.credit || 0, l.letterRef ?? "", l.letteredAt ?? null, e.createdAt ?? null,
          l.projectId ? projectOf.get(String(l.projectId)) ?? "" : "", l.activityId ? activityOf.get(String(l.activityId)) ?? "" : "", l.costCenter ?? "",
          ORIGIN(e.linkedDocType), e.reversedBy ? "extournée" : e.reverses ? "extourne" : ""]);
      }
    });
    jr.done();

    const bal = sheet("Balance", `Balance générale au ${atLabel} (cumul depuis ${floor ? floor.toLocaleDateString("fr-FR") : "l'origine"})`, [{ h: "Compte", w: 11 }, { h: "Intitulé", w: 40 }, { h: "Débit", w: 16, kind: "money" }, { h: "Crédit", w: 16, kind: "money" }, { h: "Solde débiteur", w: 16, kind: "money" }, { h: "Solde créditeur", w: 16, kind: "money" }]);
    for (const r of balance) bal.row([r.code, r.label, r.debit, r.credit, r.soldeDebit, r.soldeCredit]);
    bal.row(["", "Totaux", sum(balance.map(r => r.debit)), sum(balance.map(r => r.credit)), sum(balance.map(r => r.soldeDebit)), sum(balance.map(r => r.soldeCredit))], B);
    bal.done();

    // États SYSCOHADA : N et N-1, lignes de référence de la liasse.
    const statement = (name: string, title: string, lines: Array<{ ref: string; label: string; amount: number; gross?: number; depreciation?: number; total?: boolean }>, prev: Array<{ ref: string; amount: number }>, withGross = false) => {
      const ws = sheet(name, title, [{ h: "Réf.", w: 7 }, { h: "Libellé", w: 60 }, ...(withGross ? [{ h: "Brut", w: 16, kind: "money" as const }, { h: "Amort. / dépréc.", w: 16, kind: "money" as const }] : []), { h: `Net ${year}`, w: 16, kind: "money" }, { h: `Net ${year - 1}`, w: 16, kind: "money" }]);
      const p = new Map(prev.map(x => [x.ref, x.amount]));
      for (const l of lines) ws.row([l.ref, l.label, ...(withGross ? [l.gross ?? null, l.depreciation ?? null] : []), l.amount, p.get(l.ref) ?? null], l.total ? B : undefined);
      ws.done();
    };
    statement("Bilan actif", `Bilan SYSCOHADA — actif au ${atLabel}`, fs.balanceSheet.actif, fs.balanceSheetPrev.actif, true);
    statement("Bilan passif", `Bilan SYSCOHADA — passif au ${atLabel}`, fs.balanceSheet.passif, fs.balanceSheetPrev.passif);
    statement("Compte de résultat", "Compte de résultat SYSCOHADA", fs.incomeStatement.lines, fs.incomeStatementPrev.lines);
    statement("Flux de trésorerie", "Tableau des flux de trésorerie SYSCOHADA", fs.cashFlow.lines, []);

    const tva = sheet("TVA", "TVA mois par mois : comptabilité et déclarations enregistrées", [{ h: "Mois", w: 12 }, { h: "Collectée (443)", w: 16, kind: "money" }, { h: "Déductible (445)", w: 16, kind: "money" }, { h: "Nette", w: 15, kind: "money" }, { h: "Déclarée (Kanoo)", w: 16, kind: "money" }, { h: "Statut", w: 12 }]);
    for (const v of vatRows) tva.row([v.month, v.collected, v.deductible, v.net, v.declared, DECL_STATUS(v.status)]);
    tva.row(["Total", sum(vatRows.map(v => v.collected)), sum(vatRows.map(v => v.deductible)), sum(vatRows.map(v => v.net)), sum(vatRows.map(v => v.declared ?? 0)), ""], B);
    tva.done();

    const dec = sheet("Déclarations", "Déclarations fiscales et sociales enregistrées", [{ h: "Impôt", w: 18 }, { h: "Période", w: 14 }, { h: "Base", w: 16, kind: "money" }, { h: "Montant", w: 16, kind: "money" }, { h: "Déductible", w: 16, kind: "money" }, { h: "Net", w: 16, kind: "money" }, { h: "Statut", w: 12 }, { h: "Déclarée le", w: 12, kind: "date" }, { h: "Payée le", w: 12, kind: "date" }, { h: "Référence", w: 18 }]);
    for (const d of declarations) dec.row([DECL_TYPE(d.type), d.period?.mois ? `${MONTHS[d.period.mois - 1]} ${year}` : d.period?.trimestre ? `T${d.period.trimestre} ${year}` : String(year), d.amounts?.base ?? null, d.amounts?.montant ?? null, d.amounts?.deductible ?? null, d.amounts?.net ?? null, DECL_STATUS(d.status), d.submittedAt ?? null, d.paidAt ?? null, d.reference ?? ""]);
    dec.done();

    const fac = sheet("Factures", "Factures et avoirs", [{ h: "Numéro", w: 18 }, { h: "Type", w: 10 }, { h: "Date", w: 12, kind: "date" }, { h: "Échéance", w: 12, kind: "date" }, { h: "Client", w: 30 }, { h: "Statut", w: 16 }, { h: "HT", w: 14, kind: "money" }, { h: "TVA", w: 13, kind: "money" }, { h: "Timbre", w: 11, kind: "money" }, { h: "TTC", w: 14, kind: "money" }, { h: "Retenue de garantie", w: 14, kind: "money" }, { h: "Encaissé", w: 14, kind: "money" }, { h: "Avoirs", w: 13, kind: "money" }, { h: "Reste dû", w: 14, kind: "money" }, { h: "Créance douteuse", w: 12 }, { h: "SECeF", w: 14 }, { h: "Écriture de vente", w: 15 }]);
    for (const i of invoices) {
      const isCredit = i.documentType === "credit_note";
      const posted = active(i._id, "invoice", isVT).length;
      fac.row([i.number, isCredit ? "Avoir" : i.kind === "deposit" ? "Acompte" : "Facture", i.issueDate, i.dueDate ?? null, clientOf.get(String(i.clientId))?.name ?? "", INVOICE_STATUS(i.status),
        i.totalHT, i.totalTVA, i.totalDTS ?? 0, i.totalTTC, i.retentionAmount ?? 0, i.paidAmount ?? 0, i.creditedAmount ?? 0, isCredit || ["draft", "cancelled"].includes(i.status) ? 0 : invoiceDue(i),
        i.doubtfulAt ? "oui" : "", i.secef?.code ?? "", i.status === "draft" ? (posted ? "oui (brouillon !)" : "non (brouillon)") : posted ? "oui" : i.status === "cancelled" ? "extournée" : "non"]);
    }
    fac.done();

    const invNum = new Map(invoices.map(i => [String(i._id), i.number]));
    const accLabel = new Map(accounts.map(a => [String(a._id), a.label]));
    const pay = sheet("Encaissements", "Règlements clients", [{ h: "Date", w: 12, kind: "date" }, { h: "Facture", w: 18 }, { h: "Montant", w: 15, kind: "money" }, { h: "Retenue subie", w: 14, kind: "money" }, { h: "Mode", w: 14 }, { h: "Statut", w: 11 }, { h: "Compte de trésorerie", w: 26 }, { h: "Référence", w: 18 }, { h: "Écriture", w: 10 }]);
    for (const p of payments) pay.row([p.date, invNum.get(String(p.invoiceId)) ?? "(facture d'un autre exercice)", p.amount, p.withholdingAmount ?? 0, METHOD(p.method), PAYMENT_STATUS(p.status), accLabel.get(String(p.treasuryAccountId)) ?? "", p.reference ?? "",
      p.status === "effective" ? (active(p._id, "payment", j => !isOD(j)).length ? "oui" : "non") : "—"]);
    pay.done();

    const ach = sheet("Achats", "Achats et factures fournisseurs", [{ h: "Numéro", w: 16 }, { h: "Date", w: 12, kind: "date" }, { h: "Fournisseur", w: 30 }, { h: "Type", w: 10 }, { h: "Statut", w: 14 }, { h: "HT", w: 14, kind: "money" }, { h: "TVA", w: 13, kind: "money" }, { h: "TTC", w: 14, kind: "money" }, { h: "Payé", w: 14, kind: "money" }, { h: "Écriture", w: 10 }]);
    for (const p of purchases) if (p.date >= from && p.date <= end) ach.row([p.number, p.date, p.supplierId ? supplierOf.get(String(p.supplierId))?.name ?? "" : p.payee ?? "", p.kind === "cash" ? "Comptant" : "Facture", PURCHASE_STATUS(p.status), p.totalHT, p.totalTVA, p.totalTTC, p.paidAmount ?? 0,
      ["draft", "cancelled"].includes(p.status) ? "—" : active(p._id, "supplier_invoice", isAC).length ? "oui" : "non"]);
    ach.done();

    const rgl = sheet("Règlements fournisseurs", "Règlements fournisseurs", [{ h: "Date", w: 12, kind: "date" }, { h: "Achat", w: 16 }, { h: "Fournisseur", w: 30 }, { h: "Montant", w: 15, kind: "money" }, { h: "Compte de trésorerie", w: 26 }, { h: "Référence", w: 18 }, { h: "Statut", w: 11 }]);
    for (const x of supplierPayments) rgl.row([x.date, x.purchase.number, x.purchase.supplierId ? supplierOf.get(String(x.purchase.supplierId))?.name ?? "" : x.purchase.payee ?? "", x.amount, accLabel.get(String(x.treasuryAccountId)) ?? "", x.reference ?? "", x.cancelledAt ? "annulé" : "payé"]);
    rgl.done();

    const ndf = sheet("Notes de frais", "Notes de frais", [{ h: "Référence", w: 16 }, { h: "Objet", w: 40 }, { h: "Statut", w: 12 }, { h: "Montant TTC", w: 15, kind: "money" }, { h: "Approuvée le", w: 13, kind: "date" }, { h: "Remboursée le", w: 13, kind: "date" }]);
    for (const x of expenses) ndf.row([x.reference, x.title, EXPENSE_STATUS(x.status), x.totalTTC ?? 0, x.approvedAt ?? null, x.reimbursedAt ?? null]);
    ndf.done();

    if (opts.payroll) {
      const pay2 = sheet("Paie", "Bulletins de paie (par matricule)", [{ h: "Période", w: 10 }, { h: "Matricule", w: 14 }, { h: "Brut", w: 15, kind: "money" }, { h: "CNSS salarié", w: 14, kind: "money" }, { h: "CNSS employeur", w: 15, kind: "money" }, { h: "ITS", w: 13, kind: "money" }, { h: "Autres retenues", w: 14, kind: "money" }, { h: "Net à payer", w: 15, kind: "money" }, { h: "Payé le", w: 12, kind: "date" }, { h: "Écriture de paie", w: 14 }, { h: "Écriture de paiement", w: 16 }]);
      for (const s of payslips) pay2.row([`${String(s.month).padStart(2, "0")}/${s.year}`, employeeCode.get(String(s.employeeId)) ?? "", s.grossTotal ?? 0, s.cnssEmployee ?? 0, s.cnssEmployer ?? 0, s.incomeTax ?? 0, s.otherDeductions ?? 0, s.netSalary ?? 0, s.isPaid ? s.paidAt ?? null : null,
        active(s._id, "payslip", isOD).length ? "oui" : "non", s.isPaid ? (active(s._id, "payslip", isTreasury).length ? "oui" : "non") : "—"]);
      const tot = (f: (s: typeof payslips[number]) => number | undefined) => sum(payslips.map(s => f(s) ?? 0));
      pay2.row(["Total", "", tot(s => s.grossTotal), tot(s => s.cnssEmployee), tot(s => s.cnssEmployer), tot(s => s.incomeTax), tot(s => s.otherDeductions), tot(s => s.netSalary), null, "", ""], B);
      pay2.done();
    }

    const tre = sheet("Trésorerie", `Comptes de trésorerie au ${atLabel}`, [{ h: "Compte", w: 30 }, { h: "Type", w: 13 }, { h: "Compte comptable", w: 15 }, { h: "Solde d'ouverture", w: 16, kind: "money" }, { h: "Solde des mouvements", w: 18, kind: "money" }, { h: "Solde comptable", w: 16, kind: "money" }, { h: "Écart", w: 14, kind: "money" }, { h: "Remarque", w: 44 }]);
    for (const t of treasuryRows) tre.row([t.label, TREASURY_TYPE(t.type), t.code, t.opening, t.treasury, t.shared ? null : t.ledger, t.gap, t.shared ? "Compte comptable commun : voir l'écart global dans « Contrôles »" : ""]);
    tre.done();

    const mv = sheet("Mouvements de trésorerie", "Mouvements de trésorerie de l'exercice", [{ h: "Date", w: 12, kind: "date" }, { h: "Compte", w: 26 }, { h: "Montant", w: 15, kind: "money" }, { h: "Libellé", w: 44 }, { h: "Référence", w: 18 }, { h: "Origine", w: 16 }, { h: "Pièce", w: 20 }, { h: "Annulé le", w: 12, kind: "date" }, { h: "Rapproché le", w: 12, kind: "date" }]);
    // Curseur : l'exercice peut compter des dizaines de milliers de mouvements.
    const cursor = TreasuryMovementModel.find({ tenantId: tid, date: inYear }).sort({ date: 1, _id: 1 }).select("date accountId amount label reference source linkedDocType cancelledAt reconciledAt")
      .lean<Array<{ date: Date; accountId: unknown; amount: number; label: string; reference?: string; source?: string; linkedDocType?: string; cancelledAt?: Date; reconciledAt?: Date }>>().cursor();
    for await (const m of cursor) mv.row([m.date, accLabel.get(String(m.accountId)) ?? "", m.amount, m.label, m.reference ?? "", MOVEMENT_SOURCE(m.source), ORIGIN(m.linkedDocType), m.cancelledAt ?? null, m.reconciledAt ?? null]);
    mv.done();

    const cpt = sheet("Comptoir", "Ventes des comptoirs par mois", [{ h: "Comptoir", w: 28 }, { h: "Mois", w: 12 }, { h: "Tickets", w: 10 }, { h: "TTC", w: 15, kind: "money" }, { h: "HT", w: 15, kind: "money" }, { h: "TVA", w: 13, kind: "money" }, { h: "Tickets hors comptabilité", w: 14 }, { h: "TTC hors comptabilité", w: 16, kind: "money" }]);
    for (const t of tickets) cpt.row([deskOf.get(String(t._id.desk))?.name ?? "Comptoir supprimé", MONTHS[t._id.month - 1], t.n, t.ttc, t.ht, t.tva, t.unposted, t.unpostedTTC]);
    cpt.done();

    const cli = sheet("Clients", "Comptes clients à ce jour", [{ h: "Client", w: 34 }, { h: "Code", w: 12 }, { h: "Solde 411/416", w: 16, kind: "money" }, { h: "Reste dû des factures", w: 18, kind: "money" }, { h: "Écart", w: 14, kind: "money" }, { h: "Retenue de garantie (4117)", w: 16, kind: "money" }, { h: "Avances reçues (419)", w: 16, kind: "money" }]);
    for (const c of clientRows.sort((x, y) => y.ar - x.ar)) cli.row([c.name, c.code, c.ar, c.due, c.gap, c.retention, c.advance]);
    cli.done();
    const fou = sheet("Fournisseurs", "Comptes fournisseurs à ce jour", [{ h: "Fournisseur", w: 40 }, { h: "Code", w: 12 }, { h: "Solde 40 (à payer)", w: 18, kind: "money" }, { h: "Reste à payer des achats", w: 18, kind: "money" }]);
    for (const s of supplierRows.sort((x, y) => y.balance - x.balance)) fou.row([s.name, s.code, s.balance, s.due]);
    fou.done();

    const imm = sheet("Immobilisations", "Registre des immobilisations", [{ h: "Code", w: 14 }, { h: "Désignation", w: 36 }, { h: "Catégorie", w: 14 }, { h: "Acquisition", w: 13, kind: "date" }, { h: "Coût", w: 16, kind: "money" }, { h: "Méthode", w: 14 }, { h: `Dotation ${year}`, w: 15, kind: "money" }, { h: `Amort. cumulés fin ${year}`, w: 17, kind: "money" }, { h: `VNC fin ${year}`, w: 15, kind: "money" }, { h: "Dotation passée", w: 12 }, { h: "Statut", w: 12 }]);
    for (const a of assets) {
      const y = (a.depreciationSchedule ?? []).find(s => s.year === year);
      imm.row([a.code ?? "", a.name ?? "", ASSET_CATEGORY(a.category), a.acquisitionDate ?? null, a.acquisitionCost ?? 0, ASSET_METHOD(a.depreciationMethod), y?.annuity ?? null, y?.cumulative ?? null, y?.netValue ?? a.currentNetValue ?? null, y ? (y.posted ? "oui" : "non") : "—",
        fr({ active: "en service", disposed: "cédée", fully_depreciated: "amortie" })(a.status)]);
    }
    imm.done();

    // Résultat par activité, rapproché du résultat comptable (la classe 8 n'est pas imputée).
    const ana = sheet("Par activité", "Résultat par secteur d'activité (comptes 6 et 7)", [{ h: "Secteur", w: 44 }, { h: "Produits", w: 16, kind: "money" }, { h: "Charges", w: 16, kind: "money" }, { h: "Résultat", w: 16, kind: "money" }]);
    const bySector = new Map<string, { p: number; c: number }>();
    for (const l of plLines) {
      const k = l.activityId ? activityOf.get(String(l.activityId)) ?? "(secteur supprimé)" : "Non imputé";
      const cur = bySector.get(k) ?? { p: 0, c: 0 };
      if (l.accountCode.startsWith("7")) cur.p += (l.credit || 0) - (l.debit || 0); else cur.c += (l.debit || 0) - (l.credit || 0);
      bySector.set(k, cur);
    }
    for (const [k, v] of [...bySector].sort((x, y) => (x[0] === "Non imputé" ? 1 : y[0] === "Non imputé" ? -1 : y[1].p - x[1].p))) ana.row([k, v.p, v.c, v.p - v.c]);
    const totP = sum([...bySector.values()].map(v => v.p)), totC = sum([...bySector.values()].map(v => v.c));
    ana.row(["Total des comptes 6 et 7", totP, totC, totP - totC], B);
    ana.row(["Résultat net SYSCOHADA (classes 6, 7 et 8)", null, null, is.resultat + is.unclassified], { italic: true });
    ana.done();

    const plan = sheet("Plan comptable", "Plan comptable de l'organisation", [{ h: "Compte", w: 11 }, { h: "Intitulé", w: 50 }, { h: "Classe", w: 8 }, { h: "Actif", w: 8 }, { h: "Écritures de l'exercice", w: 14 }]);
    for (const a of ledger) plan.row([a.code, a.label, a.accountClass ?? a.code[0], a.isActive === false ? "non" : "oui", usage.get(a.code) ?? 0]);
    plan.done();

    await wb.commit();
  }

  return { anomalies, counts, filename, write };
}
