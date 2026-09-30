import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { trialBalance } from "@/lib/accounting-reports";
import { isTenantAdmin } from "@/lib/roles-ui";
import { UserRole } from "@/types";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET — état du verrouillage et exercices clôturés. */
export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const t = await TenantModel.findById(auth.tenantId).select("accountingLockedUntil closedFiscalYears").lean<{ accountingLockedUntil?: Date; closedFiscalYears?: number[] } | null>();
  return ok({ lockedUntil: t?.accountingLockedUntil ?? null, closedYears: t?.closedFiscalYears ?? [] });
});

/**
 * POST
 *  - { action: "lock", until } : verrouille la saisie jusqu'à cette date (fin de
 *    mois déclaré, TVA déposée…). Reculer la date (déverrouiller) : gérant seulement.
 *  - { action: "close", year } : clôture de l'exercice — écriture d'à-nouveaux
 *    au 1er janvier suivant (comptes de bilan 1 à 5 et résultat en instance
 *    d'affectation 130), puis verrouillage au 31 décembre.
 */
export const POST = withAuth("accountingEntries", "delete", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const tenant = await TenantModel.findById(auth.tenantId);
  if (!tenant) return badRequest("Organisation introuvable.");
  const admin = isTenantAdmin(auth.role as UserRole) || (auth.roles ?? []).some(r => isTenantAdmin(r as UserRole));

  if (body.action === "lock") {
    const until = new Date(`${String(body.until ?? "")}T23:59:59`);
    if (isNaN(until.getTime())) return badRequest("Date de verrouillage invalide.");
    const current = tenant.accountingLockedUntil ? new Date(tenant.accountingLockedUntil) : null;
    if (current && until < current && !admin) return forbidden("Seul le gérant peut rouvrir une période verrouillée.");
    const lastClosed = Math.max(-Infinity, ...(tenant.closedFiscalYears ?? []));
    if (Number.isFinite(lastClosed) && until < new Date(lastClosed, 11, 31, 23, 59, 59)) return badRequest(`L'exercice ${lastClosed} est clôturé : il ne se rouvre pas.`);
    tenant.accountingLockedUntil = until;
    await tenant.save();
    await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { lockedUntil: until } });
    return ok({ lockedUntil: until });
  }

  if (body.action === "close") {
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year >= new Date().getFullYear() + 1) return badRequest("Exercice invalide.");
    if ((tenant.closedFiscalYears ?? []).includes(year)) return badRequest(`L'exercice ${year} est déjà clôturé.`);
    const prev = ((tenant.closedFiscalYears ?? []) as number[]).filter((y: number) => y < year);
    const hasEarlier = await AccountingEntryModel.exists({ tenantId: auth.tenantId, entryDate: { $lt: new Date(year, 0, 1) } });
    if (hasEarlier && !prev.includes(year - 1)) return badRequest(`Clôturez d'abord l'exercice ${year - 1}.`);

    const start = prev.includes(year - 1) ? new Date(year, 0, 1) : undefined;
    const bal = await trialBalance(auth.tenantId, start, new Date(year, 11, 31, 23, 59, 59));
    const lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number }> = [];
    let result = 0;
    for (const r of bal) {
      const s = r.debit - r.credit;
      if (/^[67]/.test(r.code)) { result -= s; continue; }
      if (!/^[1-5]/.test(r.code) || s === 0) continue;
      lines.push({ accountCode: r.code, accountLabel: r.label, debit: Math.max(0, s), credit: Math.max(0, -s) });
    }
    if (result !== 0) lines.push({ accountCode: "130000", accountLabel: `Résultat ${year} en instance d'affectation`, debit: Math.max(0, -result), credit: Math.max(0, result) });

    // Déverrouille provisoirement l'année suivante le temps de passer les à-nouveaux.
    await withTransaction(async session => {
      if (lines.length >= 2) {
        await AccountingEntryModel.create([{
          tenantId: new Types.ObjectId(auth.tenantId), journalCode: "AN", entryDate: new Date(year + 1, 0, 1),
          reference: `AN-${year + 1}`, label: `À-nouveaux ${year + 1} (clôture ${year})`, lines,
          linkedDocType: "closing", createdBy: auth.userId,
        }], { session });
      }
      tenant.closedFiscalYears = [...(tenant.closedFiscalYears ?? []), year];
      const endOfYear = new Date(year, 11, 31, 23, 59, 59);
      if (!tenant.accountingLockedUntil || new Date(tenant.accountingLockedUntil) < endOfYear) tenant.accountingLockedUntil = endOfYear;
      await tenant.save({ session });
    });
    await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { closedYear: year, result } });
    return ok({ year, result, openingLines: lines.length });
  }

  return badRequest("Action inconnue (lock ou close).");
});
