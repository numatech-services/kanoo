import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { previewNextNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// Validation des préfixes (alphanum + tiret/slash, max 10 chars)
function validatePrefix(p: string): boolean {
  return /^[A-Z0-9/\-]{1,10}$/.test(p);
}

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const tenant = await TenantModel.findById(auth.tenantId).select("numberingConfig").lean();
  const cfg = (tenant as {numberingConfig?: Record<string,unknown>})?.numberingConfig || {};

  // Ajouter les prévisualisations
  const previews = await Promise.all([
    previewNextNumber(auth.tenantId, "invoice"),
    previewNextNumber(auth.tenantId, "quote"),
    previewNextNumber(auth.tenantId, "order"),
    previewNextNumber(auth.tenantId, "delivery"),
    previewNextNumber(auth.tenantId, "contract"),
  ]);

  return ok({
    config: cfg,
    previews: {
      invoice:  previews[0],
      quote:    previews[1],
      order:    previews[2],
      delivery: previews[3],
      contract: previews[4],
    },
  });
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();

  // Valider les préfixes
  const prefixFields = ["invoicePrefix", "quotePrefix", "orderPrefix", "deliveryPrefix", "contractPrefix"];
  for (const field of prefixFields) {
    if (body[field] !== undefined && !validatePrefix(body[field])) {
      return badRequest(`Préfixe invalide: ${field} — max 10 caractères, lettres majuscules, chiffres, - ou / uniquement`);
    }
  }

  if (body.digitCount !== undefined && (body.digitCount < 3 || body.digitCount > 8)) {
    return badRequest("digitCount doit être entre 3 et 8");
  }
  if (body.separator !== undefined && !["−", "-", "/", "_", "."].includes(body.separator)) {
    return badRequest("Séparateur invalide — utilisez -, /, _ ou .");
  }

  // Construire l'objet de mise à jour
  const update: Record<string, unknown> = {};
  const allowed = [...prefixFields, "separator", "digitCount", "yearInNumber", "resetYearly", "invoiceStartAt"];
  for (const key of allowed) {
    if (body[key] !== undefined) update[`numberingConfig.${key}`] = body[key];
  }

  await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: update });

  await logAudit(auth, "UPDATE", "companies", {
    resourceId: auth.tenantId,
    after: { numberingConfig: update },
  });

  return ok({ message: "Configuration de numérotation mise à jour" });
});
