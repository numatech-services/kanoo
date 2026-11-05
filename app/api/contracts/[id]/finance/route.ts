import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { marketFinance } from "@/lib/market-finance";

export const dynamic = "force-dynamic";

/** GET — situation financière du marché (devis, facturé, acomptes, dépenses, marges). Gérant et comptabilité. */
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!hasFinanceAccess(auth)) return forbidden("Situation financière réservée au gérant et à la comptabilité.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("amount projectId devisId invoiceIds retentionRate retentionReleases receptionProvisoireDate receptionDefinitiveDate guaranteeMonths type buyerType clientId instrument isSubcontract pages approvalDate signedDate registration tvaRate amountTTC paymentDays serviceOrderDate executionDelay executionUnit deliveredAt penaltyDivisor penaltyCapRate regulationRate regulationThreshold lateInterestRate").lean<Parameters<typeof marketFinance>[1] | null>();
  if (!contract) return notFound("Marché introuvable");
  return ok(await marketFinance(auth.tenantId, contract));
});
