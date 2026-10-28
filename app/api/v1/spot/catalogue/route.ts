import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { catalogueFor } from "@/lib/easypay-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spot/catalogue — articles et prix du comptoir (Kanoo fait foi).
 * Scope spot:read. ETag : avec If-None-Match, 304 tant que rien n'a changé.
 */
export async function GET(req: NextRequest) {
  const a = await spotContext(req, "spot:read");
  if ("error" in a) return a.error;
  const c = await catalogueFor(a.ctx.tenantId, a.ctx.deskId);
  const etag = `"${c.version}"`;
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return NextResponse.json({ success: true, data: c, api_version: "v1" }, { headers: { ETag: etag, "Cache-Control": "no-store" } });
}
