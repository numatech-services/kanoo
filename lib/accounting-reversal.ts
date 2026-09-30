import type { ClientSession } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";

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
  if (!entry) return null;
  if (entry.reversedBy) throw new Error(`L'écriture ${entry.reference} est déjà extournée.`);
  if (entry.reverses) throw new Error("Une extourne ne s'extourne pas : ressaisissez l'écriture d'origine.");

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
  return mirror;
}
