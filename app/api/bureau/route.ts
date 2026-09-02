import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  created, 
  badRequest, 
  getPagination, 
  paginatedResponse, 
  tenantFilter, 
  requireFields 
} from "@/lib/api-helpers";

// Import de tous les modèles impliqués dans le populate
import { BureauMemberModel } from "@/models/BureauMember";
import { ProjectModel } from "@/models/Project"; // Obligatoire pour .populate("projectIds")
import { MemberModel } from "@/models/Member";   // Obligatoire pour .populate("memberId")

import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("bureau", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  
  // Force l'initialisation des schémas en mémoire
  const _ensureModels = [ProjectModel, MemberModel];

  const pagination = getPagination(req);
  const url = new URL(req.url);
  const isActive = url.searchParams.get("isActive");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (isActive !== null) filter.isActive = isActive !== "false";

  try {
    const [rawItems, total] = await Promise.all([
      BureauMemberModel.find(filter)
        .populate("memberId", "firstName lastName email")
        .populate("projectIds", "code name")
        .sort({ mandateStart: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      BureauMemberModel.countDocuments(filter),
    ]);

    // Unification des données : si lié à un membre, on prend ses infos, sinon le texte saisi
    const items = rawItems.map((item: any) => ({
      ...item,
      firstName: item.memberId?.firstName || item.firstName,
      lastName: item.memberId?.lastName || item.lastName,
      email: item.memberId?.email || item.email,
    }));

    return paginatedResponse(items, total, pagination);
  } catch (error) {
    console.error("Erreur API Bureau GET:", error);
    return Response.json({ error: "Erreur lors de la récupération des membres" }, { status: 500 });
  }
});

export const POST = withAuth("bureau", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  
  const err = requireFields(body, ["firstName", "lastName", "role", "mandateStart"]);
  if (err) return badRequest(err);

  try {
    const memberData = {
      ...body,
      tenantId: auth.tenantId,
      // Nettoyage et conversion des dates
      mandateStart: new Date(body.mandateStart),
      mandateEnd: body.mandateEnd ? new Date(body.mandateEnd) : null,
      isActive: true
    };

    const member = await BureauMemberModel.create(memberData);
    
    await logAudit(auth, "CREATE", "bureau", { 
      resourceId: member._id.toString(), 
      after: { name: `${body.firstName} ${body.lastName}`, role: body.role } 
    });

    return created(member);
  } catch (error: any) {
    console.error("Erreur API Bureau POST:", error);
    return Response.json({ error: error.message || "Erreur de création" }, { status: 500 });
  }
});