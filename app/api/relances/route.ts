import { NextRequest } from "next/server";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { planForTenant } from "@/lib/dunning-context";
import { agingBuckets, averagePaymentDelay, type InvoiceLike } from "@/lib/dunning";
import { DunningLogModel } from "@/models/DunningLog";
import { InvoiceModel } from "@/models/Invoice";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/relances
 *
 * Aperçu du jour : ce qui partirait, ce qui ne partira pas et pourquoi, plus
 * la balance âgée et l'historique récent.
 *
 * L'aperçu appelle **le même moteur** que le job de nuit. C'est la seule façon
 * d'éviter la situation classique où l'écran promet une chose et l'automate en
 * fait une autre.
 */
export const GET = withAuth("invoices", "read", async (req: NextRequest, auth: TokenPayload) => {
  const url = new URL(req.url);
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam ? new Date(asOfParam) : new Date();

  const { plan, context, settings } = await planForTenant(auth.tenantId, asOf);

  // Le délai moyen se mesure sur ce qui a été réglé, donc hors du portefeuille
  // d'impayés chargé par le plan.
  const settled = await InvoiceModel.find({
    ...tenantFilter(auth),
    documentType: { $ne: "credit_note" },
    status: "paid",
    updatedAt: { $gte: new Date(Date.now() - 365 * 86_400_000) },
  })
    .select("totalTTC creditedAmount dueDate updatedAt")
    .limit(1_000)
    .lean<Array<InvoiceLike & { updatedAt: Date }>>();

  const recent = await DunningLogModel.find({ ...tenantFilter(auth) })
    .sort({ sentAt: -1 }).limit(50)
    .populate("invoiceId", "number")
    .populate("clientId", "name")
    .lean();

  return ok({
    asOf: asOf.toISOString(),
    enabled: settings.enabled,
    settings,
    plan,
    aging: agingBuckets(context.invoices, asOf),
    // `paidAt` n'existe pas : la date de règlement est celle du passage au
    // statut « payée ». Approximation assumée, signalée ici plutôt que
    // présentée comme une mesure exacte.
    averageDelay: averagePaymentDelay(settled.map(i => ({ ...i, paidAt: i.updatedAt }))),
    averageDelayIsApproximate: true,
    history: recent,
  });
});
