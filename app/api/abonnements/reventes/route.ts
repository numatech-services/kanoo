import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, created, badRequest, conflict, notFound,
  getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody,
} from "@/lib/api-helpers";
import { SubscriptionSaleModel } from "@/models/SubscriptionSale";
import { SubscriptionPurchaseModel } from "@/models/SubscriptionPurchase";
import { ClientModel } from "@/models/Client";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { reconcile, type SaleLike } from "@/lib/subscriptions";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("subscriptions", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  const purchaseId = url.searchParams.get("purchaseId");
  const unbilled = url.searchParams.get("unbilled");
  const search = url.searchParams.get("search");

  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;
  if (purchaseId) filter.purchaseId = purchaseId;
  if (unbilled === "true") filter.invoiceId = { $exists: false };
  if (search) {
    filter.$or = [
      { reference: { $regex: search, $options: "i" } },
      { productName: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    SubscriptionSaleModel.find(filter)
      .populate("clientId", "name code")
      .populate("purchaseId", "reference productName endDate quantity")
      .sort({ endDate: 1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    SubscriptionSaleModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("subscriptions", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, [
    "reference", "clientId", "productName", "startDate", "endDate", "quantity", "unitPrice",
  ]);
  if (missing) return badRequest(missing);

  await connectDB();

  const client = await ClientModel.findOne({ _id: body.clientId, ...tenantFilter(auth) })
    .select("name").lean<{ name: string } | null>();
  if (!client) return notFound("Client introuvable");

  const start = new Date(body.startDate);
  const end = new Date(body.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return badRequest("Dates de période invalides");
  }
  if (end <= start) return badRequest("La date de fin doit suivre la date de début");

  const quantity = Number(body.quantity);
  const unitPrice = Number(body.unitPrice);
  if (!Number.isInteger(quantity) || quantity < 1) return badRequest("Quantité invalide");
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return badRequest("Prix unitaire invalide");

  // ── Contrôles de couverture ────────────────────────────────────────────
  // Ils refusent au lieu d'alerter après coup : vendre au-delà de ce qu'on a
  // acheté, ou plus longtemps, est un engagement qu'on ne peut pas tenir.
  if (body.purchaseId) {
    const purchase = await SubscriptionPurchaseModel.findOne({
      _id: body.purchaseId, ...tenantFilter(auth),
    }).lean<{
      _id: unknown; reference: string; productName: string;
      startDate: Date; endDate: Date; quantity: number; costAmount: number; status?: string;
    } | null>();
    if (!purchase) return notFound("Abonnement souscrit introuvable");
    if (purchase.status === "cancelled") {
      return badRequest("Ce contrat est annulé : il ne peut plus être revendu");
    }

    if (end.getTime() > new Date(purchase.endDate).getTime()) {
      return badRequest(
        `La revente court jusqu'au ${end.toLocaleDateString("fr-FR")} alors que le contrat ${purchase.reference} s'arrête le ${new Date(purchase.endDate).toLocaleDateString("fr-FR")}.`
      );
    }
    if (start.getTime() < new Date(purchase.startDate).getTime()) {
      return badRequest(
        `La revente démarre avant le contrat ${purchase.reference} (${new Date(purchase.startDate).toLocaleDateString("fr-FR")}).`
      );
    }

    const siblings = await SubscriptionSaleModel.find({
      ...tenantFilter(auth), purchaseId: body.purchaseId,
    }).select("purchaseId quantity totalHT status endDate reference invoiceId startDate")
      .lean<SaleLike[]>();

    const rec = reconcile(purchase, siblings);
    if (quantity > rec.quantityRemaining) {
      return badRequest(
        `Il reste ${rec.quantityRemaining} licence(s) disponibles sur ${purchase.reference} (${rec.quantityBought} acquises, ${rec.quantitySold} déjà placées).`
      );
    }
  }

  const existing = await SubscriptionSaleModel.findOne({
    tenantId: auth.tenantId, reference: body.reference,
  }).select("_id").lean();
  if (existing) return conflict(`Référence '${body.reference}' déjà utilisée`);

  const tvaRate = body.tvaRate !== undefined ? Number(body.tvaRate) : TVA_TAUX_STANDARD;
  const totalHT = Math.round(quantity * unitPrice);
  const totalTVA = calculerTVA(totalHT, tvaRate);

  const sale = await SubscriptionSaleModel.create({
    ...sanitizeBody(body, ["totalHT", "totalTVA", "totalTTC", "invoiceId", "invoicedAt", "status"]),
    startDate: start,
    endDate: end,
    quantity,
    unitPrice: Math.round(unitPrice),
    tvaRate,
    totalHT,
    totalTVA,
    totalTTC: totalHT + totalTVA,
    status: body.status === "draft" ? "draft" : "active",
    tenantId: auth.tenantId,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "subscriptions", {
    resourceId: sale._id.toString(),
    after: { reference: body.reference, clientId: body.clientId, totalHT },
  });

  return created(sale);
});
