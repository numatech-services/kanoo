import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { computeCockpit } from "@/lib/cockpit";

export const dynamic = "force-dynamic";

/** GET ?year= — cockpit consolidé de l'organisation. */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const y = Number(new URL(req.url).searchParams.get("year")) || new Date().getUTCFullYear();
  return ok(await computeCockpit(auth.tenantId, Math.min(2100, Math.max(2000, y))));
});
