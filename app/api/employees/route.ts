import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { EmployeeModel } from "@/models/Employee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("employees", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const employeeType = url.searchParams.get("employeeType");
  const isActive = url.searchParams.get("isActive");
  const expiringIn = url.searchParams.get("expiringIn"); // nb de jours

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) filter.$or = [
    { firstName: { $regex: search, $options: "i" } },
    { lastName: { $regex: search, $options: "i" } },
    { code: { $regex: search, $options: "i" } },
    { position: { $regex: search, $options: "i" } },
  ];
  if (employeeType) filter.employeeType = employeeType;
  if (isActive !== null) filter.isActive = isActive !== "false";
  if (expiringIn) {
    const limit = new Date();
    limit.setDate(limit.getDate() + parseInt(expiringIn));
    filter.contractEndDate = { $lte: limit, $gte: new Date() };
  }

  const [items, total] = await Promise.all([
    EmployeeModel.find(filter).sort({ lastName: 1, firstName: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    EmployeeModel.countDocuments(filter),
  ]);

  // Alertes fin de contrat dans 30 jours
  const alertCount = await EmployeeModel.countDocuments({
    ...tenantFilter(auth), isActive: true,
    contractEndDate: {
      $lte: new Date(Date.now() + 30 * 86400000),
      $gte: new Date(),
    },
  });

  return ok({
    items,
    pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    alertCount,
  });
});

export const POST = withAuth("employees", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["firstName", "lastName", "position", "startDate", "code", "employeeType"]);
  if (err) return badRequest(err);

  const existing = await EmployeeModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);

  // Validation selon le type
  if (body.employeeType === "employee" && !body.grossSalary) {
    return badRequest("Le salaire brut est requis pour un employé");
  }
  if (["intern", "freelance"].includes(body.employeeType) && !body.indemnity) {
    return badRequest("L'indemnité est requise pour un stagiaire ou freelance");
  }

  const employee = await EmployeeModel.create({ ...body, tenantId: auth.tenantId });

  await logAudit(auth, "CREATE", "employees", {
    resourceId: employee._id.toString(),
    after: { code: body.code, name: `${body.firstName} ${body.lastName}`, type: body.employeeType },
  });
  return created(employee);
});
