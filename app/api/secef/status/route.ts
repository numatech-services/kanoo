import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { InvoiceModel } from "@/models/Invoice";
import { secefStatus, readinessChecklist } from "@/lib/secef";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/secef/status — état de la certification pour cette organisation.
 *
 * Les compteurs sont mesurés sur les factures réelles : combien sont
 * certifiées, combien ne le sont pas. Un écran de conformité qui affiche des
 * voyants sans compter les documents ne prouve rien.
 */
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();

  const tenant = await TenantModel.findById(auth.tenantId)
    .select("nif secef").lean<{ nif?: string; secef?: { isf?: string; mcfId?: string; certifiedSince?: Date } } | null>();

  const identity = {
    nif: tenant?.nif,
    isf: tenant?.secef?.isf,
    mcfId: tenant?.secef?.mcfId,
    certifiedSince: tenant?.secef?.certifiedSince ?? null,
  };

  // Les brouillons ne sont pas concernés : ils ne sont pas encore émis.
  const issued = { ...tenantFilter(auth), status: { $nin: ["draft", "cancelled"] } };
  const [total, certified] = await Promise.all([
    InvoiceModel.countDocuments(issued),
    InvoiceModel.countDocuments({ ...issued, "secef.code": { $exists: true, $ne: null } }),
  ]);

  return ok({
    identity,
    ...secefStatus(),
    checklist: readinessChecklist(identity),
    invoices: {
      issued: total,
      certified,
      pending: total - certified,
      coverage: total > 0 ? Math.round((certified / total) * 100) : null,
    },
  });
});

/** PATCH /api/secef/status — enregistre l'identité de facturation certifiée. */
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const clean = sanitizeBody(body);

  const isf = clean.isf === undefined ? undefined : String(clean.isf).trim();
  const mcfId = clean.mcfId === undefined ? undefined : String(clean.mcfId).trim();
  const nif = clean.nif === undefined ? undefined : String(clean.nif).trim();

  if (nif !== undefined && nif.length > 0 && nif.length < 4) {
    return badRequest("NIF invalide.");
  }

  const updates: Record<string, unknown> = {};
  if (nif !== undefined) updates.nif = nif;
  if (isf !== undefined) updates["secef.isf"] = isf || undefined;
  if (mcfId !== undefined) updates["secef.mcfId"] = mcfId || undefined;
  if (clean.certifiedSince) updates["secef.certifiedSince"] = new Date(String(clean.certifiedSince));

  await TenantModel.updateOne({ _id: auth.tenantId }, { $set: updates });

  await logAudit(auth, "UPDATE", "companies", {
    resourceId: auth.tenantId,
    metadata: { action: "secef_identity_updated" },
  });

  return ok({ updated: Object.keys(updates) });
});
