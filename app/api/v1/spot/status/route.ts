import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { IntegrationEventModel } from "@/models/IntegrationEvent";

export const dynamic = "force-dynamic";

/** GET /api/v1/spot/status — vérification de la liaison : comptoir, droits de la clé, événements en échec. Scope spot:read. */
export async function GET(req: NextRequest) {
  const a = await spotContext(req, "spot:read");
  if ("error" in a) return a.error;
  const [desk, failed, last] = await Promise.all([
    ActivityDeskModel.findOne({ _id: a.ctx.deskId, tenantId: a.ctx.tenantId }).select("name").lean<{ name: string } | null>(),
    IntegrationEventModel.countDocuments({ tenantId: a.ctx.tenantId, deskId: a.ctx.deskId, status: "failed" }),
    IntegrationEventModel.findOne({ tenantId: a.ctx.tenantId, deskId: a.ctx.deskId }).sort({ createdAt: -1 }).select("createdAt").lean<{ createdAt: Date } | null>(),
  ]);
  return NextResponse.json({ success: true, data: {
    desk: { id: a.ctx.deskId, name: desk?.name ?? null }, scopes: a.ctx.scopes,
    failed_events: failed, last_event_at: last?.createdAt ?? null, server_time: new Date().toISOString(),
  }, api_version: "v1" });
}
