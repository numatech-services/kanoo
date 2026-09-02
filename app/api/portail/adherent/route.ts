import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verify } from "jsonwebtoken";
import { MemberModel } from "@/models/Member";
import { MembershipModel } from "@/models/Membership";
import { GeneralAssemblyModel } from "@/models/GeneralAssembly";

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
  if (!auth || auth.type !== "adherent") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [member, cotisations, assemblees] = await Promise.all([
    MemberModel.findById(auth.id).select("firstName lastName code membershipType status joinDate email phone").lean(),
    MembershipModel.find({ memberId: auth.id }).sort({ year: -1 }).limit(10).lean(),
    GeneralAssemblyModel.find({ tenantId: auth.tenantId }).sort({ date: -1 }).limit(5).select("title type date location decisions").lean(),
  ]);

  const cotisationsPaid = cotisations.filter(c => c.paidAt).length;
  const cotisationsPending = cotisations.filter(c => !c.paidAt).length;

  return NextResponse.json({
    success: true,
    data: { member, cotisations, cotisationsPaid, cotisationsPending, assemblees }
  });
}
