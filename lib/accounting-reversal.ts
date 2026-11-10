import type { ClientSession } from "mongoose";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { refuseIfRestarted } from "@/lib/accounting-restart";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";

type Line = { accountCode: string; accountLabel: string; debit: number; credit: number; thirdPartyId?: unknown; projectId?: unknown; activityId?: unknown; costCenter?: string };

/**
 * Extourne : on n'efface jamais une écriture comptable, on la contre-passe.
 * L'écriture miroir (journal EX) inverse débits et crédits, garde l'imputation
 * analytique, et les deux se référencent l'une l'autre. Une écriture déjà
 * extournée ne l'est pas deux fois.
 */
export async function reverseEntry(
  opts: { tenantId: string; userId: string; entryId: unknown; reason: string; date?: Date },
  session?: ClientSession,
) {
  const entry = await AccountingEntryModel.findOne({ _id: opts.entryId, tenantId: opts.tenantId }).session(session ?? null);
  if (!entry) {
    // Écriture effacée par la reprise de la comptabilité : refus explicite, pas d'annulation muette.
    if (opts.entryId) await refuseIfRestarted(opts.tenantId, session);
    return null;
  }
  if (entry.reversedBy) throw new BusinessRuleError(`L'écriture ${entry.reference} est déjà extournée.`);
  if (entry.reverses) throw new BusinessRuleError("Une extourne ne s'extourne pas : ressaisissez l'écriture d'origine.");

  const lines = (entry.lines as Line[]).map(l => ({
    accountCode: l.accountCode, accountLabel: l.accountLabel,
    debit: l.credit, credit: l.debit,
    ...(l.thirdPartyId ? { thirdPartyId: l.thirdPartyId } : {}),
    ...(l.projectId ? { projectId: l.projectId } : {}),
    ...(l.activityId ? { activityId: l.activityId } : {}),
    ...(l.costCenter ? { costCenter: l.costCenter } : {}),
  }));
  const [mirror] = await AccountingEntryModel.create([{
    tenantId: opts.tenantId, journalCode: "EX", entryDate: opts.date ?? new Date(),
    reference: `EXT-${entry.reference}`.slice(0, 80),
    label: `Extourne — ${entry.label}${opts.reason ? ` (${opts.reason})` : ""}`.slice(0, 300),
    lines, linkedDocType: "reversal", linkedDocId: entry._id, reverses: entry._id, createdBy: opts.userId,
  }], { session });
  entry.reversedBy = mirror._id;
  await entry.save({ session });
  // Saisie manuelle sur banque ou caisse : son mouvement de trésorerie est contre-passé avec elle.
  if (entry.linkedDocType === "manual") {
    const moves = await TreasuryMovementModel.find({ tenantId: opts.tenantId, entryId: entry._id, linkedDocId: entry._id, cancelledAt: { $exists: false } }).session(session ?? null)
      .lean<Array<{ _id: unknown; accountId: unknown; amount: number; label: string; reference?: string }>>();
    for (const m of moves) {
      await TreasuryMovementModel.create([{
        tenantId: opts.tenantId, accountId: m.accountId, date: opts.date ?? new Date(), amount: -m.amount,
        label: `Extourne — ${m.label}`.slice(0, 200), reference: m.reference, source: "manual",
        linkedDocType: "manual", linkedDocId: mirror._id, entryId: mirror._id, reversalOf: m._id, createdBy: opts.userId,
      }], { session });
      await TreasuryMovementModel.updateOne({ _id: m._id }, { $set: { cancelledAt: new Date(), cancelledBy: opts.userId } }, { session });
    }
  }
  return mirror;
}
