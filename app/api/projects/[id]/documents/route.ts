import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { AttachmentModel } from "@/models/Attachment";
import { validate, store, STORAGE_MESSAGES } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Documents d'un projet.
 *
 * Cette route écrivait dans `public/uploads/`, que Next sert en statique sans
 * la moindre autorisation : le document d'un projet devenait lisible par
 * quiconque connaissait l'URL, y compris hors de l'organisation. Elle passe
 * désormais par le stockage protégé — les octets ne sortent que par
 * `/api/attachments/:id`, après vérification du droit.
 *
 * Elle est conservée plutôt que supprimée : l'écran projet l'appelle, et une
 * route qui disparaît casse un client hors ligne qui rejoue sa file d'attente.
 */
export const GET = withAuth("projects", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const items = await AttachmentModel.find({
    ...tenantFilter(auth), host: "projects", hostId: params.id,
  }).select("-storageKey").sort({ createdAt: -1 }).lean();
  return ok({ items });
});

export const POST = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Requête multipart attendue.");

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Fichier manquant");

  // L'appartenance du projet se vérifie AVANT toute écriture sur disque.
  const project = await ProjectModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("_id");
  if (!project) return notFound();

  const buffer = Buffer.from(await file.arrayBuffer());
  const check = validate(file.name, file.type, buffer);
  if (!check.ok) return badRequest(STORAGE_MESSAGES[check.error]);

  const stored = await store(auth.tenantId, file.name, check.mime, buffer);

  const attachment = await AttachmentModel.create({
    tenantId: auth.tenantId,
    host: "projects",
    hostId: params.id,
    category: String(form.get("type") || "autre") === "contrat" ? "contrat" : "autre",
    label: String(form.get("name") || "").trim() || undefined,
    filename: stored.filename,
    mime: stored.mime,
    size: stored.size,
    sha256: stored.sha256,
    storageKey: stored.storageKey,
    uploadedBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "documents", {
    resourceId: String(attachment._id),
    metadata: { host: "projects", hostId: String(params.id), size: stored.size },
  });

  const safe = attachment.toObject();
  delete safe.storageKey;
  return ok(safe);
});
