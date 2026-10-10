import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { invoiceMarket, type MarketContract } from "@/lib/market-invoice";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST — { mode: "deposit" | "standard", amountHT? | rate?, milestoneId?, deductDeposits?, description?, tvaRate? }
 * Facture d'acompte, facture d'une échéance, ou facture du marché déduisant les acomptes.
 */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const exists = await ContractModel.exists({ _id: params.id, ...tenantFilter(auth) });
  if (!exists) return notFound("Marché introuvable");
  const invoice = await withTransaction(async session => {
    const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }).session(session ?? null);
    return invoiceMarket(auth, contract as unknown as MarketContract, body, session);
  });
  await logAudit(auth, "CREATE", "invoices", { resourceId: String(invoice._id), metadata: { contract: params.id, kind: invoice.kind, totalTTC: invoice.totalTTC } });
  return created({ invoice, message: `${invoice.kind === "deposit" ? "Facture d'acompte" : "Facture"} ${invoice.number} créée (brouillon).` });
});
