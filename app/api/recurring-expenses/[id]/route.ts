import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { recordMovement, ledgerFor, treasuryKind } from "@/lib/treasury";
import { recurringFields } from "@/lib/recurring";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("recurringCharges", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const e = await RecurringExpenseModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("treasuryAccountId", "label type")
    .populate("supplierId", "name code").lean();
  if (!e) return notFound();
  return ok(e);
});

export const PATCH = withAuth("recurringCharges", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { data, error } = await recurringFields(auth.tenantId, sanitizeBody(await req.json()), true);
  if (error) return badRequest(error);
  const $set: Record<string, unknown> = {}, $unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(data)) { if (v === null) $unset[k] = 1; else $set[k] = v; }
  const e = await RecurringExpenseModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) }, { new: true, runValidators: true });
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "recurringExpenses", { resourceId: params.id });
  return ok(e);
});

// POST /api/recurring-expenses/:id — exécute l'échéance : décaissement sur le
// compte de trésorerie, écriture comptable, échéance suivante.
export const POST = withAuth("recurringCharges", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));

  const expense = await RecurringExpenseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!expense) return notFound();
  if (expense.isActive === false) return badRequest("Charge désactivée : réactivez-la avant de l'exécuter.");

  const accountId = body.treasuryAccountId || expense.treasuryAccountId;
  // Sans compte, rien n'était enregistré alors que la réponse disait « enregistrée ».
  if (!accountId) return badRequest("Choisissez le compte de trésorerie qui paie cette charge.");
  const kind = await treasuryKind(auth.tenantId, accountId);
  if (!kind) return badRequest("Compte de trésorerie introuvable.");
  const ledger = ledgerFor(kind);
  const amount = Number(body.amount) > 0 ? Math.round(Number(body.amount)) : expense.amount;
  const date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide.");

  await withTransaction(async (session) => {
    await recordMovement({
      tenantId: auth.tenantId,
      accountId: String(accountId),
      date,
      amount: -amount,
      label: expense.label || "Charge récurrente",
      reference: body.reference,
      source: "expense",
      linkedDocType: "recurringExpense",
      linkedDocId: expense._id,
      createdBy: auth.userId,
    }, session);

    await AccountingEntryModel.create([{
      tenantId: auth.tenantId,
      journalCode: ledger.journalCode,
      entryDate: date,
      reference: `DEP-${expense._id.toString().slice(-6).toUpperCase()}-${date.toISOString().slice(0, 7)}`,
      label: expense.label || "Charge récurrente",
      lines: [
        { accountCode: expense.accountCode || "622000", accountLabel: expense.label || "Charges diverses", debit: amount, credit: 0,
          ...(expense.projectId ? { projectId: expense.projectId } : {}), ...(expense.activityId ? { activityId: expense.activityId } : {}) },
        { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount },
      ],
      linkedDocType: "recurringExpense",
      linkedDocId: expense._id,
      createdBy: auth.userId,
    }], { session });

    expense.executions.push({ executedAt: date, amount, treasuryAccountId: accountId, reference: body.reference, notes: body.notes });
    const next = new Date(expense.nextDueDate || date);
    if (expense.frequency === "monthly") next.setMonth(next.getMonth() + 1);
    else if (expense.frequency === "quarterly") next.setMonth(next.getMonth() + 3);
    else if (expense.frequency === "biannual") next.setMonth(next.getMonth() + 6);
    else if (expense.frequency === "annual") next.setFullYear(next.getFullYear() + 1);
    else if (expense.frequency === "weekly") next.setDate(next.getDate() + 7);
    else if (expense.frequency === "daily") next.setDate(next.getDate() + 1);
    expense.nextDueDate = next;
    await expense.save({ session });
  });

  await logAudit(auth, "PAYMENT", "recurringCharges", { resourceId: params.id, after: { amount } });
  return ok({ message: `Charge de ${amount.toLocaleString("fr-FR")} XOF payée et déduite de la trésorerie`, expense });
});

/**
 * DELETE — supprime une charge jamais payée ; une charge déjà exécutée est
 * désactivée (ses paiements restent en comptabilité et en trésorerie).
 */
export const DELETE = withAuth("recurringCharges", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const e = await RecurringExpenseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!e) return notFound();
  if ((e.executions ?? []).length > 0) {
    e.isActive = false;
    await e.save();
    await logAudit(auth, "UPDATE", "recurringExpenses", { resourceId: params.id, after: { isActive: false } });
    return ok({ deactivated: true });
  }
  await RecurringExpenseModel.deleteOne({ _id: e._id });
  await logAudit(auth, "DELETE", "recurringExpenses", { resourceId: params.id });
  return noContent();
});
