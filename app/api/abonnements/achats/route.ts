import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, created, badRequest, conflict, notFound,
  getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody,
} from "@/lib/api-helpers";
import { SubscriptionPurchaseModel } from "@/models/SubscriptionPurchase";
import { SupplierModel } from "@/models/Supplier";
import { suggestedWithholding } from "@/lib/subscriptions";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { maskMoney } from "@/lib/payroll-mask";

export const GET = withAuth("subscriptions", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  const supplierId = url.searchParams.get("supplierId");
  const search = url.searchParams.get("search");
  if (status) filter.status = status;
  if (supplierId) filter.supplierId = supplierId;
  if (search) {
    filter.$or = [
      { reference: { $regex: search, $options: "i" } },
      { productName: { $regex: search, $options: "i" } },
      { vendorContractRef: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    SubscriptionPurchaseModel.find(filter)
      .populate("supplierId", "name code")
      .sort({ endDate: 1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    SubscriptionPurchaseModel.countDocuments(filter),
  ]);

  // Montants masqués hors gérant / comptabilité.
  return paginatedResponse(items.map(i => maskMoney(i as Record<string, unknown>, auth)), total, pagination);
});

export const POST = withAuth("subscriptions", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, [
    "reference", "supplierId", "productName", "startDate", "endDate", "quantity", "sourceAmount",
  ]);
  if (missing) return badRequest(missing);

  await connectDB();

  const supplier = await SupplierModel.findOne({ _id: body.supplierId, ...tenantFilter(auth) })
    .select("name").lean<{ name: string } | null>();
  if (!supplier) return notFound("Fournisseur introuvable");

  const start = new Date(body.startDate);
  const end = new Date(body.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return badRequest("Dates de période invalides");
  }
  if (end <= start) return badRequest("La date de fin doit suivre la date de début");

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return badRequest("La quantité doit être un entier positif");
  }

  const currency = body.currency || "XOF";
  const sourceAmount = Number(body.sourceAmount);
  const exchangeRate = currency === "XOF" ? 1 : Number(body.exchangeRate);
  if (!Number.isFinite(sourceAmount) || sourceAmount < 0) return badRequest("Montant invalide");
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return badRequest("Un taux de change est requis pour une devise étrangère");
  }

  // La contre-valeur est figée ici : rejouer la conversion au cours du jour
  // ferait bouger une marge déjà réalisée.
  const costAmount = Math.round(sourceAmount * exchangeRate);

  // La retenue proposée n'est appliquée que si la route ne l'a pas reçue :
  // l'utilisateur reste maître du montant qu'il a réellement retenu.
  const withholdingAmount = body.withholdingAmount !== undefined
    ? Math.max(0, Math.round(Number(body.withholdingAmount) || 0))
    : suggestedWithholding(costAmount, currency !== "XOF");

  const existing = await SubscriptionPurchaseModel.findOne({
    tenantId: auth.tenantId, reference: body.reference,
  }).select("_id").lean();
  if (existing) return conflict(`Référence '${body.reference}' déjà utilisée`);

  const purchase = await SubscriptionPurchaseModel.create({
    ...sanitizeBody(body, ["costAmount", "status"]),
    startDate: start,
    endDate: end,
    quantity,
    currency,
    sourceAmount,
    exchangeRate,
    costAmount,
    withholdingAmount,
    status: body.status === "draft" ? "draft" : "active",
    tenantId: auth.tenantId,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "subscriptions", {
    resourceId: purchase._id.toString(),
    after: { reference: body.reference, productName: body.productName, costAmount },
  });

  return created(purchase);
});
