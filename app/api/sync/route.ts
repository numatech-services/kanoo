import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";

// POST /api/sync — Point d'entrée pour rejouer les mutations offline
// Le service worker appelle cet endpoint avec x-offline-sync: true
export const POST = withAuth("companies", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const isOfflineSync = req.headers.get("x-offline-sync") === "true";

  // Journaliser la sync pour monitoring
  if (isOfflineSync) {
    console.log(`[Sync] Tenant ${auth.tenantId} — ${body.count || 0} éléments rejoués depuis ${body.deviceId || "unknown"}`);
  }

  return ok({
    synced: true,
    tenantId: auth.tenantId,
    serverTime: new Date().toISOString(),
    message: "Synchronisation acceptée",
  });
});

// GET /api/sync — Vérifier le statut serveur (healthcheck offline)
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  return ok({
    online: true,
    serverTime: new Date().toISOString(),
    tenantId: auth.tenantId,
  });
});
