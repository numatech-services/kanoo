import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { alertsBoard } from "@/lib/alerts-server";

export const dynamic = "force-dynamic";

/** GET /api/alerts/board — bloc « Alertes et échéances » des tableaux de bord écrits côté client (administration, association). */
export const GET = withAuth("alerts", "read", async (_req: NextRequest, auth: TokenPayload) => {
  return ok(await alertsBoard(auth, r => authCan(auth, r)));
});
