import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Liste des comptoirs (The Spot et autres points d'activité).
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  filter.archived = url.searchParams.get("archived") === "1" ? true : { $ne: true };
  const items = await ActivityDeskModel.find(filter).sort({ createdAt: 1 }).lean();
  return ok(items);
});

// Création d'un comptoir — c'est ainsi qu'on « lance » une activité (The Spot).
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["name"]);
  if (err) return badRequest(err);
  const desk = await ActivityDeskModel.create({
    tenantId: auth.tenantId,
    name: String(body.name).slice(0, 120).trim(),
    description: String(body.description || "").slice(0, 400),
    activityId: body.activityId || undefined,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: desk._id.toString(), metadata: { name: desk.name } });
  return created(desk);
});
