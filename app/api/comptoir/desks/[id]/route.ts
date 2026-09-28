import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, conflict, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityModel } from "@/models/Activity";
import { isId } from "@/lib/comptoir";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Paramètres d'un comptoir : nom, description, secteur analytique lié, archivage.
export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Comptoir introuvable");
  const clean = sanitizeBody(await req.json().catch(() => ({})));
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};

  if ("name" in clean) {
    const name = String(clean.name || "").slice(0, 120).trim();
    if (!name) return badRequest("Le nom est requis.");
    if (await ActivityDeskModel.exists({ ...tenantFilter(auth), name, _id: { $ne: params.id } })) {
      return conflict("Un comptoir porte déjà ce nom.");
    }
    $set.name = name;
  }
  if ("description" in clean) $set.description = String(clean.description || "").slice(0, 400);
  if ("archived" in clean) $set.archived = Boolean(clean.archived);
  if ("activityId" in clean) {
    // Chaîne vide / null = détacher du secteur (la caisse retourne aux frais généraux).
    if (!clean.activityId) $unset.activityId = 1;
    else if (!isId(clean.activityId) || !(await ActivityModel.exists({ _id: clean.activityId, ...tenantFilter(auth) }))) {
      return badRequest("Secteur analytique introuvable.");
    } else $set.activityId = clean.activityId;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  const desk = await ActivityDeskModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, update, { new: true });
  if (!desk) return notFound("Comptoir introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(desk);
});
