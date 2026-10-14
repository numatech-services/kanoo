import { Types, type ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { unknownAccounts } from "@/lib/ledger";
import { assignLedgerCode, treasuryLedger } from "@/lib/treasury";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Reprise des soldes d'ouverture — le bilan de départ d'une organisation qui
 * arrive sur Kanoo (journal AN), en une écriture équilibrée.
 *
 * Banque, caisse et mobile money se saisissent par compte de trésorerie et non
 * par numéro de compte : l'écriture porte le compte dédié (5211xx…) et le solde
 * d'ouverture du compte de trésorerie prend la même valeur, si bien que
 * comptabilité et trésorerie partent du même chiffre. Clients et fournisseurs
 * peuvent être repris tiers par tiers (411/401), pour pouvoir lettrer ensuite.
 */

export const OPENING_REFERENCE = "REPRISE-OUVERTURE";

export interface OpeningInput {
  date: unknown;
  lines?: Array<{ accountCode?: unknown; accountLabel?: unknown; debit?: unknown; credit?: unknown; thirdPartyId?: unknown }>;
  treasury?: Array<{ accountId?: unknown; amount?: unknown }>;
}

export async function currentOpening(tenantId: string) {
  return AccountingEntryModel.findOne({ tenantId, reference: OPENING_REFERENCE, reversedBy: { $exists: false }, reverses: { $exists: false } })
    .lean<{ _id: unknown; entryDate: Date; lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number }> } | null>();
}

export async function postOpeningBalances(actor: { tenantId: string; userId: string }, input: OpeningInput, session?: ClientSession) {
  const date = new Date(String(input.date ?? ""));
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date d'ouverture invalide.");
  if (await currentOpening(actor.tenantId)) {
    throw new BusinessRuleError("Les soldes d'ouverture sont déjà repris : extournez l'écriture de reprise (Comptabilité) pour la refaire.");
  }
  const tid = new Types.ObjectId(actor.tenantId);
  const lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number; thirdPartyId?: unknown }> = [];

  for (const [i, t] of (input.treasury ?? []).entries()) {
    const amount = Math.round(Number(t.amount) || 0);
    if (!amount) continue;
    if (!Types.ObjectId.isValid(String(t.accountId))) throw new BusinessRuleError(`Trésorerie, ligne ${i + 1} : compte invalide.`);
    const acc = await TreasuryAccountModel.findOne({ _id: t.accountId, tenantId: tid }).session(session ?? null);
    if (!acc) throw new BusinessRuleError(`Trésorerie, ligne ${i + 1} : compte introuvable.`);
    if (!acc.ledgerCode) await assignLedgerCode(actor, acc._id, session);
    const ledger = await treasuryLedger(actor.tenantId, acc._id, session);
    lines.push({ accountCode: ledger!.accountCode, accountLabel: ledger!.accountLabel, debit: Math.max(0, amount), credit: Math.max(0, -amount) });
    // Même point de départ pour la trésorerie que pour la comptabilité.
    await TreasuryAccountModel.updateOne({ _id: acc._id }, { $set: { openingBalance: amount, openingDate: date } }, { session });
  }

  for (const [i, l] of (input.lines ?? []).entries()) {
    const debit = Math.round(Number(l.debit) || 0), credit = Math.round(Number(l.credit) || 0);
    if (!debit && !credit) continue;
    const code = String(l.accountCode ?? "").trim();
    if (!/^[1-9]\d{2,7}$/.test(code)) throw new BusinessRuleError(`Ligne ${i + 1} : numéro de compte invalide.`);
    if (/^[67]/.test(code)) throw new BusinessRuleError(`Ligne ${i + 1} : un bilan d'ouverture ne reprend que des comptes de bilan (classes 1 à 5).`);
    if (/^5[27]/.test(code)) throw new BusinessRuleError(`Ligne ${i + 1} : banque et caisse se reprennent dans la partie « Trésorerie », par compte.`);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw new BusinessRuleError(`Ligne ${i + 1} : un montant au débit OU au crédit.`);
    let thirdPartyId: unknown;
    if (l.thirdPartyId) {
      if (!Types.ObjectId.isValid(String(l.thirdPartyId))) throw new BusinessRuleError(`Ligne ${i + 1} : tiers invalide.`);
      const model = /^41/.test(code) ? ClientModel : /^40/.test(code) ? SupplierModel : null;
      if (!model || !(await model.exists({ _id: l.thirdPartyId, tenantId: tid }))) throw new BusinessRuleError(`Ligne ${i + 1} : tiers introuvable pour ce compte.`);
      thirdPartyId = l.thirdPartyId;
    }
    lines.push({ accountCode: code, accountLabel: String(l.accountLabel ?? "").trim().slice(0, 160) || code, debit, credit, ...(thirdPartyId ? { thirdPartyId } : {}) });
  }

  if (lines.length < 2) throw new BusinessRuleError("Saisissez au moins deux soldes (dont la contrepartie en capitaux ou report à nouveau).");
  const debit = lines.reduce((t, l) => t + l.debit, 0), credit = lines.reduce((t, l) => t + l.credit, 0);
  if (debit !== credit) throw new BusinessRuleError(`Bilan d'ouverture déséquilibré : actif ${debit.toLocaleString("fr-FR")} ≠ passif ${credit.toLocaleString("fr-FR")} (écart ${(debit - credit).toLocaleString("fr-FR")} FCFA).`);
  const unknown = await unknownAccounts(actor.tenantId, lines.map(l => l.accountCode).filter(c => !/^5[27]/.test(c)));
  if (unknown.length) throw new BusinessRuleError(`Compte(s) absent(s) du plan comptable : ${unknown.join(", ")}. Ajoutez-les dans « Plan comptable ».`);

  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: "AN", entryDate: date, reference: OPENING_REFERENCE,
    label: `Reprise des soldes d'ouverture au ${date.toLocaleDateString("fr-FR")}`,
    lines, linkedDocType: "closing", createdBy: actor.userId,
  }], { session });
  return { entryId: entry._id, total: debit, lines: lines.length };
}

/** Après extourne de la reprise : les comptes de trésorerie qu'elle portait repartent de zéro. */
export async function resetTreasuryOpening(tenantId: string, entryId: string, session?: ClientSession) {
  const entry = await AccountingEntryModel.findById(entryId).session(session ?? null).select("lines").lean<{ lines: Array<{ accountCode: string }> } | null>();
  const codes = (entry?.lines ?? []).map(l => l.accountCode).filter(c => /^5[27]/.test(c));
  if (!codes.length) return;
  await TreasuryAccountModel.updateMany({ tenantId, ledgerCode: { $in: codes } }, { $set: { openingBalance: 0 } }, { session });
}
