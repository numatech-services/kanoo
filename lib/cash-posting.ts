import type { ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { treasuryLedger } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { VAT_ACCOUNT } from "@/lib/purchases";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Encaissements et décaissements « au comptant » des modules (comptoirs,
 * billetterie, cotisations, dons) — un seul chemin vers la comptabilité.
 *
 * Ces recettes vivaient hors de la comptabilité et de la trésorerie : le
 * chiffre d'affaires du comptoir n'apparaissait ni au compte de résultat ni
 * dans le solde de la caisse. Chaque flux produit ici, dans la transaction de
 * son document, un mouvement de trésorerie et l'écriture miroir :
 *   recette : 5… (compte encaisseur) au débit / produit HT + TVA collectée au crédit
 *   dépense : charge HT + TVA récupérable au débit / 5… au crédit
 */

export const COLLECTED_VAT = { accountCode: "443000", accountLabel: "TVA collectée" };

export interface CashFlowInput {
  tenantId: string;
  userId: string;
  treasuryAccountId: unknown;
  direction: "in" | "out";
  /** Montant TTC encaissé ou payé. */
  amount: number;
  date: Date;
  label: string;
  reference: string;
  /** Produit (recette) ou charge (dépense). */
  account: { accountCode: string; accountLabel: string };
  /** Taux de TVA compris dans le montant (0 = sans TVA). */
  vatRate?: number;
  /** Imputation analytique. */
  activityId?: unknown;
  projectId?: unknown;
  thirdPartyId?: unknown;
  linkedDocType: string;
  linkedDocId: unknown;
}

export async function postCashFlow(input: CashFlowInput, session?: ClientSession) {
  const amount = Math.round(input.amount);
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  const ledger = await treasuryLedger(input.tenantId, input.treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  const rate = input.vatRate && input.vatRate > 0 ? input.vatRate : 0;
  const ht = rate ? Math.round(amount / (1 + rate)) : amount;
  const vat = amount - ht;
  const tags = { ...(input.activityId ? { activityId: input.activityId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}) };
  const third = input.thirdPartyId ? { thirdPartyId: input.thirdPartyId } : {};
  const cash = { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel };

  const lines = input.direction === "in" ? [
    { ...cash, debit: amount, credit: 0 },
    { ...input.account, debit: 0, credit: ht, ...tags, ...third },
    ...(vat > 0 ? [{ ...COLLECTED_VAT, debit: 0, credit: vat }] : []),
  ] : [
    { ...input.account, debit: ht, credit: 0, ...tags, ...third },
    ...(vat > 0 ? [{ accountCode: VAT_ACCOUNT.accountCode, accountLabel: VAT_ACCOUNT.accountLabel, debit: vat, credit: 0 }] : []),
    { ...cash, debit: 0, credit: amount },
  ];

  const [entry] = await AccountingEntryModel.create([{
    tenantId: input.tenantId, journalCode: ledger.journalCode, entryDate: input.date,
    reference: input.reference.slice(0, 80), label: input.label.slice(0, 300), lines,
    linkedDocType: input.linkedDocType, linkedDocId: input.linkedDocId, createdBy: input.userId,
  }], { session });
  const [movement] = await TreasuryMovementModel.create([{
    tenantId: input.tenantId, accountId: input.treasuryAccountId, date: input.date,
    amount: input.direction === "in" ? amount : -amount, label: input.label.slice(0, 200),
    reference: input.reference.slice(0, 80), source: input.direction === "in" ? "payment" : "expense",
    linkedDocType: input.linkedDocType, linkedDocId: input.linkedDocId, createdBy: input.userId,
  }], { session });
  return { entryId: entry._id, movementId: movement._id };
}

/** Annulation d'un flux : écriture extournée et mouvement contraire (jamais d'effacement). */
export async function reverseCashFlow(
  opts: { tenantId: string; userId: string; entryId?: unknown; movementId?: unknown; reason: string; source?: "manual" | "transfer" },
  session?: ClientSession,
) {
  if (opts.entryId) await reverseEntry({ tenantId: opts.tenantId, userId: opts.userId, entryId: opts.entryId, reason: opts.reason }, session);
  if (opts.movementId) {
    const m = await TreasuryMovementModel.findOne({ _id: opts.movementId, tenantId: opts.tenantId }).session(session ?? null)
      .lean<{ accountId: unknown; amount: number; label: string; reference?: string; linkedDocType?: string; linkedDocId?: unknown } | null>();
    if (m) {
      await TreasuryMovementModel.create([{
        tenantId: opts.tenantId, accountId: m.accountId, date: new Date(), amount: -m.amount,
        label: `Annulation — ${m.label}`.slice(0, 200), reference: m.reference, source: opts.source ?? "manual",
        linkedDocType: m.linkedDocType, linkedDocId: m.linkedDocId, createdBy: opts.userId,
      }], { session });
    }
  }
}
