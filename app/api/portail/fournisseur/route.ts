import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verify } from "jsonwebtoken";
import { SupplierModel } from "@/models/Supplier";
import { PublicTenderModel } from "@/models/PublicTender";
import { ContractModel } from "@/models/Contract";

// Route API authentifiée et liée à la base : jamais prérendue statiquement.
export const dynamic = "force-dynamic";

function getPortailSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32 && s !== "CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS") return s;
  if (process.env.NODE_ENV !== "production") return "dev-only-insecure-secret-0000000000000000000000000000";
  throw new Error("JWT_SECRET manquant ou invalide (>= 32 caractères requis).");
}

async function verifyPortailToken(req: NextRequest) {
  const token = req.cookies.get("portail_token")?.value || req.headers.get("authorization")?.slice(7);
  if (!token) return null;
  try { return verify(token, getPortailSecret(), { algorithms: ["HS256"] }) as { id: string; tenantId: string; type: string }; }
  catch { return null; }
}

export async function GET(req: NextRequest) {
  await connectDB();
  const auth = await verifyPortailToken(req);
  if (!auth || auth.type !== "fournisseur") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [supplier, openTenders, contracts] = await Promise.all([
    SupplierModel.findById(auth.id).select("name code nif rccm address phone email isActive").lean(),
    PublicTenderModel.find({ tenantId: auth.tenantId, status: { $in: ["published", "open"] } })
      .select("reference object estimatedAmount procedure bidsDeadline status").sort({ bidsDeadline: 1 }).lean(),
    ContractModel.find({ tenantId: auth.tenantId, supplierId: auth.id })
      .select("reference title status amount startDate endDate").sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  return NextResponse.json({
    success: true,
    data: { supplier, openTenders, contracts }
  });
}
