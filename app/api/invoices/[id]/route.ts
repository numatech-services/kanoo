import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("clientId", "name code nif address").lean();
  if (!inv) return notFound(); return ok(inv);
});
export const PATCH = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  // Interdire modification si facture soldée ou annulée
  const existing = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!existing) return notFound();
  if (["paid","cancelled"].includes(existing.status)) return badRequest("Impossible de modifier une facture soldée ou annulée");
  // Champs protégés : statut, totaux, numéro et tenant sont recalculés/immuables,
  // jamais acceptés depuis le corps (anti-fraude et anti cross-tenant).
  for (const k of ["_id", "tenantId", "status", "number", "invoiceNumber", "totalHT", "totalTVA", "totalTTC", "amountPaid", "createdAt", "updatedAt"]) delete body[k];
  Object.assign(existing, body);
  await existing.save();
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id });
  return ok(existing);
});
export const DELETE = withAuth("invoices", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!inv) return notFound();
  if (inv.status !== "draft") return badRequest("Seuls les brouillons peuvent être supprimés");
  inv.status = "cancelled";
  await inv.save();
  await logAudit(auth, "DELETE", "invoices", { resourceId: params.id });
  return noContent();
});
