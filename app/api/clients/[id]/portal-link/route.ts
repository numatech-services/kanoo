import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, notFound, noContent } from "@/lib/api-helpers";
import { createPortalLink, revokePortalLink, currentPortalLink } from "@/lib/client-portal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** GET — lien actif du portail de ce client (null s'il n'en a pas). */
export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  return ok({ url: await currentPortalLink(auth.tenantId, params.id) });
});

/** POST — crée le lien, ou le régénère (l'ancien cesse aussitôt de fonctionner). */
export const POST = withAuth("clients", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const link = await createPortalLink(auth.tenantId, params.id);
  if (!link) return notFound("Client introuvable");
  await logAudit(auth, "UPDATE", "clients", { resourceId: params.id, after: { portalLink: "créé" } });
  return ok({ url: link.url });
});

/** DELETE — révoque le lien. */
export const DELETE = withAuth("clients", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  await revokePortalLink(auth.tenantId, params.id);
  await logAudit(auth, "UPDATE", "clients", { resourceId: params.id, after: { portalLink: "révoqué" } });
  return noContent();
});
