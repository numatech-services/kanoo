import { NextRequest } from "next/server";
import { contractScope } from "@/lib/contract-input";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { assessContractRegistration, assessReceptionStamp, payContractRegistration, cancelContractRegistration, registrationEstimate } from "@/lib/registration-server";
import { BUYER_TYPES, INSTRUMENTS } from "@/lib/registration";

export const dynamic = "force-dynamic";

/** GET — droits estimés (CGI art. 470-584) et état du constat / paiement. */
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Réservé au gérant et à la comptabilité.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const c = await ContractModel.findOne({ _id: params.id, ...contractScope(auth) })
    .select("type amount buyerType clientId instrument isSubcontract pages approvalDate signedDate receptionDefinitiveDate registration reference").lean<{ amount: number; registration?: unknown } & Record<string, unknown> | null>();
  if (!c) return notFound("Marché introuvable");
  return ok({ estimate: await registrationEstimate(auth.tenantId, c as Parameters<typeof registrationEstimate>[1]), registration: c.registration ?? null, buyerTypes: BUYER_TYPES, instruments: INSTRUMENTS });
});

/**
 * POST { action } :
 *  - "assess" : constate droit et timbres (646 / 447300), échéance approbation + 1 mois ;
 *  - "reception_stamp" : timbre de 25 000 FCFA sur le PV de réception définitive ;
 *  - "pay" { treasuryAccountId, date, amount?, number?, registrationDate? } : paiement à la recette ;
 *  - "cancel" { reason } : annule un constat non payé.
 */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Réservé au gérant et à la comptabilité.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  if (!(await ContractModel.exists({ _id: params.id, ...contractScope(auth) }))) return notFound("Marché introuvable");
  const body = await req.json().catch(() => ({}));
  const actor = { tenantId: auth.tenantId, userId: auth.userId };
  try {
    let result: unknown;
    if (body.action === "assess") result = await withTransaction(s => assessContractRegistration(actor, params.id, body, s));
    else if (body.action === "reception_stamp") result = await withTransaction(s => assessReceptionStamp(actor, params.id, s));
    else if (body.action === "pay") result = await withTransaction(s => payContractRegistration(actor, params.id, body, s));
    else if (body.action === "cancel") {
      const reason = String(body.reason ?? "").trim();
      if (!reason) return badRequest("Indiquez le motif de l'annulation.");
      await withTransaction(s => cancelContractRegistration(actor, params.id, reason, s));
      result = { cancelled: true };
    } else return badRequest("Action inconnue (assess, reception_stamp, pay, cancel).");
    await logAudit(auth, "UPDATE", "contracts", { resourceId: params.id, metadata: { registration: body.action } });
    return ok(result);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
