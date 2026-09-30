import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, forbidden, tenantFilter } from "@/lib/api-helpers";
import { AttachmentModel } from "@/models/Attachment";
import { validate, store, STORAGE_MESSAGES, sanitizeFilename } from "@/lib/storage";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Ressources auxquelles une pièce jointe peut se rattacher.
 *
 * Liste blanche, et non champ libre : `host` détermine le droit exigé pour
 * lire le fichier. Laisser l'appelant inventer un nom de ressource
 * reviendrait à le laisser choisir la serrure de sa propre porte.
 */
const HOSTS = new Set([
  "contracts", "subscriptions", "invoices", "devis", "commandes", "marches",
  "expenses", "projects", "employees", "clients", "suppliers", "payslips",
  "treasuryAccounts", "documents",
]);

const CATEGORIES = new Set([
  "contrat", "avenant", "facture", "justificatif", "releve", "courrier", "autre",
]);

/** GET /api/attachments?host=contracts&hostId=… — les pièces d'un document. */
export const GET = withAuth("documents", "read", async (req: NextRequest, auth: TokenPayload) => {
  const url = new URL(req.url);
  const host = url.searchParams.get("host") || "";
  const hostId = url.searchParams.get("hostId") || "";

  if (!HOSTS.has(host) || !hostId) {
    return badRequest("Document porteur non reconnu.");
  }
  // Le droit exigé est celui du document porteur, pas un droit « pièces
  // jointes » générique : voir la pièce d'un bulletin de paie suppose de
  // pouvoir voir les bulletins.
  if (!authCan(auth, host, "read")) {
    return forbidden("Vous n'avez pas accès aux documents de ce type.");
  }

  const items = await AttachmentModel.find({ ...tenantFilter(auth), host, hostId })
    .select("-storageKey")   // la clé de stockage ne sort jamais
    .sort({ createdAt: -1 })
    .populate("uploadedBy", "firstName lastName")
    .lean();

  return ok({ items });
});

/** POST /api/attachments — téléversement multipart. */
export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Requête multipart attendue.");

  const file = form.get("file");
  const host = String(form.get("host") || "");
  const hostId = String(form.get("hostId") || "");
  const category = String(form.get("category") || "autre");
  const label = String(form.get("label") || "").trim();
  const lineId = String(form.get("lineId") || "").trim();

  if (!(file instanceof File)) return badRequest("Aucun fichier reçu.");
  if (!HOSTS.has(host) || !hostId) return badRequest("Document porteur non reconnu.");
  if (!CATEGORIES.has(category)) return badRequest("Nature de pièce inconnue.");

  // Joindre une pièce, c'est modifier le document porteur.
  if (!authCan(auth, host, "update")) {
    return forbidden("Vous ne pouvez pas joindre de pièce à ce document.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const check = validate(file.name, file.type, buffer);
  if (!check.ok) return badRequest(STORAGE_MESSAGES[check.error]);

  const stored = await store(auth.tenantId, file.name, check.mime, buffer);

  // Même empreinte, même document porteur : la pièce est déjà là. On le dit
  // plutôt que d'empiler des doublons qu'il faudra trier plus tard.
  const existing = await AttachmentModel.findOne({
    ...tenantFilter(auth), host, hostId, sha256: stored.sha256,
    ...(lineId ? { lineId } : {}),
  }).select("_id filename").lean<{ _id: unknown; filename: string } | null>();
  if (existing) {
    return ok({
      duplicate: true,
      attachment: existing,
      message: `Ce fichier est déjà joint sous le nom « ${existing.filename} ».`,
    });
  }

  const attachment = await AttachmentModel.create({
    tenantId: auth.tenantId,
    host, hostId, category,
    lineId: lineId || undefined,
    label: label || undefined,
    filename: stored.filename,
    mime: stored.mime,
    size: stored.size,
    sha256: stored.sha256,
    storageKey: stored.storageKey,
    uploadedBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "documents", {
    resourceId: String(attachment._id),
    metadata: { host, hostId, filename: sanitizeFilename(file.name), size: stored.size },
  });

  const safe = attachment.toObject();
  delete safe.storageKey;
  return created(safe);
});
