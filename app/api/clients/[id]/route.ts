import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<Record<string, unknown> | null>();
  if (!client) return notFound("Client introuvable");

  // Solde calculé, jamais lu depuis le champ stocké : celui-ci vaut zéro pour
  // tout le monde depuis l'origine, faute d'être mis à jour par quoi que ce
  // soit. Voir /api/clients/:id/releve pour le détail des mouvements.
  const [agg] = await InvoiceModel.aggregate<{ due: number }>([
    { $match: {
      ...tenantFilter(auth), clientId: client._id,
      documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial", "overdue"] },
    } },
    { $group: { _id: null, due: { $sum: { $subtract: [
      "$totalTTC", { $add: ["$paidAmount", { $ifNull: ["$creditedAmount", 0] }] },
    ] } } } },
  ]);

  return ok({ ...client, currentBalance: Math.max(0, agg?.due ?? 0) });
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
