import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
export const POST = withAuth("devis", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const devis = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!devis) return notFound();
  if (devis.status !== "draft") return badRequest("Seuls les brouillons peuvent être envoyés");
  devis.status = "sent";
  await devis.save();
  await logAudit(auth, "UPDATE", "devis", { resourceId: params.id, after: { status: "sent" } });
  return ok(devis);
});
