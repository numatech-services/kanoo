import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, requireFields } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { generateSecureToken, hashPassword } from "@/lib/auth";
import { UserModel } from "@/models/User";
import { TokenPayload } from "@/lib/auth";

// Superadmin only — vérifié aussi dans middleware
export const GET = withAuth("companies", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") {
    return new Response(JSON.stringify({ error: "Superadmin uniquement" }), { status: 403 });
  }

  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (type) filter.type = type;
  if (status) filter.subscriptionStatus = status;

  const [tenants, total] = await Promise.all([
    TenantModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    TenantModel.countDocuments(filter),
  ]);

  // Enrichir avec le nombre d'utilisateurs
  const tenantIds = tenants.map((t) => t._id);
  const userCounts = await UserModel.aggregate([
    { $match: { tenantId: { $in: tenantIds } } },
    { $group: { _id: "$tenantId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(userCounts.map((u) => [u._id.toString(), u.count]));

  const enriched = tenants.map((t) => ({
    ...t,
    userCount: countMap.get(t._id.toString()) || 0,
  }));

  return paginatedResponse(enriched, total, pagination);
});

// POST — Créer un nouveau tenant depuis superadmin
export const POST = withAuth("companies", "create", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") {
    return new Response(JSON.stringify({ error: "Superadmin uniquement" }), { status: 403 });
  }

  const body = await req.json();
  const missing = requireFields(body, ["name", "type", "adminEmail", "adminPassword"]);
  if (missing) return badRequest(missing);

  await connectDB();

  // Générer un slug unique
  const baseSlug = body.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
  let slug = baseSlug;
  let attempt = 0;
  while (await TenantModel.exists({ slug })) {
    slug = `${baseSlug}-${++attempt}`;
  }

  const existingTenant = await TenantModel.findOne({ email: body.email });
  if (existingTenant) return conflict("Un tenant avec cet email existe déjà");

  const activationToken = generateSecureToken();
  const tenant = await TenantModel.create({
    name: body.name,
    slug,
    type: body.type,
    nif: body.nif,
    email: body.email,
    phone: body.phone,
    address: body.address,
    plan: body.plan || "starter",
    planModules: body.planModules || ["*"],
    subscriptionStatus: "trial",
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
    activationToken,
    activationTokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });

  // Créer l'admin du tenant
  const adminRole = body.type === "association" ? "asso_president"
    : body.type === "administration" ? "admin_ordonnateur"
    : "pme_admin";

  const passwordHash = await hashPassword(body.adminPassword);
  await UserModel.create({
    tenantId: tenant._id,
    email: body.adminEmail.toLowerCase(),
    passwordHash,
    firstName: body.adminFirstName || "Admin",
    lastName: body.adminLastName || tenant.name,
    role: adminRole,
    isActive: true,
  });

  return created({ tenant, activationToken });
});
