import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { buildAuditReport } from "@/lib/audit-report";
import { AuditReportSnapshotModel } from "@/models/AuditSeal";

export const dynamic = "force-dynamic";

/**
 * GET ?year=&month=&live=1 — rapport d'audit du mois (par défaut le mois écoulé).
 * Le rapport figé à son émission est rendu tel quel ; `live=1` le recalcule à ce jour.
 * Montants et données personnelles : gérant et comptabilité seulement.
 */
export const GET = withAuth("auditLogs", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!hasFinanceAccess(auth) && !hasTenantAdminRole({ role: auth.role, roles: auth.roles })) return forbidden("Rapport d'audit réservé au gérant et à la comptabilité.");
  await connectDB();
  const url = new URL(req.url);
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = Number(url.searchParams.get("year")) || prev.getUTCFullYear();
  const month = Number(url.searchParams.get("month")) || prev.getUTCMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) return badRequest("Période invalide.");
  const live = url.searchParams.get("live") === "1";
  const snap = await AuditReportSnapshotModel.findOne({ tenantId: new Types.ObjectId(auth.tenantId), year, month }).lean<{ report: unknown; hash: string; generatedAt: Date } | null>();
  // Revue nominative des comptes et clés d'API : administrateur seulement (cibles d'attaque).
  const admin = hasTenantAdminRole({ role: auth.role, roles: auth.roles });
  const redact = <T extends { users?: Record<string, unknown> }>(r: T): T => admin || !r.users ? r : { ...r, users: { ...r.users, list: [], keys: [] } };
  if (snap && !live) return ok(redact({ ...(snap.report as { users?: Record<string, unknown> }), snapshot: { hash: snap.hash, generatedAt: snap.generatedAt } }));
  // Recalcul demandé : vérification complète des sceaux (sinon la dernière, de moins de six heures).
  // Recalcul depuis l'écran : vérification complète au plus toutes les dix minutes.
  const report = await buildAuditReport(auth.tenantId, year, month, now, { forceIntegrity: live, minAgeMs: 600_000 });
  return ok(redact({ ...report, snapshot: snap ? { hash: snap.hash, generatedAt: snap.generatedAt } : null, live: true }));
});
