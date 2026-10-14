import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api-helpers";
import { dailyBrief } from "@/lib/daily-brief-server";
import { authCan } from "@/lib/role-resources";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?limit=3 — brief du jour de l'utilisateur (actions priorisées et expliquées). */
export const GET = withAuth("notifications", "read", async (req: NextRequest, auth: TokenPayload) => {
  const limit = Math.min(10, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 3));
  return ok(await dailyBrief(auth, (resource, action = "read") => authCan(auth, resource, action), limit));
});
