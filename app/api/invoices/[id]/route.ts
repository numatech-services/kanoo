import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { BusinessRuleError } from "@/lib/errors";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { ClientModel } from "@/models/Client";
import { retentionFor } from "@/lib/retention";
import { releaseMarketInvoice } from "@/lib/market-invoice";
import { computeInvoiceLines, saleEntryLines, findSaleEntry, reverseSaleEntry } from "@/lib/invoice-entry";
import { pickImputation, checkImputations, reimputeEntry } from "@/lib/imputation";
import { logAudit, logAuditInTx } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { mentionsFrom } from "@/lib/doc-mentions";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { postInvoice } from "@/lib/invoice-posting";
import { contentKey, correctionBlock, correctionFacts, REASON_MIN } from "@/lib/invoice-correction";
import { AuditLogModel } from "@/models/AuditLog";

export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("clientId", "name code nif address").populate("projectId", "code name").populate("activityId", "name").lean();
  if (!inv) return notFound();
  return ok(inv);
});

/**
 * PATCH — champs modifiables selon l'état :
 *  - toujours : échéance, notes, conditions et mentions (figées une fois la
 *    facture certifiée SECeF), imputation (projet / secteur ; seule chose,
 *    avec les notes, qui se corrige sur une facture soldée) ;
 *  - brouillon non certifié : client, dates, lignes (totaux et écriture de
 *    vente recalculés dans la même transaction) ;
 *  - facture émise, par l'administrateur de l'organisation : correction
 *    contrôlée (lib/invoice-correction) — même numéro, écriture de vente
 *    extournée puis repassée, avant/après au journal d'audit.
 * L'ancienne version recopiait le corps (montant payé, type de document,
 * lignes sans recalcul des totaux ni de l'écriture).
 */
export const PATCH = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!inv) return notFound();
  if (inv.status === "cancelled") return badRequest("Impossible de modifier une facture annulée");
  // Facture soldée : seule l'imputation (et les notes internes) se corrige encore.
  if (inv.status === "paid" && Object.keys(body).some(k => !["projectId", "activityId", "notes"].includes(k))) {
    return badRequest("Facture soldée : seules son imputation et ses notes internes se modifient.");
  }
  const isDraft = inv.status === "draft" && !inv.secef?.code;
  const certified = Boolean(inv.secef?.code);

  // Le formulaire renvoie toujours client, date et lignes : seul un vrai
  // changement de contenu compte (sinon modifier l'échéance d'une facture émise serait refusé).
  const before = contentKey(inv.toObject());
  const asked = contentKey({
    clientId: "clientId" in body ? body.clientId : inv.clientId,
    issueDate: "issueDate" in body && body.issueDate ? body.issueDate : inv.issueDate,
    lines: Array.isArray(body.lines) ? computeInvoiceLines(body.lines).lines : inv.lines,
  });
  const touchesContent = asked !== before;
  const correcting = touchesContent && !isDraft;
  const reason = String(body.correctionReason ?? "").trim().slice(0, 500);
  if (correcting) {
    if (!hasTenantAdminRole(auth)) return badRequest("Facture émise : seul l'administrateur de l'organisation peut corriger son contenu. Sinon, émettez un avoir.");
    if ("clientId" in body && body.clientId && String(body.clientId) !== String(inv.clientId)) {
      return badRequest("Le client d'une facture émise ne change pas : émettez un avoir, puis une nouvelle facture au bon client.");
    }
    if (reason.length < REASON_MIN) return badRequest("Indiquez le motif de la correction : il reste au journal d'audit et sur l'écriture d'extourne.");
    const newDate = "issueDate" in body && body.issueDate ? new Date(body.issueDate) : null;
    const why = correctionBlock(inv, await correctionFacts(auth.tenantId, inv, newDate), newDate);
    if (why) return badRequest(why);
  }
  const editable = isDraft || correcting;
  const image = () => ({
    clientId: String(inv.clientId), issueDate: inv.issueDate, dueDate: inv.dueDate, lines: inv.toObject().lines,
    totalHT: inv.totalHT, totalTVA: inv.totalTVA, totalTTC: inv.totalTTC,
  });
  const snapshot = correcting ? image() : null;
  // Facture de marché (acompte, échéance, déduction) : ses montants viennent du
  // marché ; la retoucher ici fausserait acomptes et reste à facturer.
  if (inv.contractId && touchesContent) return badRequest("Facture de marché : faites un avoir puis refacturez depuis la fiche du marché.");

  // Facture certifiée SECeF : ce qui est imprimé doit rester ce que la DGI a reçu.
  const printed = ["termsAndConditions", "object", "reference", "period", "attention"].filter(k => k in body && String(body[k] ?? "") !== String((inv as unknown as Record<string, unknown>)[k] ?? ""));
  if (certified && printed.length) return badRequest("Facture certifiée SECeF : ses mentions et conditions imprimées ne se modifient plus. Émettez un avoir si nécessaire.");
  const mentionsBefore = !isDraft && printed.length ? Object.fromEntries(printed.map(k => [k, (inv as unknown as Record<string, unknown>)[k] ?? ""])) : null;

  if ("dueDate" in body && body.dueDate) inv.dueDate = new Date(body.dueDate);
  if ("notes" in body) inv.notes = String(body.notes ?? "").slice(0, 4000);
  if ("termsAndConditions" in body) inv.termsAndConditions = String(body.termsAndConditions ?? "").slice(0, 4000);
  inv.set(mentionsFrom(body));
  const impChanged = ("projectId" in body && String(body.projectId ?? "") !== String(inv.projectId ?? ""))
    || ("activityId" in body && String(body.activityId ?? "") !== String(inv.activityId ?? ""));
  // Facture émise : le changement d'imputation touche l'écriture de vente ;
  // motif obligatoire, gardé au journal avec l'avant / après.
  const impReason = String(body.imputationReason ?? "").trim().slice(0, 500);
  const impLogged = impChanged && !isDraft && !correcting;
  if (impLogged && impReason.length < REASON_MIN) return badRequest("Indiquez le motif de la correction d'imputation (5 caractères au moins) : il reste au journal d'audit.");
  const impBefore = { projectId: inv.projectId ? String(inv.projectId) : null, activityId: inv.activityId ? String(inv.activityId) : null };
  if (impChanged) {
    const raw = { projectId: "projectId" in body ? body.projectId : inv.projectId, activityId: "activityId" in body ? body.activityId : inv.activityId };
    const e = await checkImputations(auth.tenantId, [raw]);
    if (e) return badRequest(e);
    const imp = pickImputation(raw);
    inv.set({ projectId: imp.projectId, activityId: imp.activityId });
  }
  if (editable && body.clientId && String(body.clientId) !== String(inv.clientId)) {
    if (!(await ClientModel.exists({ ...tenantFilter(auth), _id: body.clientId }))) return badRequest("Client introuvable.");
    inv.clientId = body.clientId;
  }
  if (editable && body.issueDate) inv.issueDate = new Date(body.issueDate);
  if (editable && Array.isArray(body.lines)) {
    if (body.lines.length === 0) return badRequest("Au moins une ligne.");
    const t = computeInvoiceLines(body.lines);
    inv.set({ lines: t.lines, totalHT: t.totalHT, totalTVA: t.totalTVA, totalDTS: t.totalDTS, totalTTC: t.totalTTC });
    // Retenue de garantie du marché : suit le nouveau TTC.
    if ((inv.retentionRate ?? 0) > 0) inv.retentionAmount = retentionFor(t.totalTTC, inv.retentionRate, inv.kind);
  }
  if (correcting) inv.set({ correctedAt: new Date(), correctionCount: (inv.correctionCount ?? 0) + 1, correctionReason: reason });

  await withTransaction(async session => {
    if (correcting) {
      // Nouveaux faits dans la transaction (un encaissement saisi entre-temps l'emporte).
      const why = correctionBlock({ ...inv.toObject(), issueDate: snapshot!.issueDate },
        await correctionFacts(auth.tenantId, { _id: inv._id, issueDate: snapshot!.issueDate }, inv.issueDate, session));
      if (why) throw new BusinessRuleError(why);
      // Extourne datée comme l'écriture d'origine : chiffre d'affaires et TVA restent dans le mois de la facture.
      await reverseSaleEntry({ tenantId: auth.tenantId, userId: auth.userId, invoiceId: inv._id, reason: `correction : ${reason}`.slice(0, 200), atEntryDate: true }, session);
      await inv.save({ session });
      await postInvoice(auth, inv as unknown as Parameters<typeof postInvoice>[1], session);
      // Trace écrite dans la même transaction : pas de correction sans son avant/après.
      await AuditLogModel.create([{
        tenantId: auth.tenantId, userId: auth.userId, userEmail: auth.email, userRole: auth.role,
        action: "UPDATE", resource: "invoices", resourceId: String(inv._id),
        before: snapshot, after: image(), metadata: { correction: true, reason, count: inv.correctionCount }, createdAt: new Date(),
      }], { session });
      return;
    }
    await inv.save({ session });
    const entry = touchesContent || impChanged ? await findSaleEntry(auth.tenantId, inv._id, session) : null;
    if (entry && isDraft) {
      // Brouillon : l'écriture suit la facture.
      entry.set({ lines: await saleEntryLines(auth.tenantId, inv, session), entryDate: inv.issueDate });
      await entry.save({ session });
    } else if (entry && impChanged) {
      // Facture émise : seule l'imputation des lignes de produits change ; montants et comptes restent.
      const imp = pickImputation({ projectId: inv.projectId, activityId: inv.activityId });
      const byIndex = new Map<number, typeof imp>();
      (entry.lines as Array<{ accountCode: string; costCenter?: string }>).forEach((l, i) => {
        if (/^7/.test(l.accountCode)) byIndex.set(i, { ...imp, ...(l.costCenter ? { costCenter: l.costCenter as never } : {}) });
      });
      await reimputeEntry(auth.tenantId, entry._id, byIndex, session);
    }
    if (impLogged) {
      await logAuditInTx(auth, "UPDATE", "invoices", {
        resourceId: String(inv._id), before: impBefore,
        after: { projectId: inv.projectId ? String(inv.projectId) : null, activityId: inv.activityId ? String(inv.activityId) : null },
        metadata: { action: "reimpute", reason: impReason, number: inv.number, entryId: entry ? String(entry._id) : undefined },
      }, session);
    }
  });
  if (!correcting) {
    await logAudit(auth, "UPDATE", "invoices", {
      resourceId: params.id,
      ...(mentionsBefore ? { before: mentionsBefore, after: Object.fromEntries(Object.keys(mentionsBefore).map(k => [k, (inv as unknown as Record<string, unknown>)[k] ?? ""])) } : {}),
    });
  }
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
    // Brouillon de marché : l'échéance redevient facturable et les acomptes
    // qu'il déduisait sont libérés (ils restaient bloqués à jamais).
    await releaseMarketInvoice(auth.tenantId, inv, session);
    // Devis d'origine : de nouveau transformable (il restait bloqué « déjà converti » sur une facture annulée).
    await DevisModel.updateMany({ tenantId: auth.tenantId, convertedToInvoiceId: inv._id }, { $unset: { convertedToInvoiceId: 1 } }, { session });
    await reverseSaleEntry({ tenantId: auth.tenantId, userId: auth.userId, invoiceId: inv._id, reason: "brouillon supprimé" }, session);
  });
  await logAudit(auth, "DELETE", "invoices", { resourceId: params.id });
  return noContent();
});
