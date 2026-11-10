import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { startExport, exportChunk, completeExport, restartAccounting, restartPreview } from "@/lib/accounting-restart";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Réservé au gérant : il administre les utilisateurs et voit la comptabilité. */
const allowed = (auth: TokenPayload) => hasFinanceAccess(auth) && authCan(auth, "users", "update");
const NO = "Reprise de la comptabilité : réservée au gérant.";

/** GET — ce qui serait effacé, et ce qui empêche l'effacement. */
export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload) => {
  if (!allowed(auth)) return forbidden(NO);
  await connectDB();
  return ok(await restartPreview(auth.tenantId));
});

/**
 * POST { action } :
 *  - export-start : heure de coupure et inventaire des collections ;
 *  - export-chunk { exportId, collection, after? } : un paquet de mille documents ;
 *  - export-complete { exportId, counts, hash } : archive reçue et enregistrée ;
 *  - restart { exportId, exportHash, confirm: "REPRENDRE" } : efface comptabilité, trésorerie et caisses.
 */
export const POST = withAuth("accountingEntries", "delete", async (req: NextRequest, auth: TokenPayload) => {
  if (!allowed(auth)) return forbidden(NO);
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "export-start": {
        const r = await startExport(auth);
        await logAudit(auth, "EXPORT", "accountingEntries", { resourceId: r.exportId, metadata: { tenantExport: "start", collections: r.collections.length } });
        return ok(r);
      }
      case "export-chunk": return ok(await exportChunk(auth, body));
      case "export-complete": {
        const r = await completeExport(auth, body);
        await logAudit(auth, "EXPORT", "accountingEntries", { resourceId: r.exportId, metadata: { tenantExport: "complete", documents: r.documents, hash: body.hash } });
        return ok(r);
      }
      default: {
        const r = await restartAccounting(auth, body);
        await logAudit(auth, "DELETE", "accountingEntries", { metadata: { accountingRestart: r.restartDate, deleted: r.deleted, exportHash: r.exportHash } });
        return ok(r);
      }
    }
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
