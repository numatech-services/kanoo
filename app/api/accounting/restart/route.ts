import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { exportTenantData, restartAccounting, restartPreview } from "@/lib/accounting-restart";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Réservé au gérant : il administre les utilisateurs et voit la comptabilité. */
const allowed = (auth: TokenPayload) => hasFinanceAccess(auth) && authCan(auth, "users", "update");
const NO = "Reprise de la comptabilité : réservée au gérant.";

/** GET — ce qui serait effacé ; ?export=1 — archive complète de l'organisation (zip). */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!allowed(auth)) return forbidden(NO);
  await connectDB();
  if (new URL(req.url).searchParams.get("export") !== "1") return ok(await restartPreview(auth.tenantId));
  const { buffer, exportId, exportHash, counts } = await exportTenantData(auth);
  await logAudit(auth, "EXPORT", "accountingEntries", { resourceId: exportId, metadata: { tenantExport: true, exportHash, collections: Object.keys(counts).length } });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="kanoo-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      "X-Export-Id": exportId, "X-Export-Hash": exportHash, "Cache-Control": "no-store",
    },
  });
});

/** POST { exportId, exportHash, confirm: "REPRENDRE" } — efface comptabilité, trésorerie et caisses. */
export const POST = withAuth("accountingEntries", "delete", async (req: NextRequest, auth: TokenPayload) => {
  if (!allowed(auth)) return forbidden(NO);
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const r = await restartAccounting(auth, body);
    await logAudit(auth, "DELETE", "accountingEntries", { metadata: { accountingRestart: r.restartDate, deleted: r.deleted, exportHash: r.exportHash } });
    return ok(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
