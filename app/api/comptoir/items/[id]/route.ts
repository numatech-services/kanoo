import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ActivityItemModel } from "@/models/ActivityItem";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const clean = sanitizeBody(body);
  // La quantité n'est jamais fixée à la main : elle ne bouge que par un mouvement
  // de stock (traçabilité). On n'autorise donc pas `quantity` ici.
  const ALLOWED = ["name", "unit", "sku", "unitCost", "salePrice", "threshold", "archived"];
  const update: Record<string, unknown> = {};
  for (const f of ALLOWED) { if (f in clean) update[f] = clean[f]; }
  const item = await ActivityItemModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true }
  );
  if (!item) return notFound("Article introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const r = await ActivityItemModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!r) return notFound("Article introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id) });
  return noContent();
});
