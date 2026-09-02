import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { MemberModel } from "@/models/Member";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("membres", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) filter.$or = [
    { firstName: { $regex: search, $options: "i" } },
    { lastName: { $regex: search, $options: "i" } },
    { code: { $regex: search, $options: "i" } },
  ];
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    MemberModel.find(filter).sort({ lastName: 1, firstName: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    MemberModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("membres", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["firstName", "lastName", "code", "membershipType", "joinDate"]);
  if (missing) return badRequest(missing);
  await connectDB();
  const existing = await MemberModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);
  // Générer un code d'accès portail automatiquement
  const accessCode = String(Math.floor(100000 + Math.random() * 900000));

  const member = await MemberModel.create({ ...body, accessCode, accessCodeGeneratedAt: new Date(), tenantId: auth.tenantId });
  await logAudit(auth, "CREATE", "membres", { resourceId: member._id.toString(), after: { code: body.code, name: `${body.firstName} ${body.lastName}` } });
  return created(member);
});
