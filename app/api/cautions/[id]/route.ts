import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, noContent, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { deleteGuarantee } from "@/lib/guarantees-server";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth("appels", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const g = await BankGuaranteeModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("appelId", "title reference").populate("contractId", "reference title").populate("treasuryAccountId", "label").lean();
  return g ? ok(g) : notFound("Caution introuvable");
});

/** PATCH { reference?, bankName?, beneficiary?, notes? } — champs sans effet comptable (l'échéance passe par /extend). */
export const PATCH = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const g = Types.ObjectId.isValid(params.id) ? await BankGuaranteeModel.findOne({ _id: params.id, ...tenantFilter(auth) }) : null;
  if (!g) return notFound("Caution introuvable");
  for (const f of ["reference", "bankName", "beneficiary", "notes"] as const) if (f in body) g.set(f, String(body[f] ?? "").trim().slice(0, f === "notes" ? 2000 : 200) || undefined);
  if (!g.beneficiary) return badRequest("Le bénéficiaire est obligatoire.");
  // L'échéance ne change que par la prorogation (avec ses frais éventuels) : POST /extend.

  await g.save();
  await logAudit(auth, "UPDATE", "appels", { resourceId: params.id, metadata: { guarantee: true } });
  return ok(g);
});

/** DELETE — saisie erronée d'une caution en cours : commission et dépôt extournés. */
export const DELETE = withAuth("appels", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Supprimer une caution comptabilisée est réservé au gérant et à la comptabilité.");
  await connectDB();
  try {
    await withTransaction(session => deleteGuarantee({ tenantId: auth.tenantId, userId: auth.userId }, params.id, session));
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
  await logAudit(auth, "DELETE", "appels", { resourceId: params.id, metadata: { guarantee: true } });
  return noContent();
});
