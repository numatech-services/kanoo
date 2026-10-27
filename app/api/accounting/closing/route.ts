import { NextRequest, NextResponse } from "next/server";
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
import { registerLedgerAccount } from "@/lib/treasury";
import { closingChecks, thirdPartyBalances, THIRD_PARTY_ACCOUNT, RESULT_ACCOUNT, ALLOCATION_ACCOUNTS } from "@/lib/closing";

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

  if (body.action === "check") {
    const year = Number(body.year);
    if (!Number.isInteger(year)) return badRequest("Exercice invalide.");
    return ok({ year, checks: await closingChecks(auth.tenantId, year) });
  }

  if (body.action === "close") {
    const year = Number(body.year);
    // L'exercice EN COURS ne se clôture pas : ses à-nouveaux seraient partiels
    // et la saisie verrouillée jusqu'au 31 décembre.
    if (!Number.isInteger(year) || year < 2000 || year >= new Date().getFullYear()) return badRequest("Seul un exercice terminé se clôture.");
    if ((tenant.closedFiscalYears ?? []).includes(year)) return badRequest(`L'exercice ${year} est déjà clôturé.`);
    const prev = ((tenant.closedFiscalYears ?? []) as number[]).filter((y: number) => y < year);
    const hasEarlier = await AccountingEntryModel.exists({ tenantId: auth.tenantId, entryDate: { $lt: new Date(year, 0, 1) } });
    if (hasEarlier && !prev.includes(year - 1)) return badRequest(`Clôturez d'abord l'exercice ${year - 1}.`);

    // Contrôles avant clôture : les points bloquants arrêtent tout ; les
    // avertissements demandent une confirmation explicite.
    const checks = await closingChecks(auth.tenantId, year);
    if (checks.some(c => c.level === "block") || (checks.length && body.acknowledgeWarnings !== true)) {
      return NextResponse.json({ success: false, error: "Points à traiter avant la clôture.", checks }, { status: 409 });
    }

    const start = prev.includes(year - 1) ? new Date(year, 0, 1) : undefined;
    const end = new Date(year, 11, 31, 23, 59, 59);
    const bal = await trialBalance(auth.tenantId, start, end);
    // Comptes de tiers (40, 41, 42…) : à-nouveaux ventilés PAR TIERS. Agrégés
    // par compte, le 411 global restait ouvert au lettrage à côté des factures
    // de l'exercice précédent, et l'antériorité par client était perdue.
    const byThird = await thirdPartyBalances(auth.tenantId, start, end);
    const lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number; thirdPartyId?: unknown }> = [];
    let result = 0;
    for (const r of bal) {
      const s = r.debit - r.credit;
      if (/^[678]/.test(r.code)) { result -= s; continue; }
      if (!/^[1-5]/.test(r.code) || s === 0) continue;
      const split = THIRD_PARTY_ACCOUNT.test(r.code) ? byThird.filter(t => t.code === r.code) : [];
      if (split.length) {
        for (const t of split) {
          const ts = t.debit - t.credit;
          if (ts !== 0) lines.push({ accountCode: r.code, accountLabel: r.label, debit: Math.max(0, ts), credit: Math.max(0, -ts), ...(t.thirdPartyId ? { thirdPartyId: t.thirdPartyId } : {}) });
        }
      } else {
        lines.push({ accountCode: r.code, accountLabel: r.label, debit: Math.max(0, s), credit: Math.max(0, -s) });
      }
    }
    if (result !== 0) lines.push({ accountCode: RESULT_ACCOUNT, accountLabel: `Résultat ${year} en instance d'affectation`, debit: Math.max(0, -result), credit: Math.max(0, result) });

    await withTransaction(async session => {
      await registerLedgerAccount(auth.tenantId, RESULT_ACCOUNT, "Résultat en instance d'affectation", session);
      if (lines.length >= 2) {
        // Les à-nouveaux sont datés du 1er janvier, souvent déjà verrouillé
        // (TVA de janvier déposée) : la clôture était alors impossible. Cette
        // écriture, et elle seule, passe outre le verrou.
        const an = new AccountingEntryModel({
          tenantId: new Types.ObjectId(auth.tenantId), journalCode: "AN", entryDate: new Date(year + 1, 0, 1),
          reference: `AN-${year + 1}`, label: `À-nouveaux ${year + 1} (clôture ${year})`, lines,
          linkedDocType: "closing", createdBy: auth.userId,
        });
        an.$locals.bypassPeriodLock = true;
        await an.save({ session });
      }
      tenant.closedFiscalYears = [...(tenant.closedFiscalYears ?? []), year];
      if (!tenant.accountingLockedUntil || new Date(tenant.accountingLockedUntil) < end) tenant.accountingLockedUntil = end;
      await tenant.save({ session });
    });
    await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { closedYear: year, result, acknowledged: checks.map(c => c.message) } });
    return ok({ year, result, openingLines: lines.length });
  }

  if (body.action === "allocate") {
    // Affectation du résultat (décision de l'assemblée) : le 130 est soldé vers
    // les réserves, le report à nouveau ou les dividendes. Sans elle, le 130 se
    // cumulait d'un exercice à l'autre.
    const year = Number(body.year);
    if (!(tenant.closedFiscalYears ?? []).includes(year)) return badRequest(`Clôturez d'abord l'exercice ${year}.`);
    const date = body.date ? new Date(String(body.date)) : new Date();
    if (isNaN(date.getTime())) return badRequest("Date de décision invalide.");
    const allocations = (Array.isArray(body.allocations) ? body.allocations : []) as Array<{ accountCode?: string; amount?: number }>;
    const clean = allocations.map(a => ({ code: String(a.accountCode ?? ""), amount: Math.round(Number(a.amount) || 0) })).filter(a => a.amount !== 0);
    if (!clean.length) return badRequest("Indiquez la répartition du résultat.");
    if (clean.some(a => !ALLOCATION_ACCOUNTS[a.code])) return badRequest(`Comptes d'affectation admis : ${Object.keys(ALLOCATION_ACCOUNTS).join(", ")}.`);
    const [b] = await AccountingEntryModel.aggregate<{ debit: number; credit: number }>([
      { $match: { tenantId: new Types.ObjectId(auth.tenantId) } }, { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $regex: "^13" } } },
      { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    ]);
    const toAllocate = Math.round((b?.credit ?? 0) - (b?.debit ?? 0)); // > 0 bénéfice, < 0 perte
    if (toAllocate === 0) return badRequest("Aucun résultat en instance d'affectation.");
    const total = clean.reduce((t, a) => t + a.amount, 0);
    if (total !== Math.abs(toAllocate)) return badRequest(`La répartition (${total.toLocaleString("fr-FR")}) doit égaler le résultat à affecter (${Math.abs(toAllocate).toLocaleString("fr-FR")}).`);
    const profit = toAllocate > 0;
    // Une perte se reporte au débit (129), un bénéfice au crédit (121).
    if (!profit) for (const a of clean) if (a.code === "121000") a.code = "129000";
    if (!profit && clean.some(a => ["111000", "112000", "118000", "465000"].includes(a.code))) return badRequest("Une perte ne s'affecte ni en réserves ni en dividendes : reportez-la à nouveau.");
    const lines = [
      { accountCode: RESULT_ACCOUNT, accountLabel: "Résultat en instance d'affectation", debit: profit ? total : 0, credit: profit ? 0 : total },
      ...clean.map(a => ({ accountCode: a.code, accountLabel: ALLOCATION_ACCOUNTS[a.code], debit: profit ? 0 : a.amount, credit: profit ? a.amount : 0 })),
    ];
    await withTransaction(async session => {
      for (const a of [RESULT_ACCOUNT, ...clean.map(c => c.code)]) await registerLedgerAccount(auth.tenantId, a, a === RESULT_ACCOUNT ? "Résultat en instance d'affectation" : ALLOCATION_ACCOUNTS[a], session);
      await AccountingEntryModel.create([{
        tenantId: new Types.ObjectId(auth.tenantId), journalCode: "OD", entryDate: date,
        reference: `AFF-${year}`, label: `Affectation du résultat ${year}`, lines,
        linkedDocType: "result_allocation", createdBy: auth.userId,
      }], { session });
    });
    await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { allocatedYear: year, allocations: clean } });
    return ok({ year, allocated: total });
  }

  return badRequest("Action inconnue (lock, check, close ou allocate).");
});
