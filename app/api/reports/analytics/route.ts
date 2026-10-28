import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { ClientModel } from "@/models/Client";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TokenPayload } from "@/lib/auth";

import { BOOKED_INVOICE_MATCH } from "@/lib/payments";
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

  // ── CA mensuel, NET des avoirs ────────────────────────────────────────────
  // Un avoir est stocké avec des montants positifs dans la même collection :
  // sans ce signe, il gonflerait le chiffre d'affaires au lieu de le réduire.
  const invoicesByMonth = await InvoiceModel.aggregate([
    { $match: { ...filter, issueDate: { $gte: startDate }, ...BOOKED_INVOICE_MATCH } },
    { $addFields: {
      sign: { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] },
    }},
    { $addFields: {
      signedHT:  { $multiply: ["$totalHT", "$sign"] },
      signedTTC: { $multiply: ["$totalTTC", "$sign"] },
    }},
    { $group: {
      _id: { year: { $year: "$issueDate" }, month: { $month: "$issueDate" } },
      totalHT: { $sum: "$signedHT" },
      totalTTC: { $sum: "$signedTTC" },
      count: { $sum: { $cond: [{ $eq: ["$documentType", "credit_note"] }, 0, 1] } },
    }},
  ]);

  // ── Encaissements mensuels (paiements reçus) ──────────────────────────────
  const paymentsByMonth = await PaymentModel.aggregate([
    { $match: { ...filter, status: { $nin: ["pending", "cancelled"] }, date: { $gte: startDate } } },
    { $group: {
      _id: { year: { $year: "$date" }, month: { $month: "$date" } },
      total: { $sum: "$amount" },
      count: { $sum: 1 },
    }},
  ]);

  // ── Comptabilité mensuelle, HT : charges (6), ventes (70), achats consommés (60)
  // La « marge brute » était le CA TTC des factures moins TOUTES les charges de
  // classe 6, sans les ventes du comptoir : ni une marge, ni un résultat.
  const ledgerByMonth = await AccountingEntryModel.aggregate<{ _id: { year: number; month: number }; charges: number; sales: number; purchases: number }>([
    { $match: { ...filter, entryDate: { $gte: startDate } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": /^(6|70)/ } },
    { $addFields: { net: { $subtract: ["$lines.debit", "$lines.credit"] } } },
    { $group: {
      _id: { year: { $year: "$entryDate" }, month: { $month: "$entryDate" } },
      charges: { $sum: { $cond: [{ $regexMatch: { input: "$lines.accountCode", regex: /^6/ } }, "$net", 0] } },
      sales: { $sum: { $cond: [{ $regexMatch: { input: "$lines.accountCode", regex: /^70/ } }, { $multiply: ["$net", -1] }, 0] } },
      purchases: { $sum: { $cond: [{ $regexMatch: { input: "$lines.accountCode", regex: /^60/ } }, "$net", 0] } },
    }},
  ]);
  const chargesByMonth = ledgerByMonth.map(r => ({ _id: r._id, total: r.charges }));
  const marginByMonth = ledgerByMonth.map(r => ({ _id: r._id, total: r.sales - r.purchases }));

  // ── Mapper sur les mois ───────────────────────────────────────────────────
  function mapToMonths<T extends { _id: { year: number; month: number } }>(
    data: T[], valueKey: keyof T
  ): number[] {
    return monthKeys.map(key => {
      const [y, m] = key.split("-").map(Number);
      const found = data.find(d => d._id.year === y && d._id.month === m);
      return found ? Math.round(Number(found[valueKey]) / 1000) : 0; // En milliers FCFA
    });
  }

  const caData       = mapToMonths(invoicesByMonth, "totalTTC");
  const encaissData  = mapToMonths(paymentsByMonth, "total");
  const chargesData  = mapToMonths(chargesByMonth, "total");
  // Marge commerciale HT : ventes (70) − achats consommés (60, variation de stock comprise).
  const margeBrute   = mapToMonths(marginByMonth, "total");

  // ── KPIs globaux ─────────────────────────────────────────────────────────
  const [totalCA, totalEncaisse, clientActifs, facInRetard] = await Promise.all([
    InvoiceModel.aggregate([
      { $match: { ...filter, issueDate: { $gte: startDate }, ...BOOKED_INVOICE_MATCH } },
      { $addFields: { sign: { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] } } },
      { $addFields: { signedTTC: { $multiply: ["$totalTTC", "$sign"] } } },
      { $group: { _id: null, sum: { $sum: "$signedTTC" } } }
    ]).then(r => r[0]?.sum || 0),

    PaymentModel.aggregate([
      { $match: { ...filter, status: { $nin: ["pending", "cancelled"] }, date: { $gte: startDate } } },
      { $group: { _id: null, sum: { $sum: "$amount" } } }
    ]).then(r => r[0]?.sum || 0),

    ClientModel.countDocuments({ ...filter, isActive: true }),

    // Un avoir n'est jamais « en retard de paiement » : il n'attend aucun règlement.
    InvoiceModel.countDocuments({
      ...filter, documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial"] }, dueDate: { $lt: now },
    }),
  ]);

  // ── Top clients (par CA sur la période) ──────────────────────────────────
  const topClients = await InvoiceModel.aggregate([
    { $match: { ...filter, issueDate: { $gte: startDate }, ...BOOKED_INVOICE_MATCH } },
      { $addFields: { sign: { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] } } },
      { $addFields: { signedTTC: { $multiply: ["$totalTTC", "$sign"] } } },
    { $group: {
      _id: "$clientId",
      total: { $sum: "$signedTTC" },
      count: { $sum: { $cond: [{ $eq: ["$documentType", "credit_note"] }, 0, 1] } },
    } },
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
      ca:         { data: caData,      label: "CA TTC (k FCFA)",      color: "#2F3E46" },
      encaissements: { data: encaissData, label: "Encaissements (k FCFA)", color: "#97C459" },
      charges:    { data: chargesData, label: "Charges (k FCFA)",     color: "#F09595" },
      margeBrute: { data: margeBrute,  label: "Marge sur achats HT (k FCFA)", color: "#378ADD" },
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
