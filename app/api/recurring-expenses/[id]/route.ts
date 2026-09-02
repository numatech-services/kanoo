import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { withTransaction } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("recurringCharges", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const e = await RecurringExpenseModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("treasuryAccountId", "label type balance")
    .populate("supplierId", "name code").lean();
  if (!e) return notFound();
  return ok(e);
});

export const PATCH = withAuth("recurringCharges", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  const e = await RecurringExpenseModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "recurringExpenses", { resourceId: params.id });
  return ok(e);
});

// POST /api/recurring-expenses/:id/execute — Exécuter une dépense (décompter trésorerie)
export const POST = withAuth("recurringCharges", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));

  const expense = await RecurringExpenseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!expense) return notFound();

  if (!expense.treasuryAccountId && !body.treasuryAccountId) {
    return ok({ message: "Dépense enregistrée (aucun compte de trésorerie configuré)", expense });
  }

  const accountId = body.treasuryAccountId || expense.treasuryAccountId;

  await withTransaction(async (session) => {
    // Décrémenter le compte de trésorerie
    await TreasuryAccountModel.findByIdAndUpdate(
      accountId,
      { $inc: { balance: -expense.amount } },
      { session }
    );

    // Écriture comptable
 // Dans ton fichier POST /api/recurring-expenses/:id/execute
await AccountingEntryModel.create([{
  tenantId: auth.tenantId, 
  journalCode: "CA",
  entryDate: new Date(),
  reference: `DEP-${expense._id.toString().slice(-6).toUpperCase()}`,
  label: expense.label || "Dépense Récurrente", // Sécurité ici
  lines: [
    { 
      accountCode: expense.accountCode || "622000", 
      accountLabel: expense.label || "Frais divers", // Sécurité ici
      debit: expense.amount, 
      credit: 0 
    },
    { 
      accountCode: "571000", 
      accountLabel: "Caisse / Trésorerie", 
      debit: 0, 
      credit: expense.amount 
    },
  ],
  createdBy: auth.userId,
}], { session });
    // Enregistrer l'exécution
    expense.executions.push({ executedAt: new Date(), amount: expense.amount, treasuryAccountId: accountId, reference: body.reference, notes: body.notes });
    // Calculer prochaine date
    const next = new Date(expense.nextDueDate);
    if (expense.frequency === "monthly")   next.setMonth(next.getMonth() + 1);
    else if (expense.frequency === "quarterly") next.setMonth(next.getMonth() + 3);
    else if (expense.frequency === "annual")    next.setFullYear(next.getFullYear() + 1);
    else if (expense.frequency === "weekly")    next.setDate(next.getDate() + 7);
    expense.nextDueDate = next;
    await expense.save({ session });
  });

  return ok({ message: `Dépense de ${expense.amount.toLocaleString("fr-FR")} XOF exécutée et déduite de la trésorerie`, expense });
});

export const DELETE = withAuth("recurringCharges", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  await RecurringExpenseModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  return noContent();
});
