import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { isId } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const body = await req.json().catch(() => ({}));
  const clean = sanitizeBody(body);
  // La quantité n'est jamais fixée à la main : elle ne bouge que par un mouvement
  // de stock (traçabilité). On n'autorise donc pas `quantity` ici.
  const update: Record<string, unknown> = {};
  if ("name" in clean) update.name = String(clean.name || "").slice(0, 160).trim();
  if ("unit" in clean) update.unit = String(clean.unit || "unité").slice(0, 24);
  if ("sku" in clean) update.sku = String(clean.sku || "").slice(0, 60);
  if ("archived" in clean) update.archived = Boolean(clean.archived);
  for (const f of ["unitCost", "salePrice", "threshold"]) {
    if (f in clean) {
      const n = Number(clean[f]);
      if (!Number.isFinite(n) || n < 0) return badRequest(`Valeur invalide : ${f}`);
      update[f] = n;
    }
  }
  if (update.name === "") return badRequest("Le nom est requis.");
  const item = await ActivityItemModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true }
  );
  if (!item) return notFound("Article introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const r = await ActivityItemModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!r) return notFound("Article introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id) });
  return noContent();
});
