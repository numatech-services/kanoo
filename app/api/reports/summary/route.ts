import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { totalTreasury } from "@/lib/treasury";
import { BOOKED_INVOICE_MATCH } from "@/lib/payments";
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
    treasuryTotal,
  ] = await Promise.all([
    // CA par statut sur l'année
    // Les avoirs sont exclus de la ventilation par statut : ils ne sont ni
    // « à encaisser » ni « payés », et les mêler ici doublerait leur effet
    // puisqu'ils réduisent déjà le CA par ailleurs.
    InvoiceModel.aggregate([
      { $match: { ...tf, documentType: { $ne: "credit_note" }, issueDate: { $gte: startOfYear, $lte: endOfYear } } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalTTC: { $sum: "$totalTTC" }, totalHT: { $sum: "$totalHT" }, paidAmount: { $sum: "$paidAmount" } } },
    ]),

    // Impayés en retard
    InvoiceModel.countDocuments({
      ...tf,
      documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial"] },
      dueDate: { $lt: now },
    }),

    // Encaissements du mois
    PaymentModel.aggregate([
      { $match: { ...tf, status: { $nin: ["pending", "cancelled"] }, date: { $gte: startOfMonth, $lte: now } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),

    // Employés actifs
    EmployeeModel.countDocuments({ ...tf, isActive: true }),

    // Trésorerie : soldes de TOUS les comptes (banques, caisses, mobile
    // money). Elle ne lisait que les journaux BQ et CA : un virement interne,
    // une reprise d'ouverture ou une paie (OD) en étaient absents.
    totalTreasury(auth.tenantId),
  ]);
  // Chiffre d'affaires : factures émises (une facture annulée par un avoir
  // reste une vente, compensée par son avoir), net des avoirs.
  const sign = { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] };
  const [sales] = await InvoiceModel.aggregate<{ ht: number; ttc: number }>([
    { $match: { ...tf, issueDate: { $gte: startOfYear, $lte: endOfYear }, ...BOOKED_INVOICE_MATCH } },
    { $group: { _id: null, ht: { $sum: { $multiply: ["$totalHT", sign] } }, ttc: { $sum: { $multiply: ["$totalTTC", sign] } } } },
  ]);

  // Construire le résumé
  // Chiffre d'affaires = factures ÉMISES (ni brouillons ni annulations),
  // HT, net des avoirs. Le TTC à encaisser reste à part.
  const caHT = sales?.ht ?? 0;
  const caTotal = sales?.ttc ?? 0;
  const caPaid = invoicesStats.reduce((s, g) => s + g.paidAmount, 0);
  const caDraft = invoicesStats.find((g) => g._id === "draft")?.totalTTC || 0;
  const countInvoices = invoicesStats.filter(g => g._id !== "draft").reduce((s, g) => s + g.count, 0);
  const treasury = treasuryTotal.total;

  return ok({
    year,
    ca: { ht: Math.round(caHT), total: Math.round(caTotal), paid: Math.round(caPaid), pending: Math.round(Math.max(0, caTotal - caPaid)), draft: Math.round(caDraft) },
    invoices: { total: countInvoices, overdue: overdueInvoices },
    payments: {
      thisMonth: Math.round(paymentsThisMonth[0]?.total || 0),
      countThisMonth: paymentsThisMonth[0]?.count || 0,
    },
    hr: { activeEmployees },
    treasury: Math.round(treasury),
  });
});
