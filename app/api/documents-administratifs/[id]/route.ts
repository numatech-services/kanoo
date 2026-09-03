import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { AdminDocumentModel } from "@/models/AdminDocument";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/admin-documents";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const doc = await AdminDocumentModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("renewalStartedBy", "firstName lastName").lean();
  if (!doc) return notFound("Document introuvable");
  return ok(doc);
});

/**
 * PATCH — modifier, engager le renouvellement, ou remplacer.
 *
 *   { renewalStarted: true, notes }   la démarche est partie
 *   { renewalStarted: false }         elle est abandonnée, l'alerte revient
 *   { renewedUntil: "2027-03-01" }    le nouveau document est arrivé
 */
export const PATCH = withAuth("documents", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const doc = await AdminDocumentModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!doc) return notFound("Document introuvable");

  // ── Renouvellement obtenu ────────────────────────────────────────────────
  //
  // Le document conserve son identité et avance son échéance, plutôt que d'en
  // créer un nouveau : on garde ainsi l'historique des renouvellements sous
  // une seule fiche, et les pièces jointes restent rattachées.
  if (body.renewedUntil) {
    const until = new Date(body.renewedUntil);
    if (Number.isNaN(until.getTime())) return badRequest("Nouvelle échéance invalide.");
    if (doc.expiresAt && until <= doc.expiresAt) {
      return badRequest("La nouvelle échéance doit être postérieure à l'ancienne.");
    }
    doc.issuedAt = body.renewedOn ? new Date(body.renewedOn) : new Date();
    doc.expiresAt = until;
    doc.renewalStartedAt = undefined;
    doc.renewalStartedBy = undefined;
    doc.renewalNotes = undefined;
    if (body.reference) doc.reference = String(body.reference).slice(0, 120);
    await doc.save();

    await logAudit(auth, "UPDATE", "documents", {
      resourceId: String(params.id),
      metadata: { action: "renewed", until: until.toISOString() },
    });
    return ok({ document: doc, message: `Échéance reportée au ${until.toLocaleDateString("fr-FR")}.` });
  }

  // ── Démarche engagée ou abandonnée ───────────────────────────────────────
  if (body.renewalStarted !== undefined) {
    if (body.renewalStarted) {
      doc.renewalStartedAt = new Date();
      doc.renewalStartedBy = auth.userId;
      doc.renewalNotes = body.notes ? String(body.notes).slice(0, 1000) : undefined;
    } else {
      doc.renewalStartedAt = undefined;
      doc.renewalStartedBy = undefined;
    }
    await doc.save();
    await logAudit(auth, "UPDATE", "documents", {
      resourceId: String(params.id),
      metadata: { action: body.renewalStarted ? "renewal_started" : "renewal_cancelled" },
    });
    return ok({
      document: doc,
      message: body.renewalStarted
        ? "Démarche engagée. L'alerte se taira jusqu'aux derniers jours avant l'échéance."
        : "Démarche annulée : l'alerte reprend.",
    });
  }

  // ── Archivage ────────────────────────────────────────────────────────────
  if (body.archived !== undefined) {
    doc.archivedAt = body.archived ? new Date() : undefined;
    await doc.save();
    return ok({ document: doc, message: body.archived ? "Document archivé." : "Document réactivé." });
  }

  // ── Modification ordinaire ───────────────────────────────────────────────
  if (body.label !== undefined) doc.label = String(body.label).trim().slice(0, 200);
  if (body.type !== undefined) {
    if (!(String(body.type) in DOCUMENT_TYPES)) return badRequest("Nature de document inconnue.");
    doc.type = String(body.type) as DocumentType;
  }
  if (body.reference !== undefined) doc.reference = String(body.reference).slice(0, 120);
  if (body.issuer !== undefined) doc.issuer = String(body.issuer).slice(0, 160);
  if (body.issuedAt !== undefined) doc.issuedAt = body.issuedAt ? new Date(body.issuedAt) : undefined;
  if (body.expiresAt !== undefined) doc.expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
  if (body.leadTimeDays !== undefined) {
    doc.leadTimeDays = body.leadTimeDays === "" || body.leadTimeDays === null
      ? undefined : Math.max(0, Number(body.leadTimeDays) || 0);
  }
  if (body.notes !== undefined) doc.notes = String(body.notes).slice(0, 2000);

  if (doc.expiresAt && doc.issuedAt && doc.expiresAt < doc.issuedAt) {
    return badRequest("L'échéance précède la date de délivrance.");
  }

  await doc.save();
  await logAudit(auth, "UPDATE", "documents", { resourceId: String(params.id) });
  return ok({ document: doc });
});

export const DELETE = withAuth("documents", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const doc = await AdminDocumentModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: { archivedAt: new Date() } },
    { new: true }
  );
  if (!doc) return notFound("Document introuvable");

  // Archivage plutôt que suppression : un document périmé reste une pièce de
  // l'histoire administrative, et sert à prouver ce qui était valable à une
  // date donnée.
  await logAudit(auth, "DELETE", "documents", {
    resourceId: String(params.id), metadata: { action: "archived", label: doc.label },
  });
  return ok({ archived: true, message: "Document archivé. Il reste consultable dans l'historique." });
});
