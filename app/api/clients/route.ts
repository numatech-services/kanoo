import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, ok, created, badRequest, notFound, conflict, paginatedResponse,
  getPagination, tenantFilter, requireFields, serverError
} from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// GET /api/clients — Liste paginée avec recherche
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const isActive = url.searchParams.get("isActive");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
      { nif: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (isActive !== null) filter.isActive = isActive === "true";

  const [items, total] = await Promise.all([
    ClientModel.find(filter)
      .sort({ name: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ClientModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

// POST /api/clients — Créer un client
export const POST = withAuth("clients", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["name", "code"]);
  if (missing) return badRequest(missing);

  await connectDB();

  // Unicité du code dans le tenant
  const existing = await ClientModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Un client avec le code '${body.code}' existe déjà`);

  const client = await ClientModel.create({
    ...body,
    tenantId: auth.tenantId,
    currentBalance: 0,
  });

  await logAudit(auth, "CREATE", "clients", {
    resourceId: client._id.toString(),
    after: { name: client.name, code: client.code },
  });

  return created(client);
});
