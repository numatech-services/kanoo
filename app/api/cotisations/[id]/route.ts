import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { MembershipModel } from "@/models/Membership";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { withTransaction } from "@/lib/db";
import { postMembership, unpost } from "@/lib/association-posting";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("cotisations", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await MembershipModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});

/**
 * PATCH — montant, moyen de paiement, encaissement. Marquer payée comptabilise
 * la cotisation sur le compte encaisseur ; la repasser à « non payée » extourne.
 * Le montant d'une cotisation déjà comptabilisée ne se modifie plus.
 */
export const PATCH = withAuth("cotisations", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const m = await MembershipModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!m) return notFound();
  if ("amount" in body && Number(body.amount) !== m.amount) {
    if (m.entryId) return badRequest("Cotisation déjà encaissée : repassez-la à « non payée » avant d'en changer le montant.");
    if (!(Number(body.amount) > 0)) return badRequest("Montant invalide");
    m.amount = Math.round(Number(body.amount));
  }
  if ("paymentMethod" in body) m.paymentMethod = String(body.paymentMethod ?? "").slice(0, 40);
  if ("treasuryAccountId" in body && body.treasuryAccountId) {
    if (!(await TreasuryAccountModel.exists({ _id: body.treasuryAccountId, ...tenantFilter(auth) }))) return badRequest("Compte de trésorerie introuvable");
    if (!m.entryId) m.treasuryAccountId = body.treasuryAccountId;
  }
  await withTransaction(async session => {
    if ("paid" in body) {
      if (body.paid && !m.paidAt) {
        m.paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
        await postMembership(auth, m, session);
      } else if (!body.paid && m.paidAt) {
        await unpost(auth, m, "Cotisation repassée à non payée", session);
        m.paidAt = undefined;
      }
    }
    await m.save({ session });
  });
  await logAudit(auth, "UPDATE", "cotisations", { resourceId: params.id });
  return ok(m);
});

export const DELETE = withAuth("cotisations", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const m = await MembershipModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!m) return noContent();
  await withTransaction(async session => {
    await unpost(auth, m, "Cotisation supprimée", session);
    await MembershipModel.deleteOne({ _id: m._id }, { session });
  });
  await logAudit(auth, "DELETE", "cotisations", { resourceId: params.id });
  return noContent();
});
