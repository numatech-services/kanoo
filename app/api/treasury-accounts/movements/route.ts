import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, tenantFilter, getPagination, paginatedResponse } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { accountBalance, treasuryLedger } from "@/lib/treasury";
import { unknownAccounts } from "@/lib/ledger";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { logAudit } from "@/lib/audit";
import { parseFlow, parsePeriod, periodMatch, flowTotals } from "@/lib/flow-filter";

export const dynamic = "force-dynamic";

/**
 * GET ?accountId=&from=&to=&flow=in|out — mouvements d'un compte (ou de tous).
 * Recettes = entrées, dépenses = sorties, hors virements internes (qui ne sont
 * ni l'un ni l'autre) ; `totals` couvre la période, tous sens confondus.
 */
export const GET = withAuth("treasuryAccounts", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const pagination = getPagination(req);
  const base: Record<string, unknown> = { ...tenantFilter(auth), ...periodMatch("date", parsePeriod(url)) };
  const accountId = url.searchParams.get("accountId");
  if (accountId && Types.ObjectId.isValid(accountId)) base.accountId = new Types.ObjectId(accountId);
  const flow = parseFlow(url.searchParams.get("flow"));
  const filter = flow ? { ...base, source: { $ne: "transfer" }, amount: flow === "in" ? { $gt: 0 } : { $lt: 0 } } : base;
  const [items, total, sums] = await Promise.all([
    TreasuryMovementModel.find(filter).sort({ date: -1, createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).populate("accountId", "label type").lean(),
    TreasuryMovementModel.countDocuments(filter),
    TreasuryMovementModel.aggregate<{ _id: null; inSum: number; outSum: number }>([
      { $match: { ...base, source: { $ne: "transfer" } } },
      { $group: { _id: null, inSum: { $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] } }, outSum: { $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] } } } },
    ]),
  ]);
  return paginatedResponse(items, total, pagination, { totals: flowTotals(sums[0]?.inSum ?? 0, sums[0]?.outSum ?? 0) });
});

/**
 * POST — deux usages :
 *  - { kind: "transfer", fromAccountId, toAccountId, amount, date, label? } :
 *    virement interne (retrait banque → caisse, dépôt…) : deux mouvements liés
 *    et une écriture via 585 « virements de fonds » ;
 *  - { kind: "manual", accountId, direction: "in"|"out", amount, date, label,
 *      counterAccount, projectId?, activityId?, costCenter? } : entrée ou sortie
 *    libre (apport, frais bancaires, recette diverse) avec sa contrepartie.
 */
export const POST = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const amount = Math.round(Number(body.amount));
  if (!(amount > 0)) return badRequest("Montant invalide.");
  const date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide.");
  const reference = body.reference ? String(body.reference).slice(0, 80) : undefined;

  if (body.kind === "transfer") {
    const [src, dst] = await Promise.all([treasuryLedger(auth.tenantId, body.fromAccountId), treasuryLedger(auth.tenantId, body.toAccountId)]);
    if (!src || !dst) return badRequest("Compte de trésorerie introuvable.");
    if (String(body.fromAccountId) === String(body.toAccountId)) return badRequest("Choisissez deux comptes différents.");
    const bal = await accountBalance(auth.tenantId, String(body.fromAccountId));
    if (bal && bal.balance < amount && !body.allowOverdraft) return badRequest(`Solde insuffisant sur le compte débité (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
    const label = String(body.label || "Virement interne").slice(0, 200);
    const result = await withTransaction(async session => {
      const [entry] = await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: reference ?? `VIR-${date.toISOString().slice(0, 10)}`, label,
        lines: [
          { accountCode: "585000", accountLabel: "Virements de fonds", debit: amount, credit: 0 },
          { accountCode: src.accountCode, accountLabel: src.accountLabel, debit: 0, credit: amount },
          { accountCode: dst.accountCode, accountLabel: dst.accountLabel, debit: amount, credit: 0 },
          { accountCode: "585000", accountLabel: "Virements de fonds", debit: 0, credit: amount },
        ],
        linkedDocType: "treasury", createdBy: auth.userId,
      }], { session });
      const [out] = await TreasuryMovementModel.create([{ tenantId: auth.tenantId, accountId: body.fromAccountId, date, amount: -amount, label, reference, source: "transfer", linkedDocType: "transfer", entryId: entry._id, createdBy: auth.userId }], { session });
      const [inn] = await TreasuryMovementModel.create([{ tenantId: auth.tenantId, accountId: body.toAccountId, date, amount, label, reference, source: "transfer", linkedDocType: "transfer", entryId: entry._id, transferPeerId: out._id, createdBy: auth.userId }], { session });
      await TreasuryMovementModel.updateOne({ _id: out._id }, { $set: { transferPeerId: inn._id } }, { session });
      return { out, inn };
    });
    await logAudit(auth, "CREATE", "treasuryAccounts", { metadata: { transfer: amount, from: body.fromAccountId, to: body.toAccountId } });
    return created(result);
  }

  if (body.kind === "manual") {
    const ledger = await treasuryLedger(auth.tenantId, body.accountId);
    if (!ledger) return badRequest("Compte de trésorerie introuvable.");
    const direction = body.direction === "out" ? "out" : "in";
    const label = String(body.label ?? "").trim().slice(0, 200);
    if (!label) return badRequest("Libellé obligatoire.");
    const counter = String(body.counterAccount ?? "").trim();
    if (!/^[1-9]\d{2,7}$/.test(counter) || /^5[27]/.test(counter)) return badRequest("Compte de contrepartie invalide (ex. 631000 frais bancaires, 758000 produits divers, 101000 apport).");
    const unknown = await unknownAccounts(auth.tenantId, [counter]);
    if (unknown.length) return badRequest(`Le compte ${counter} n'est pas dans le plan comptable.`);
    const imp = pickImputation(body);
    const e = await checkImputations(auth.tenantId, [imp]);
    if (e) return badRequest(e);
    if (direction === "out") {
      const bal = await accountBalance(auth.tenantId, String(body.accountId));
      if (bal && bal.balance < amount && !body.allowOverdraft) return badRequest(`Solde insuffisant (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
    }
    const result = await withTransaction(async session => {
      const counterLine = { accountCode: counter, accountLabel: String(body.counterLabel || label).slice(0, 160), ...(/^[67]/.test(counter) ? imp : {}) };
      const [entry] = await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: ledger.journalCode, entryDate: date, reference: reference ?? `MVT-${date.toISOString().slice(0, 10)}`, label,
        lines: direction === "in"
          ? [{ accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 }, { ...counterLine, debit: 0, credit: amount }]
          : [{ ...counterLine, debit: amount, credit: 0 }, { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount }],
        linkedDocType: "treasury", createdBy: auth.userId,
      }], { session });
      const [m] = await TreasuryMovementModel.create([{ tenantId: auth.tenantId, accountId: body.accountId, date, amount: direction === "in" ? amount : -amount, label, reference, source: "manual", linkedDocType: "manual", entryId: entry._id, createdBy: auth.userId }], { session });
      return m;
    });
    await logAudit(auth, "CREATE", "treasuryAccounts", { metadata: { manual: direction, amount, counter } });
    return created(result);
  }

  return badRequest("Type d'opération inconnu (transfer ou manual).");
});
