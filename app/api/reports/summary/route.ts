import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { EmployeeModel } from "@/models/Employee";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));

  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const now = new Date();

  const tf = tenantFilter(auth);

  const [
    invoicesStats,
    overdueInvoices,
    paymentsThisMonth,
    activeEmployees,
    accountingBalance,
  ] = await Promise.all([
    // CA par statut sur l'année
    InvoiceModel.aggregate([
      { $match: { ...tf, issueDate: { $gte: startOfYear, $lte: endOfYear } } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalTTC: { $sum: "$totalTTC" }, paidAmount: { $sum: "$paidAmount" } } },
    ]),

    // Impayés en retard
    InvoiceModel.countDocuments({
      ...tf,
      status: { $in: ["sent", "partial"] },
      dueDate: { $lt: now },
    }),

    // Encaissements du mois
    PaymentModel.aggregate([
      { $match: { ...tf, date: { $gte: startOfMonth, $lte: now } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),

    // Employés actifs
    EmployeeModel.countDocuments({ ...tf, isActive: true }),

    // Solde trésorerie (somme débits - crédits BQ + CA)
    AccountingEntryModel.aggregate([
      { $match: { ...tf, journalCode: { $in: ["BQ", "CA"] } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $in: ["521000", "571000"] } } },
      { $group: { _id: null, totalDebit: { $sum: "$lines.debit" }, totalCredit: { $sum: "$lines.credit" } } },
    ]),
  ]);

  // Construire le résumé
  const caTotal = invoicesStats.reduce((s, g) => s + (g._id !== "cancelled" ? g.totalTTC : 0), 0);
  const caPaid = invoicesStats.reduce((s, g) => s + g.paidAmount, 0);
  const caDraft = invoicesStats.find((g) => g._id === "draft")?.totalTTC || 0;
  const countInvoices = invoicesStats.reduce((s, g) => s + g.count, 0);

  const treasury = accountingBalance[0]
    ? accountingBalance[0].totalDebit - accountingBalance[0].totalCredit
    : 0;

  return ok({
    year,
    ca: { total: Math.round(caTotal), paid: Math.round(caPaid), pending: Math.round(caTotal - caPaid), draft: Math.round(caDraft) },
    invoices: { total: countInvoices, overdue: overdueInvoices },
    payments: {
      thisMonth: Math.round(paymentsThisMonth[0]?.total || 0),
      countThisMonth: paymentsThisMonth[0]?.count || 0,
    },
    hr: { activeEmployees },
    treasury: Math.round(treasury),
  });
});
