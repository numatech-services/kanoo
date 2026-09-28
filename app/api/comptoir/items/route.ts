import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Articles d'un comptoir (comptabilité matière). `deskId` requis pour cadrer.
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId, archived: { $ne: true } })
    .sort({ name: 1 }).lean();
  return ok(items);
});

export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["deskId", "name"]);
  if (err) return badRequest(err);
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const item = await ActivityItemModel.create({
    tenantId: auth.tenantId,
    deskId: body.deskId,
    name: String(body.name).slice(0, 160).trim(),
    unit: String(body.unit || "unité").slice(0, 24),
    sku: String(body.sku || "").slice(0, 60) || undefined,
    quantity: Math.max(0, Number(body.quantity) || 0),
    unitCost: Math.max(0, Number(body.unitCost) || 0),
    salePrice: body.salePrice != null ? Math.max(0, Number(body.salePrice)) : undefined,
    threshold: body.threshold != null ? Math.max(0, Number(body.threshold)) : undefined,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: item._id.toString(), metadata: { item: item.name } });
  return created(item);
});
