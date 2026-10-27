import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { ClientModel } from "@/models/Client";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { computeInvoiceLines } from "@/lib/invoice-entry";

export const GET = withAuth("devis", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const d = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("clientId", "name code nif").lean();
  if (!d) return notFound(); return ok(d);
});
/**
 * PATCH — contenu (lignes : totaux recalculés côté serveur) et statut
 * (brouillon, envoyé, accepté, refusé, expiré). Un devis transformé en facture
 * ne se modifie plus.
 */
export const PATCH = withAuth("devis", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const d = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!d) return notFound();
  if (d.convertedToInvoiceId) return badRequest("Devis déjà transformé en facture : il ne se modifie plus.");
  // Le lien vers un marché et la preuve d'acceptation en ligne ne se
  // modifient pas ici : défaire `contractId` réautorisait la transformation en
  // facture, donc une double facturation du marché.
  if (d.contractId) return badRequest("Devis transformé en marché : il ne se modifie plus.");
  const update = sanitizeBody(body, ["number", "status", "totalHT", "totalTVA", "totalTTC", "convertedToInvoiceId", "contractId", "projectId", "acceptedOnline", "createdBy"]);
  if (update.clientId !== undefined && String(update.clientId) !== String(d.clientId)
    && !(await ClientModel.exists({ _id: update.clientId, ...tenantFilter(auth) }))) return badRequest("Client introuvable.");
  if (Array.isArray(update.lines)) {
    if (update.lines.length === 0) return badRequest("Au moins une ligne.");
    const t = computeInvoiceLines(update.lines as never);
    update.lines = t.lines; update.totalHT = t.totalHT; update.totalTVA = t.totalTVA; update.totalTTC = t.totalHT + t.totalTVA;
  }
  if (body.status !== undefined) {
    if (!["draft", "sent", "accepted", "rejected", "expired"].includes(String(body.status))) return badRequest("Statut invalide.");
    update.status = body.status;
  }
  d.set(update);
  await d.save();
  await logAudit(auth, "UPDATE", "devis", { resourceId: params.id });
  return ok(d);
});

/** DELETE — supprime un devis non transformé en facture. */
export const DELETE = withAuth("devis", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const d = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!d) return notFound();
  if (d.convertedToInvoiceId) return badRequest("Devis transformé en facture : il est conservé.");
  await DevisModel.deleteOne({ _id: d._id });
  await logAudit(auth, "DELETE", "devis", { resourceId: params.id, before: { number: d.number } });
  return ok({ deleted: true });
});

// La transformation en facture passe par POST /api/devis/:id/to-invoice
// (numérotation continue dans la transaction, contrôle du marché lié).
// L'ancienne route POST /api/devis/:id numérotait par comptage, hors
// transaction, et ignorait un devis déjà transformé en marché : supprimée.
