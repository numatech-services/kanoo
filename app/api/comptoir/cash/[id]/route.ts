import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, noContent, notFound, tenantFilter } from "@/lib/api-helpers";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { isId, deskFilter } from "@/lib/comptoir";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Écriture introuvable");
  const r = await ActivityCashEntryModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) });
  if (!r) return notFound("Écriture introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id) });
  return noContent();
});
