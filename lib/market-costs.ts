import { Types, type ClientSession } from "mongoose";
import { MarketCostTypeModel } from "@/models/MarketCostType";
import { ContractModel } from "@/models/Contract";
import { DevisModel } from "@/models/Devis";
import { PurchaseModel } from "@/models/Purchase";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";
import { invoiceDue } from "@/lib/payments";
import { DOUBTFUL_ACCOUNT } from "@/lib/doubtful";
import { nextDocumentNumber } from "@/lib/numbering";
import { buildPurchaseLines, checkSupplier, validatePurchase, payPurchase } from "@/lib/purchases";
import { createExecutionProject } from "@/lib/market-project";
import { registerLedgerAccount } from "@/lib/treasury";
import { defaultAccountLabel } from "@/lib/syscohada";
import { authCan } from "@/lib/role-resources";
import { adjustProvision } from "@/lib/doubtful-server";
import type { TokenPayload } from "@/lib/auth";

export interface CostType { _id: Types.ObjectId; key?: string; label: string; accountCode: string; accountLabel?: string; isActive: boolean }

/**
 * Types fournis d'office. Les comptes sont des propositions, à valider par le
 * comptable (modifiables). Les droits d'enregistrement n'y figurent pas : ils
 * ont leur panneau (constat, paiement, quittance) et seraient comptés deux fois.
 */
export const DEFAULT_COST_TYPES = [
  { key: "regulation", label: "Redevance de régulation et FSSP", accountCode: "648000", accountLabel: "Autres impôts et taxes" },
  { key: "bank", label: "Frais bancaires", accountCode: "631000", accountLabel: "Frais bancaires" },
  { key: "goods", label: "Achats de marchandises", accountCode: "601100", accountLabel: "Achats de marchandises" },
  { key: "materials", label: "Matières et fournitures", accountCode: "604000", accountLabel: "Achats stockés de matières et fournitures consommables" },
  { key: "delivery", label: "Livraison et transport", accountCode: "612000", accountLabel: "Transports sur ventes" },
  { key: "subcontract", label: "Installation et sous-traitance", accountCode: "621000", accountLabel: "Sous-traitance générale" },
  { key: "travel", label: "Déplacements et missions", accountCode: "638200", accountLabel: "Frais de réception et missions" },
  { key: "penalty", label: "Pénalités de retard", accountCode: "658000", accountLabel: "Charges diverses" },
  { key: "other", label: "Autres frais du marché", accountCode: "638000", accountLabel: "Autres charges externes" },
] as const;

/** Types qui portent un calcul : ils restent disponibles. */
const REQUIRED_KEYS = new Set(["regulation", "penalty"]);
export const labelKey = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").slice(0, 120);

/** Types de l'organisation ; ceux fournis d'office sont créés à la première lecture. */
export async function costTypes(tenantId: string): Promise<CostType[]> {
  const list = await MarketCostTypeModel.find({ tenantId }).sort({ createdAt: 1 }).lean<CostType[]>();
  const known = new Set(list.map(t => t.key));
  const missing = DEFAULT_COST_TYPES.filter(d => !known.has(d.key));
  if (!missing.length) return list;
  await MarketCostTypeModel.bulkWrite(missing.map(d => ({
    updateOne: { filter: { tenantId: new Types.ObjectId(tenantId), key: d.key }, update: { $setOnInsert: { ...d, labelKey: labelKey(d.label), isActive: true } }, upsert: true },
  })), { ordered: false }).catch((e: { code?: number }) => { if (e.code !== 11000) throw e; });
  return MarketCostTypeModel.find({ tenantId }).sort({ createdAt: 1 }).lean<CostType[]>();
}

function checkAccount(accountCode: unknown): string {
  const code = String(accountCode ?? "").trim();
  if (!/^6\d{2,7}$/.test(code)) throw new BusinessRuleError("Compte de charge attendu (classe 6, par exemple 638000).");
  if (code.startsWith("646")) throw new BusinessRuleError("Les droits d'enregistrement et timbres se constatent dans le panneau Enregistrement du marché : ici, ils seraient comptés deux fois.");
  return code;
}

async function assertFreeLabel(tenantId: string, label: string, except?: unknown, session?: ClientSession) {
  const taken = await MarketCostTypeModel.exists({ tenantId, labelKey: labelKey(label), ...(except ? { _id: { $ne: except } } : {}) }).session(session ?? null);
  if (taken) throw new BusinessRuleError(`Le type « ${label} » existe déjà.`);
}

export async function createCostType(auth: TokenPayload, input: { label?: unknown; accountCode?: unknown; accountLabel?: unknown }, session?: ClientSession) {
  const label = String(input.label ?? "").trim().slice(0, 120);
  if (!label) throw new BusinessRuleError("Nom du type de dépense obligatoire.");
  const accountCode = checkAccount(input.accountCode);
  await assertFreeLabel(auth.tenantId, label, undefined, session);
  const accountLabel = String(input.accountLabel ?? "").trim().slice(0, 120) || defaultAccountLabel(accountCode) || label;
  const [t] = await MarketCostTypeModel.create([{ tenantId: auth.tenantId, label, labelKey: labelKey(label), accountCode, accountLabel, createdBy: auth.userId }], { session });
  return t as unknown as CostType & { toObject: () => unknown };
}

/** Modification d'un type : vaut pour les prochaines dépenses, jamais pour celles déjà comptabilisées. */
export async function updateCostType(auth: TokenPayload, id: string, input: { label?: unknown; accountCode?: unknown; accountLabel?: unknown; isActive?: unknown }) {
  const t = await MarketCostTypeModel.findOne({ _id: id, tenantId: auth.tenantId });
  if (!t) throw new BusinessRuleError("Type de dépense introuvable.");
  if (input.label !== undefined) {
    const label = String(input.label).trim().slice(0, 120);
    if (!label) throw new BusinessRuleError("Nom du type de dépense obligatoire.");
    await assertFreeLabel(auth.tenantId, label, t._id);
    t.label = label; t.labelKey = labelKey(label);
  }
  if (input.accountCode !== undefined) {
    t.accountCode = checkAccount(input.accountCode);
    t.accountLabel = String(input.accountLabel ?? "").trim().slice(0, 120) || defaultAccountLabel(t.accountCode) || t.label;
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") throw new BusinessRuleError("Valeur d'activation invalide.");
    if (input.isActive === false && REQUIRED_KEYS.has(t.key ?? "")) throw new BusinessRuleError("Ce type porte un calcul du marché : il ne se désactive pas (mettez le taux du marché à 0 si la redevance ne s'applique pas).");
    t.isActive = input.isActive;
  }
  await t.save();
  return t;
}

export interface MarketCostInput {
  costTypeId?: unknown;
  /** Type créé à la volée, si `costTypeId` est absent. */
  newType?: { label?: unknown; accountCode?: unknown; accountLabel?: unknown };
  amountHT?: unknown; tvaRate?: unknown; date?: unknown; dueDate?: unknown;
  supplierId?: unknown; payee?: unknown; supplierRef?: unknown; description?: unknown;
  /** paid : payé ; due : à payer ; planned : prévu (brouillon, compté en engagé) ; withheld : pénalité retenue par le client sur `invoiceId`. */
  state?: unknown; treasuryAccountId?: unknown; invoiceId?: unknown;
}

/**
 * Pénalité retenue par le client sur sa facture : aucune sortie d'argent. La
 * charge, imputée au projet, solde la créance à hauteur de la retenue ; le
 * règlement porté par la facture s'annule comme tout encaissement.
 */
async function withholdPenalty(auth: TokenPayload, contract: { _id: unknown; invoiceIds?: unknown[]; projectId?: unknown; reference?: string }, type: CostType, input: MarketCostInput, date: Date, session?: ClientSession) {
  if (type.key !== "penalty") throw new BusinessRuleError("Seule une pénalité se retient sur une facture.");
  if (!Types.ObjectId.isValid(String(input.invoiceId))) throw new BusinessRuleError("Choisissez la facture sur laquelle le client a retenu la pénalité.");
  const invoice = await InvoiceModel.findOne({ tenantId: auth.tenantId, documentType: "invoice", $and: [{ _id: input.invoiceId }, { $or: [{ contractId: contract._id }, { _id: { $in: contract.invoiceIds ?? [] } }] }] }).session(session ?? null);
  if (!invoice) throw new BusinessRuleError("Facture introuvable sur ce marché.");
  if (!["sent", "partial", "overdue"].includes(invoice.status)) throw new BusinessRuleError("La facture doit être émise et non soldée.");
  const amount = Math.round(Number(input.amountHT));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  const due = invoiceDue(invoice);
  if (date.getTime() > Date.now() + 86_400_000) throw new BusinessRuleError("Une retenue ne se date pas dans le futur.");
  if (amount > due) throw new BusinessRuleError(`La retenue dépasse le reste à payer de la facture (${due.toLocaleString("fr-FR")} FCFA).`);
  const [payment] = await PaymentModel.create([{
    tenantId: auth.tenantId, invoiceId: invoice._id, amount: 0, penaltyAmount: amount, method: "other", date, status: "effective",
    reference: input.supplierRef ? String(input.supplierRef).slice(0, 80) : `Pénalité ${contract.reference ?? ""}`.trim(), createdBy: auth.userId,
  }], { session });
  invoice.paidAmount += amount;
  invoice.status = invoiceDue(invoice) <= 1 ? "paid" : "partial";
  await invoice.save({ session });
  await registerLedgerAccount(auth.tenantId, type.accountCode, type.accountLabel || type.label, session);
  const client = invoice.doubtfulAt ? DOUBTFUL_ACCOUNT : { accountCode: "411000", accountLabel: "Clients" };
  await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: `PEN-${String(payment._id).slice(-6).toUpperCase()}`,
    label: `Pénalité retenue sur la facture ${invoice.number}`,
    lines: [
      { accountCode: type.accountCode, accountLabel: type.accountLabel || type.label, debit: amount, credit: 0, projectId: contract.projectId },
      { ...client, debit: 0, credit: amount, thirdPartyId: invoice.clientId },
    ],
    linkedDocType: "payment", linkedDocId: payment._id, createdBy: auth.userId,
  }], { session });
  // Créance douteuse en partie soldée : sa dépréciation suit le reste dû, comme pour un règlement.
  if (invoice.doubtfulAt) await adjustProvision({ tenantId: auth.tenantId, userId: auth.userId }, invoice, invoice.provisionRate ?? 0, date, session);
  return { _id: payment._id, number: invoice.number as string, totalTTC: amount, status: "withheld" };
}

/**
 * Dépense d'un marché : un achat imputé au projet d'exécution, porté par son
 * type. Le projet est créé s'il manque. Tout est fait d'un bloc : type nouveau,
 * projet, écriture et règlement réussissent ou échouent ensemble.
 */
export async function recordMarketCost(auth: TokenPayload, contractId: string, input: MarketCostInput, session?: ClientSession) {
  const contract = await ContractModel.findOne({ _id: contractId, tenantId: auth.tenantId }).session(session ?? null);
  if (!contract) throw new BusinessRuleError("Marché introuvable.");
  if (contract.type !== "client") throw new BusinessRuleError("Seul un marché client porte ces dépenses.");
  if (contract.status === "cancelled") throw new BusinessRuleError("Ce marché est annulé.");

  if (input.state !== undefined && !["paid", "due", "planned", "withheld"].includes(String(input.state))) throw new BusinessRuleError("État de la dépense inconnu.");
  const state = input.state ?? "due";
  if (typeof input.amountHT !== "number" && typeof input.amountHT !== "string") throw new BusinessRuleError("Montant invalide.");
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  const dueDate = input.dueDate ? new Date(String(input.dueDate)) : undefined;
  if (dueDate && isNaN(dueDate.getTime())) throw new BusinessRuleError("Date d'échéance invalide.");
  if (state === "paid" && !input.treasuryAccountId) throw new BusinessRuleError("Choisissez le compte qui a payé.");

  let type: CostType | null;
  if (input.costTypeId) {
    if (!Types.ObjectId.isValid(String(input.costTypeId))) throw new BusinessRuleError("Type de dépense invalide.");
    type = await MarketCostTypeModel.findOne({ _id: input.costTypeId, tenantId: auth.tenantId, isActive: true }).session(session ?? null).lean<CostType | null>();
    if (!type) throw new BusinessRuleError("Type de dépense introuvable ou désactivé.");
  } else if (input.newType) {
    type = await createCostType(auth, input.newType, session);
  } else throw new BusinessRuleError("Choisissez le type de dépense.");

  if (!contract.projectId) {
    if (!authCan(auth, "projects", "create")) throw new BusinessRuleError("Ce marché n'a pas encore de projet d'exécution : demandez à la direction de le créer.");
    const project = await createExecutionProject(auth.tenantId, contract, auth.userId, session);
    contract.projectId = project._id;
    await contract.save({ session });
    if (contract.devisId) await DevisModel.updateOne({ _id: contract.devisId, tenantId: auth.tenantId }, { $set: { projectId: project._id } }, { session });
  }

  if (state === "withheld") return { purchase: await withholdPenalty(auth, contract, type, input, date, session), type };

  const supplier = await checkSupplier(auth.tenantId, input.supplierId);
  const payee = supplier ? supplier.name : String(input.payee ?? "").trim().slice(0, 160) || type.label;
  const description = String(input.description ?? "").trim().slice(0, 300) || `${type.label} — ${contract.reference}`;
  const built = await buildPurchaseLines(auth.tenantId, [{ description, accountCode: type.accountCode, accountLabel: type.accountLabel, amountHT: input.amountHT, tvaRate: input.tvaRate }]);
  await registerLedgerAccount(auth.tenantId, type.accountCode, type.accountLabel || type.label, session);

  const number = await nextDocumentNumber(auth.tenantId, "purchase", { issueDate: date, session });
  const [p] = await PurchaseModel.create([{
    tenantId: auth.tenantId, number, kind: state === "paid" ? "cash" : "invoice",
    supplierId: supplier?._id, payee,
    supplierRef: input.supplierRef ? String(input.supplierRef).slice(0, 80) : undefined,
    date, dueDate: dueDate ?? (state === "paid" ? date : undefined),
    // Imputation posée ici : le projet est celui du marché, et il peut venir d'être créé dans cette transaction.
    lines: built.lines.map(l => ({ ...l, projectId: contract.projectId, costTypeId: type!._id })), totalHT: built.totalHT, totalTVA: built.totalTVA, totalTTC: built.totalTTC,
    status: "draft", createdBy: auth.userId,
  }], { session });
  if (state !== "planned") await validatePurchase(auth, p, session);
  if (state === "paid") await payPurchase(auth, p, { treasuryAccountId: input.treasuryAccountId, date }, session);
  return { purchase: p as { _id: unknown; number: string; totalTTC: number; status: string }, type };
}
