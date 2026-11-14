import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { loadDashboard } from "@/lib/dashboard-home";
import { dailyBrief } from "@/lib/daily-brief-server";
import { alertsBoard } from "@/lib/alerts-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/home — les données du tableau de bord en JSON (application
 * mobile). Même calcul que la page web (lib/dashboard-home.ts), mêmes droits :
 * un profil sans factures ni encaissements ne reçoit que son brief du jour.
 */
export const GET = withAuth("notifications", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const can = (resource: string, action: "read" | "create" | "update" | "delete" = "read") => authCan(auth, resource, action);
  const alerts = await alertsBoard(auth, r => can(r)).catch(() => null);
  if (!can("invoices") || !can("payments")) {
    return ok({ limited: true, brief: (await dailyBrief(auth, can, 5)).items, alerts });
  }
  return ok({ limited: false, ...(await loadDashboard(auth, can)), alerts });
});
