import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AdminDocumentModel } from "@/models/AdminDocument";
import {
  DOCUMENT_TYPES, buildAlerts, summarize, statusOf, renewalStartDate, leadTimeFor,
  suggestedExpiry, type DocumentType, type AdminDocumentLike,
} from "@/lib/admin-documents";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Row = AdminDocumentLike & { _id: unknown };

export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const documents = await AdminDocumentModel.find({ ...tenantFilter(auth), archivedAt: { $exists: false } })
    .sort({ expiresAt: 1 })
    .limit(1_000)
    .lean<Row[]>();

  const asOf = new Date();

  // L'état, la date de lancement et le délai sont calculés à la lecture, pas
  // stockés : un délai corrigé doit se répercuter immédiatement sur tout le
  // portefeuille, pas au prochain enregistrement de chaque fiche.
  const items = documents.map(doc => ({
    ...doc,
    status: statusOf(doc, asOf),
    renewalStartDate: renewalStartDate(doc),
    effectiveLeadTime: leadTimeFor(doc),
  }));

  return ok({
    items,
    alerts: buildAlerts(documents, asOf),
    summary: summarize(documents, asOf),
    types: DOCUMENT_TYPES,
  });
});

export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));

  const label = String(body.label || "").trim();
  const type = String(body.type || "") as DocumentType;
  if (!label) return badRequest("Donnez un intitulé à ce document.");
  if (!(type in DOCUMENT_TYPES)) return badRequest("Nature de document inconnue.");

  const issuedAt = body.issuedAt ? new Date(body.issuedAt) : undefined;
  // L'échéance est suggérée quand elle se déduit, jamais imposée : une
  // attestation peut porter une durée particulière.
  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt)
    : (issuedAt ? suggestedExpiry(type, issuedAt) : null);

  if (expiresAt && issuedAt && expiresAt < issuedAt) {
    return badRequest("L'échéance précède la date de délivrance.");
  }

  const doc = await AdminDocumentModel.create({
    tenantId: auth.tenantId,
    label,
    type,
    reference: body.reference ? String(body.reference).slice(0, 120) : undefined,
    issuer: body.issuer ? String(body.issuer).slice(0, 160) : undefined,
    issuedAt,
    expiresAt: expiresAt ?? undefined,
    leadTimeDays: body.leadTimeDays !== undefined && body.leadTimeDays !== ""
      ? Math.max(0, Number(body.leadTimeDays) || 0) : undefined,
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
    linkedTo: body.linkedTo ? String(body.linkedTo) : undefined,
    linkedId: body.linkedId || undefined,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "documents", {
    resourceId: String(doc._id),
    metadata: { module: "documents-administratifs", type, label },
  });

  return created(doc);
});
