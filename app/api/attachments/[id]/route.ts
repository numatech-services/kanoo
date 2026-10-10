import { NextRequest, NextResponse } from "next/server";
import { withAuth, ok, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { AttachmentModel } from "@/models/Attachment";
import { read, remove } from "@/lib/storage";
import { attachmentAccess } from "@/lib/attachment-access";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Row {
  _id: unknown;
  host: string;
  hostId: unknown;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  storageKey: string;
}

/**
 * GET /api/attachments/:id — transmet le fichier.
 *
 * C'est **la seule** porte de sortie des octets. Trois contrôles avant de
 * transmettre : l'organisation, puis le droit de lire le document porteur,
 * puis l'existence du fichier sur disque.
 *
 * Les en-têtes de réponse comptent autant que les contrôles :
 *
 *   • `Content-Disposition: attachment` — le fichier se télécharge, il ne
 *     s'affiche pas dans l'origine de l'application. Un document qui
 *     s'exécuterait dans la page emprunterait la session de son lecteur.
 *   • `X-Content-Type-Options: nosniff` — le navigateur ne doit pas deviner
 *     un type plus permissif que celui qu'on déclare.
 *   • `Cache-Control: private` — un document d'entreprise n'a rien à faire
 *     dans un cache partagé.
 */
export const GET = withAuth("attachments", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const doc = await AttachmentModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<Row | null>();
  if (!doc) return notFound("Pièce jointe introuvable");

  if (!(await attachmentAccess(auth, doc.host, doc.hostId, "read"))) {
    return forbidden("Vous n'avez pas accès aux pièces de ce document.");
  }

  let bytes: Buffer;
  try {
    bytes = await read(doc.storageKey);
  } catch {
    // Le fichier manque alors que la fiche existe : le dire franchement, plutôt
    // que de renvoyer un 500 qui laisserait croire à une panne passagère.
    return notFound("Le fichier n'est plus présent sur le serveur. Signalez-le à votre administrateur.");
  }

  // Le nom part en deux formes : ASCII pour les clients anciens, UTF-8 pour
  // les autres. Sans la seconde, « Reçu février.pdf » arrive mutilé.
  const ascii = doc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const utf8 = encodeURIComponent(doc.filename);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Length": String(doc.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

/**
 * DELETE /api/attachments/:id
 *
 * L'octet n'est effacé que lorsque plus aucune fiche ne porte l'empreinte :
 * le contenu étant partagé entre doublons, supprimer à la première
 * suppression viderait les pièces des autres documents.
 */
export const DELETE = withAuth("attachments", "create", async (_req: NextRequest, auth: TokenPayload, params) => {
  const doc = await AttachmentModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<Row | null>();
  if (!doc) return notFound("Pièce jointe introuvable");

  if (!(await attachmentAccess(auth, doc.host, doc.hostId, "write"))) {
    return forbidden("Vous ne pouvez pas retirer de pièce à ce document.");
  }

  await AttachmentModel.deleteOne({ _id: doc._id, ...tenantFilter(auth) });

  const stillReferenced = await AttachmentModel.countDocuments({
    tenantId: auth.tenantId, sha256: doc.sha256,
  });
  if (stillReferenced === 0) await remove(doc.storageKey);

  await logAudit(auth, "DELETE", "documents", {
    resourceId: String(params.id),
    metadata: { host: doc.host, filename: doc.filename, fileRemoved: stillReferenced === 0 },
  });

  return ok({ deleted: true, fileRemoved: stillReferenced === 0 });
});
