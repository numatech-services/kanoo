import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok } from "@/lib/api-helpers";
import { PaymentModel } from "@/models/Payment";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET ?annee=AAAA — retenues à la source subies sur les encaissements de
 * l'année (marchés publics) : acomptes d'impôt imputables sur l'IS/BIC.
 */
export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  const year = Number(new URL(req.url).searchParams.get("annee")) || new Date().getFullYear();
  const items = await PaymentModel.find({
    tenantId: new Types.ObjectId(auth.tenantId), status: "effective", withholdingAmount: { $gt: 0 },
    date: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
  }).populate({ path: "invoiceId", select: "number clientId", populate: { path: "clientId", select: "name" } })
    .sort({ date: -1 }).lean<Array<{ _id: unknown; date: Date; amount: number; withholdingAmount: number; invoiceId?: { number?: string; clientId?: { name?: string } } }>>();
  return ok({
    year,
    total: items.reduce((t, p) => t + p.withholdingAmount, 0),
    items: items.map(p => ({ _id: p._id, date: p.date, net: p.amount, withheld: p.withholdingAmount,
      invoiceNumber: p.invoiceId?.number, client: p.invoiceId?.clientId?.name })),
  });
});
