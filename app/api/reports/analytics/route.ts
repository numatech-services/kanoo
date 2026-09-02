import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { ClientModel } from "@/models/Client";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TokenPayload } from "@/lib/auth";

// GET /api/reports/analytics?months=12
// Retourne les données analytiques sur N mois pour le tableau de bord
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const months = Math.min(parseInt(url.searchParams.get("months") || "12"), 24);

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  // ── Générer les labels mensuels ───────────────────────────────────────────
  const monthLabels: string[] = [];
  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    monthLabels.push(d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const filter = { ...tenantFilter(auth) };

  // ── CA mensuel (factures émises) ──────────────────────────────────────────
  const invoicesByMonth = await InvoiceModel.aggregate([
    { $match: { ...filter, issueDate: { $gte: startDate }, status: { $ne: "cancelled" } } },
    { $group: {
      _id: { year: { $year: "$issueDate" }, month: { $month: "$issueDate" } },
      totalHT: { $sum: "$totalHT" },
      totalTTC: { $sum: "$totalTTC" },
      count: { $sum: 1 },
    }},
  ]);

  // ── Encaissements mensuels (paiements reçus) ──────────────────────────────
  const paymentsByMonth = await PaymentModel.aggregate([
    { $match: { ...filter, paymentDate: { $gte: startDate } } },
    { $group: {
      _id: { year: { $year: "$paymentDate" }, month: { $month: "$paymentDate" } },
      total: { $sum: "$amount" },
      count: { $sum: 1 },
    }},
  ]);

  // ── Charges mensuelles (comptes 6xx) ──────────────────────────────────────
  const chargesByMonth = await AccountingEntryModel.aggregate([
    { $match: { ...filter, entryDate: { $gte: startDate } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": /^6/ } },
    { $group: {
      _id: { year: { $year: "$entryDate" }, month: { $month: "$entryDate" } },
      total: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } },
    }},
  ]);

  // ── Mapper sur les mois ───────────────────────────────────────────────────
  function mapToMonths<T extends { _id: { year: number; month: number } }>(
    data: T[], valueKey: keyof T
  ): number[] {
    return monthKeys.map(key => {
      const [y, m] = key.split("-").map(Number);
      const found = data.find(d => d._id.year === y && d._id.month === m);
      return found ? Math.round(Number(found[valueKey]) / 1000) : 0; // En milliers XOF
    });
  }

  const caData       = mapToMonths(invoicesByMonth, "totalTTC");
  const encaissData  = mapToMonths(paymentsByMonth, "total");
  const chargesData  = mapToMonths(chargesByMonth, "total");
  const margeBrute   = caData.map((v, i) => v - chargesData[i]);

  // ── KPIs globaux ─────────────────────────────────────────────────────────
  const [totalCA, totalEncaisse, clientActifs, facInRetard] = await Promise.all([
    InvoiceModel.aggregate([
      { $match: { ...filter, issueDate: { $gte: startDate }, status: { $ne: "cancelled" } } },
      { $group: { _id: null, sum: { $sum: "$totalTTC" } } }
    ]).then(r => r[0]?.sum || 0),

    PaymentModel.aggregate([
      { $match: { ...filter, paymentDate: { $gte: startDate } } },
      { $group: { _id: null, sum: { $sum: "$amount" } } }
    ]).then(r => r[0]?.sum || 0),

    ClientModel.countDocuments({ ...filter, isActive: true }),

    InvoiceModel.countDocuments({ ...filter, status: { $in: ["sent", "partial"] }, dueDate: { $lt: now } }),
  ]);

  // ── Top clients (par CA sur la période) ──────────────────────────────────
  const topClients = await InvoiceModel.aggregate([
    { $match: { ...filter, issueDate: { $gte: startDate }, status: { $ne: "cancelled" } } },
    { $group: { _id: "$clientId", total: { $sum: "$totalTTC" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 5 },
    { $lookup: { from: "clients", localField: "_id", foreignField: "_id", as: "client" } },
    { $unwind: "$client" },
    { $project: { name: "$client.name", total: 1, count: 1 } },
  ]);

  // ── Taux de recouvrement ──────────────────────────────────────────────────
  const tauxRecouvrement = totalCA > 0 ? Math.round((totalEncaisse / totalCA) * 100) : 0;

  return ok({
    period: { months, startDate, endDate: now, labels: monthLabels },
    series: {
      ca:         { data: caData,      label: "CA TTC (k XOF)",      color: "#2F3E46" },
      encaissements: { data: encaissData, label: "Encaissements (k XOF)", color: "#97C459" },
      charges:    { data: chargesData, label: "Charges (k XOF)",     color: "#F09595" },
      margeBrute: { data: margeBrute,  label: "Marge brute (k XOF)", color: "#378ADD" },
    },
    kpis: {
      totalCA, totalEncaisse, tauxRecouvrement,
      clientActifs, facInRetard,
      caVsMoisPrecedent: caData.length >= 2
        ? Math.round(((caData[caData.length-1] - caData[caData.length-2]) / Math.max(caData[caData.length-2], 1)) * 100)
        : 0,
    },
    topClients,
  });
});
