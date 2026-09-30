import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, forbidden, tenantFilter } from "@/lib/api-helpers";
import { SubscriptionPurchaseModel } from "@/models/SubscriptionPurchase";
import { SubscriptionSaleModel } from "@/models/SubscriptionSale";
import {
  reconcile, buildAlerts, taxSummary, monthlyAllocation,
  type PurchaseLike, type SaleLike,
} from "@/lib/subscriptions";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";

export const dynamic = "force-dynamic";

/**
 * GET /api/abonnements/rapprochement
 *
 * Vue consolidée du portefeuille : rapprochement contrat par contrat, alertes,
 * charges fiscales, et étalement mensuel du coût et du produit.
 *
 * Tout est calculé à la volée depuis les enregistrements. Rien n'est stocké en
 * doublon : un total figé en base finit toujours par diverger des lignes qu'il
 * est censé résumer.
 */
export const GET = withAuth("subscriptions", "read", async (req: NextRequest, auth: TokenPayload) => {
  // Coûts, revenus et marges : réservé au gérant et à la comptabilité.
  if (!hasFinanceAccess(auth)) return forbidden("Le rapprochement des coûts et des marges est réservé à la comptabilité et au gérant.");
  await connectDB();

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  const [purchases, sales] = await Promise.all([
    SubscriptionPurchaseModel.find(tenantFilter(auth))
      .populate("supplierId", "name code")
      .sort({ endDate: 1 }).lean(),
    SubscriptionSaleModel.find(tenantFilter(auth))
      .populate("clientId", "name code")
      .sort({ endDate: 1 }).lean(),
  ]);

  const p = purchases as unknown as PurchaseLike[];
  const s = sales as unknown as SaleLike[];

  const reconciliations = p.map(purchase => ({
    purchaseId: String(purchase._id),
    supplier: (purchase as unknown as { supplierId?: { name?: string } }).supplierId?.name ?? null,
    endDate: purchase.endDate,
    status: purchase.status,
    ...reconcile(purchase, s),
  }));

  // ── Étalement mensuel sur l'exercice demandé ─────────────────────────────
  // Un abonnement annuel n'est pas une charge de janvier : il pèse chaque mois
  // qu'il couvre. Sans cet étalement, la marge mensuelle est illisible.
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, cost: 0, revenue: 0 }));

  for (const purchase of p) {
    if (purchase.status === "cancelled") continue;
    const cost = (purchase.costAmount || 0)
      + (purchase.withholdingAmount || 0)
      + (purchase.bankFeesAmount || 0);
    for (const bucket of monthlyAllocation(cost, purchase.startDate, purchase.endDate)) {
      if (bucket.year === year) months[bucket.month - 1].cost += bucket.amount;
    }
  }

  for (const sale of s) {
    if (sale.status === "cancelled" || sale.status === "draft") continue;
    for (const bucket of monthlyAllocation(sale.totalHT || 0, sale.startDate, sale.endDate)) {
      if (bucket.year === year) months[bucket.month - 1].revenue += bucket.amount;
    }
  }

  const totals = reconciliations.reduce(
    (acc, r) => ({
      cost: acc.cost + r.cost,
      revenue: acc.revenue + r.revenue,
      margin: acc.margin + r.margin,
      bought: acc.bought + r.quantityBought,
      sold: acc.sold + r.quantitySold,
    }),
    { cost: 0, revenue: 0, margin: 0, bought: 0, sold: 0 }
  );

  // Reventes sans contrat amont : ni marge ni couverture connues.
  const unattached = s
    .filter(sale => !sale.purchaseId && sale.status !== "cancelled")
    .map(sale => ({ reference: sale.reference, totalHT: sale.totalHT }));

  return ok({
    year,
    totals: {
      ...totals,
      marginRate: totals.revenue > 0 ? Math.round((totals.margin / totals.revenue) * 100) : 0,
      fillRate: totals.bought > 0 ? Math.round((totals.sold / totals.bought) * 100) : 0,
      purchaseCount: p.length,
      saleCount: s.filter(x => x.status !== "cancelled").length,
    },
    reconciliations,
    months,
    alerts: buildAlerts(p, s),
    tax: taxSummary(p, s),
    unattachedSales: unattached,
  });
});
