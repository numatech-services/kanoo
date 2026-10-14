import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { contractRetention, releaseRetention, cancelRetentionRelease } from "@/lib/retention-server";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET — retenue de garantie du marché : retenu, reversé, reste, date de réclamation, factures concernées, reversements. */
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("retentionRate retentionReleases receptionProvisoireDate receptionDefinitiveDate guaranteeMonths").lean<{ _id: unknown; retentionRate?: number; retentionReleases?: Array<{ amount: number }> } | null>();
  if (!contract) return notFound("Marché introuvable");
  const state = await contractRetention(auth.tenantId, contract);
  return ok({ ...state, rate: contract.retentionRate ?? 0, releases: contract.retentionReleases ?? [] });
});

/** POST { amount?, date?, treasuryAccountId, reference? } — le client a reversé tout ou partie de la retenue. */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "payments", "create")) return forbidden("Enregistrer un encaissement est réservé à la comptabilité et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const r = await withTransaction(session => releaseRetention({ tenantId: auth.tenantId, userId: auth.userId }, params.id, body, session));
    await logAudit(auth, "UPDATE", "contracts", { resourceId: params.id, metadata: { retentionReleased: r.amount } });
    return created(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});

/** DELETE ?releaseId=&reason= — annule un reversement saisi par erreur. */
export const DELETE = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "payments", "delete")) return forbidden("Annuler un encaissement est réservé à la comptabilité et au gérant.");
  await connectDB();
  const url = new URL(req.url);
  const releaseId = url.searchParams.get("releaseId") ?? "";
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) return badRequest("Indiquez le motif de l'annulation.");
  try {
    const r = await withTransaction(session => cancelRetentionRelease({ tenantId: auth.tenantId, userId: auth.userId }, params.id, releaseId, reason, session));
    await logAudit(auth, "UPDATE", "contracts", { resourceId: params.id, metadata: { retentionReleaseCancelled: r.amount, reason } });
    return ok(r);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
