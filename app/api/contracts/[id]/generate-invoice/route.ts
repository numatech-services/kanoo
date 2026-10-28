import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, forbidden, ok, tenantFilter, notFound } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { billContractPeriod } from "@/lib/contract-billing";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

/** Facture (brouillon) de la période échue d'un contrat récurrent — même moteur que la facturation automatique. */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  // Les factures sont émises par la comptabilité.
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  if (!(await ContractModel.exists({ _id: params.id, ...tenantFilter(auth) }))) return notFound("Contrat introuvable");
  const body = await req.json().catch(() => ({}));
  const { invoice, contract } = await withTransaction(session =>
    billContractPeriod(auth, params.id, { tvaRate: body.tvaRate === undefined ? undefined : Number(body.tvaRate) }, session));
  await logAudit(auth, "CREATE", "invoices", { resourceId: invoice._id.toString(), metadata: { fromContract: contract.reference } });
  return ok({ invoice, message: `Facture ${invoice.number} générée depuis le contrat ${contract.reference}` });
});
