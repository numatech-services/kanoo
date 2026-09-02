import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verifyPortalToken } from "@/lib/portal-auth";
import { MemberModel } from "@/models/Member";
import { MembershipModel } from "@/models/Membership";
import { GeneralAssemblyModel } from "@/models/GeneralAssembly";

// Route API authentifiée et liée à la base : jamais prérendue statiquement.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = verifyPortalToken(req);
  if (!auth || auth.type !== "adherent") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  await connectDB();

  // Chaque requête porte `tenantId` en plus de l'identifiant : le jeton dit à
  // quelle organisation appartient l'adhérent, la requête le vérifie.
  const [member, cotisations, assemblees] = await Promise.all([
    MemberModel.findOne({ _id: auth.id, tenantId: auth.tenantId })
      .select("firstName lastName code membershipType status joinDate email phone").lean(),
    MembershipModel.find({ memberId: auth.id, tenantId: auth.tenantId })
      .sort({ year: -1 }).limit(10).lean(),
    GeneralAssemblyModel.find({ tenantId: auth.tenantId })
      .sort({ date: -1 }).limit(5).select("title type date location decisions").lean(),
  ]);

  if (!member) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const cotisationsPaid = cotisations.filter(c => c.paidAt).length;
  const cotisationsPending = cotisations.filter(c => !c.paidAt).length;

  return NextResponse.json({
    success: true,
    data: { member, cotisations, cotisationsPaid, cotisationsPending, assemblees }
  });
}
