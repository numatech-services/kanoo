import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verifyPortalToken } from "@/lib/portal-auth";
import { SupplierModel } from "@/models/Supplier";
import { PublicTenderModel } from "@/models/PublicTender";
import { ContractModel } from "@/models/Contract";

// Route API authentifiée et liée à la base : jamais prérendue statiquement.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = verifyPortalToken(req);
  if (!auth || auth.type !== "fournisseur") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  await connectDB();

  const [supplier, openTenders, contracts] = await Promise.all([
    SupplierModel.findOne({ _id: auth.id, tenantId: auth.tenantId })
      .select("name code nif rccm address phone email isActive").lean(),
    PublicTenderModel.find({ tenantId: auth.tenantId, status: { $in: ["published", "open"] } })
      .select("reference object estimatedAmount procedure bidsDeadline status").sort({ bidsDeadline: 1 }).lean(),
    ContractModel.find({ tenantId: auth.tenantId, supplierId: auth.id })
      .select("reference title status amount startDate endDate").sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  if (!supplier) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  return NextResponse.json({
    success: true,
    data: { supplier, openTenders, contracts }
  });
}
