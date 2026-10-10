import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { computeInvoiceLines, saleEntryLines, findSaleEntry, reverseSaleEntry } from "@/lib/invoice-entry";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("clientId", "name code nif address").populate("projectId", "code name").populate("activityId", "name").lean();
  if (!inv) return notFound();
  return ok(inv);
});

/**
 * PATCH — champs modifiables selon l'état :
 *  - toujours : échéance, notes, conditions, imputation (projet / secteur) ;
 *  - brouillon non certifié : client, dates, lignes (totaux et écriture de
 *    vente recalculés dans la même transaction).
 * L'ancienne version recopiait le corps (montant payé, type de document,
 * lignes sans recalcul des totaux ni de l'écriture).
 */
export const PATCH = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!inv) return notFound();
  if (["paid", "cancelled"].includes(inv.status)) return badRequest("Impossible de modifier une facture soldée ou annulée");
  const isDraft = inv.status === "draft" && !inv.secef?.code;

  const touchesContent = ["lines", "clientId", "issueDate"].some(k => k in body);
  if (touchesContent && !isDraft) return badRequest("Facture émise : son contenu ne se modifie plus. Émettez un avoir.");
  // Facture de marché (acompte, échéance, déduction) : ses montants viennent du
  // marché ; la retoucher ici fausserait acomptes et reste à facturer.
  if (inv.contractId && ("lines" in body || "clientId" in body)) return badRequest("Facture de marché : faites un avoir puis refacturez depuis la fiche du marché.");

  if ("dueDate" in body && body.dueDate) inv.dueDate = new Date(body.dueDate);
  if ("notes" in body) inv.notes = String(body.notes ?? "").slice(0, 4000);
  if ("termsAndConditions" in body) inv.termsAndConditions = String(body.termsAndConditions ?? "").slice(0, 4000);
  const impChanged = "projectId" in body || "activityId" in body;
  if (impChanged) {
    const imp = pickImputation({ projectId: "projectId" in body ? body.projectId : inv.projectId, activityId: "activityId" in body ? body.activityId : inv.activityId });
    const e = await checkImputations(auth.tenantId, [imp]);
    if (e) return badRequest(e);
    inv.set({ projectId: imp.projectId, activityId: imp.activityId });
  }
  if (isDraft && body.clientId && String(body.clientId) !== String(inv.clientId)) {
    if (!(await ClientModel.exists({ ...tenantFilter(auth), _id: body.clientId }))) return badRequest("Client introuvable.");
    inv.clientId = body.clientId;
  }
  if (isDraft && body.issueDate) inv.issueDate = new Date(body.issueDate);
  if (isDraft && Array.isArray(body.lines)) {
    if (body.lines.length === 0) return badRequest("Au moins une ligne.");
    const t = computeInvoiceLines(body.lines);
    inv.set({ lines: t.lines, totalHT: t.totalHT, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC });
  }

  await withTransaction(async session => {
    await inv.save({ session });
    // Écriture de vente alignée sur la facture (brouillon) ou sur son imputation.
    if (touchesContent || impChanged) {
      const entry = await findSaleEntry(auth.tenantId, inv._id, session);
      if (entry) {
        entry.set({
          lines: await saleEntryLines(auth.tenantId, inv, session),
          ...(isDraft ? { entryDate: inv.issueDate } : {}),
        });
        await entry.save({ session });
      }
    }
  });
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id });
  return ok(inv);
});

/** DELETE — annule un brouillon ; son écriture de vente est extournée. */
export const DELETE = withAuth("invoices", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!inv) return notFound();
  if (inv.status !== "draft") return badRequest("Seuls les brouillons peuvent être supprimés");
  await withTransaction(async session => {
    inv.status = "cancelled";
    await inv.save({ session });
    await reverseSaleEntry({ tenantId: auth.tenantId, userId: auth.userId, invoiceId: inv._id, reason: "brouillon supprimé" }, session);
  });
  await logAudit(auth, "DELETE", "invoices", { resourceId: params.id });
  return noContent();
});
