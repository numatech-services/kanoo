import { NextRequest } from "next/server";
import { withAuth, ok, notFound, sanitizeBody } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const tenant = await TenantModel.findById(auth.tenantId).lean();
  if (!tenant) return notFound("Organisation introuvable");
  return ok(tenant);
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  // Le tenant modifie son identité, jamais son abonnement ni sa numérotation.
  // Ni les verrous comptables : une période verrouillée ou un exercice clôturé
  // ne se rouvrent pas par un simple PATCH (la clôture passe par
  // /api/accounting/closing, et une seconde clôture doublerait les à-nouveaux).
  // Ni le compteur de l'assistant IA (contournement du quota).
  const updates = sanitizeBody(body, [
    "plan", "planModules", "disabledModules", "subscriptionStatus", "slug", "type",
    "numberingConfig", "documentSequences", "paymentAttempts",
    "trialEndsAt", "subscriptionEndsAt", "activationToken", "activationTokenExpiry", "activatedAt",
    "accountingLockedUntil", "closedFiscalYears", "aiUsage",
  ]);
  const tenant = await TenantModel.findByIdAndUpdate(auth.tenantId, updates, { new: true });
  if (!tenant) return notFound();
  await logAudit(auth, "UPDATE", "companies", { resourceId: auth.tenantId });
  return ok(tenant);
});
