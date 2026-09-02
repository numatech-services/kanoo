import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter, RouteContext } from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!client) return notFound("Client introuvable");
  return ok(client);
});

export const PATCH = withAuth("clients", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!client) return notFound("Client introuvable");
  const before = { name: client.name };
  // Champs protégés : jamais réaffectés depuis le corps (cross-tenant, solde).
  for (const k of ["_id", "tenantId", "currentBalance", "createdAt", "updatedAt"]) delete body[k];
  Object.assign(client, body);
  await client.save();
  await logAudit(auth, "UPDATE", "clients", { resourceId: params.id, before, after: { name: client.name } });
  return ok(client);
});

export const DELETE = withAuth("clients", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!client) return notFound("Client introuvable");
  client.isActive = false;
  await client.save();
  await logAudit(auth, "DELETE", "clients", { resourceId: params.id });
  return noContent();
});
