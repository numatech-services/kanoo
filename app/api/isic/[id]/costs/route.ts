import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel, type IIsicCost } from "@/models/IsicBatch";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CATEGORIES = ["printing", "lanyard", "operations", "other"];

/**
 * POST — dépense du lot : { category, label, quantity?, unitCost?, amount?, date?, supplier?, note? }.
 * Montant = quantité × coût unitaire s'il n'est pas donné. DELETE ?costId=… la retire.
 * Volet financier ISIC uniquement.
 */
export const POST = withAuth("isicFinance", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!CATEGORIES.includes(body.category)) return badRequest("Catégorie de dépense invalide.");
  const quantity = body.quantity !== undefined && body.quantity !== "" ? Number(body.quantity) : undefined;
  const unitCost = body.unitCost !== undefined && body.unitCost !== "" ? Number(body.unitCost) : undefined;
  const amount = body.amount !== undefined && body.amount !== "" ? Math.round(Number(body.amount))
    : quantity !== undefined && unitCost !== undefined ? Math.round(quantity * unitCost) : NaN;
  if (!(amount > 0)) return badRequest("Montant invalide (ou quantité × coût unitaire).");
  if ((quantity !== undefined && !(quantity >= 0)) || (unitCost !== undefined && !(unitCost >= 0))) return badRequest("Quantité ou coût unitaire invalide.");
  const date = body.date ? new Date(String(body.date)) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide.");
  const label = String(body.label || "").trim().slice(0, 200)
    || ({ printing: "Impression des cartes", lanyard: "Tours de cou personnalisés", operations: "Frais opérationnels", other: "Dépense" } as Record<string, string>)[body.category];

  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");
  batch.costs.push({
    category: body.category, label, amount, date,
    ...(quantity !== undefined ? { quantity } : {}), ...(unitCost !== undefined ? { unitCost } : {}),
    supplier: body.supplier ? String(body.supplier).slice(0, 200) : undefined,
    note: body.note ? String(body.note).slice(0, 300) : undefined,
  } as IIsicCost);
  await batch.save();
  await logAudit(auth, "UPDATE", "isic", { resourceId: String(params.id), metadata: { cost: body.category, amount } });
  return ok(batch);
});

export const DELETE = withAuth("isicFinance", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const costId = new URL(req.url).searchParams.get("costId");
  if (!costId) return badRequest("Dépense non précisée.");
  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");
  batch.costs = batch.costs.filter((c: IIsicCost) => String(c._id) !== costId) as typeof batch.costs;
  await batch.save();
  await logAudit(auth, "UPDATE", "isic", { resourceId: String(params.id), metadata: { costRemoved: costId } });
  return ok(batch);
});
