import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, forbidden, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { sealTenant, matchAnchor, verifyTenantCached } from "@/lib/audit-seal";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET ?kind=entries|audit&seq=&hash= — compare la chaîne à une empreinte notée
 * hors de l'application (rapport mensuel reçu par courriel).
 */
export const GET = withAuth("auditLogs", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!hasFinanceAccess(auth) && !hasTenantAdminRole({ role: auth.role, roles: auth.roles })) return forbidden("Réservé au gérant et à la comptabilité.");
  await connectDB();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "audit" ? "audit" : "entries";
  const seq = Number(url.searchParams.get("seq"));
  const hash = String(url.searchParams.get("hash") ?? "");
  if (!Number.isInteger(seq) || seq < 1 || !/^[0-9a-fA-F]{64}$/.test(hash.trim())) return badRequest("Indiquez le numéro du sceau et l'empreinte (64 caractères).");
  return ok(await matchAnchor(auth.tenantId, kind, seq, hash));
});

/** POST — scelle tout de suite les pièces en attente (administrateur). */
export const POST = withAuth("auditLogs", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!hasTenantAdminRole({ role: auth.role, roles: auth.roles })) return forbidden("Réservé à l'administrateur de l'organisation.");
  try {
    const entries = await sealTenant(auth.tenantId, "entries");
    const audit = await sealTenant(auth.tenantId, "audit");
    await verifyTenantCached(auth.tenantId, "entries", { force: true });
    await verifyTenantCached(auth.tenantId, "audit", { force: true });
    await logAudit(auth, "CREATE", "auditSeals", { metadata: { entries, audit } });
    return ok({ entries, audit });
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Scellement impossible.");
  }
});
