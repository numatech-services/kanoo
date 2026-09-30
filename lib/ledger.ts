import { LedgerAccountModel } from "@/models/LedgerAccount";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { SYSCOHADA_ACCOUNTS } from "@/lib/syscohada";

/**
 * Plan comptable de l'organisation. À la première lecture, il est initialisé
 * avec les comptes SYSCOHADA usuels ET les comptes déjà présents dans les
 * écritures (reprise) : aucune écriture existante ne référence un compte absent.
 */
export async function ensureLedger(tenantId: string) {
  const count = await LedgerAccountModel.countDocuments({ tenantId });
  if (count > 0) return;
  const used = await AccountingEntryModel.aggregate<{ _id: string; label: string }>([
    { $match: { tenantId: new (await import("mongoose")).Types.ObjectId(tenantId) } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.accountCode", label: { $first: "$lines.accountLabel" } } },
  ]);
  const map = new Map<string, string>();
  for (const a of SYSCOHADA_ACCOUNTS) map.set(a.code, a.label);
  for (const u of used) if (u._id && /^[1-9]\d{2,7}$/.test(u._id) && !map.has(u._id)) map.set(u._id, u.label || u._id);
  const docs = [...map.entries()].map(([code, label]) => ({ tenantId, code, label, accountClass: code[0] }));
  try { await LedgerAccountModel.insertMany(docs, { ordered: false }); } catch { /* course de deux premières lectures : l'index unique tranche */ }
}

/** Comptes inconnus ou inactifs parmi une liste de codes (saisie manuelle). */
export async function unknownAccounts(tenantId: string, codes: string[]): Promise<string[]> {
  await ensureLedger(tenantId);
  const uniq = [...new Set(codes)];
  const found = await LedgerAccountModel.find({ tenantId, code: { $in: uniq }, isActive: true }).select("code").lean<Array<{ code: string }>>();
  const ok = new Set(found.map(f => f.code));
  return uniq.filter(c => !ok.has(c));
}
