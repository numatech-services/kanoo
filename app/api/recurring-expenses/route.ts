import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

function calcNextDate(startDate: Date, frequency: string): Date {
  const d = new Date(startDate);
  if (frequency === "monthly")   d.setMonth(d.getMonth() + 1);
  else if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (frequency === "annual")    d.setFullYear(d.getFullYear() + 1);
  else if (frequency === "weekly")    d.setDate(d.getDate() + 7);
  else if (frequency === "daily")     d.setDate(d.getDate() + 1);
  return d;
}

export const GET = withAuth("recurringCharges", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const dueThiMonth = url.searchParams.get("dueThisMonth") === "true";
  const isActive = url.searchParams.get("isActive");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (category) filter.category = category;
  if (isActive !== null) filter.isActive = isActive !== "false";

  if (dueThiMonth) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    filter.nextDueDate = { $gte: start, $lte: end };
  }

  const [items, total] = await Promise.all([
    RecurringExpenseModel.find(filter)
      .populate("treasuryAccountId", "label type")
      .populate("supplierId", "name code")
      .sort({ nextDueDate: 1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    RecurringExpenseModel.countDocuments(filter),
  ]);

  // Total mensuel estimé
  const allActive = await RecurringExpenseModel.find({ ...tenantFilter(auth), isActive: true }).lean();
  const monthlyTotal = allActive.reduce((sum, e) => {
    const f = e.frequency;
    if (f === "monthly")   return sum + e.amount;
    if (f === "quarterly") return sum + e.amount / 3;
    if (f === "annual")    return sum + e.amount / 12;
    if (f === "weekly")    return sum + e.amount * 4.33;
    if (f === "daily")     return sum + e.amount * 30;
    return sum;
  }, 0);

  return ok({
    items,
    pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    monthlyTotal: Math.round(monthlyTotal),
  });
});

export const POST = withAuth("recurringCharges", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["label", "amount", "frequency", "startDate"]);
  if (err) return badRequest(err);

  const nextDueDate = calcNextDate(new Date(body.startDate), body.frequency);

  const expense = await RecurringExpenseModel.create({
    ...body,
    tenantId: auth.tenantId,
    nextDueDate,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "recurringExpenses", {
    resourceId: expense._id.toString(),
    after: { label: body.label, amount: body.amount, frequency: body.frequency },
  });
  return created(expense);
});
