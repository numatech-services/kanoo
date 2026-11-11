import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { CommandeModel } from "@/models/Commande";
import { buildPurchaseLines, checkSupplier, PurchaseError, commandeMatch } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";
import { findSupplierInvoice, isSupplierKeyConflict } from "@/lib/purchase-dup";
import { distributeVat } from "@/lib/api-v1-purchase";
import { checkImputations, pickImputation, reimputeEntry, type Imputation } from "@/lib/imputation";

export const GET = withAuth("purchases", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("supplierId", "name code nif phone email").populate("commandeId", "number")
    .populate("lines.projectId", "code name").populate("lines.activityId", "name")
    .populate("payments.treasuryAccountId", "label type").populate("createdBy validatedBy", "firstName lastName")
    .lean();
  if (!p) return notFound("Achat introuvable");
  // Rapprochement commande / réception / facture, si l'achat vient d'un bon de commande.
  const doc = p as unknown as { commandeId?: { _id?: unknown } | null; totalHT?: number; lines: Array<{ amountHT: number }> };
  const match = await commandeMatch(auth.tenantId, { ...doc, commandeId: doc.commandeId?._id ?? doc.commandeId ?? undefined });
  return ok({ ...p, match });
});

/**
 * PATCH — modification d'un BROUILLON (après validation : extourne puis
 * nouvelle saisie). Seule exception : `imputations` (une par ligne) corrige le
 * rattachement analytique d'un achat validé ou payé, sur l'achat et sur son
 * écriture, sans toucher aux montants.
 */
export const PATCH = withAuth("purchases", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.imputations) && p.status !== "draft") {
    if (p.status === "cancelled") return badRequest("Achat annulé : il ne se réimpute plus.");
    if (body.imputations.length !== p.lines.length) return badRequest("Une imputation par ligne de l'achat.");
    // Contrôle sur la saisie brute : un identifiant invalide est refusé, pas effacé en silence.
    const e = await checkImputations(auth.tenantId, body.imputations.map((x: unknown) => (x && typeof x === "object" ? x : {})));
    if (e) return badRequest(e);
    const imps: Imputation[] = body.imputations.map(pickImputation);
    const before = p.lines.map((l: Imputation) => pickImputation(l));
    await withTransaction(async session => {
      imps.forEach((imp, i) => { const l = p.lines[i]; l.projectId = imp.projectId; l.activityId = imp.activityId; l.costCenter = imp.costCenter; });
      p.markModified("lines");
      await p.save({ session });
      // Les premières lignes de l'écriture d'achat sont les lignes de charge, dans l'ordre de l'achat.
      if (p.entryId) await reimputeEntry(auth.tenantId, p.entryId, new Map(imps.map((imp, i) => [i, imp])), session);
    });
    await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id, before: { imputations: before }, after: { imputations: imps }, metadata: { action: "reimpute" } });
    return ok(p);
  }
  if (p.status !== "draft") return badRequest("Achat validé : il ne se modifie plus. Annulez-le puis ressaisissez-le (ou corrigez seulement son imputation).");
  try {
    if ("supplierId" in body || "payee" in body) {
      const s = await checkSupplier(auth.tenantId, body.supplierId);
      if (!s && !String(body.payee ?? "").trim()) throw new PurchaseError("Indiquez le fournisseur ou le bénéficiaire.");
      p.supplierId = s?._id ?? undefined;
      p.payee = s ? s.name : String(body.payee).trim().slice(0, 160);
    }
    if ("lines" in body) {
      const built = await buildPurchaseLines(auth.tenantId, body.lines, body);
      // Achat reçu par l'API : la TVA reste celle de la facture du fournisseur, répartie sur les nouvelles lignes.
      const src = (p as unknown as { sourceVat?: number }).sourceVat;
      if (src !== undefined && src !== null && built.totalHT > 0 && src < built.totalHT) {
        const tva = distributeVat(built.lines.map(l => l.amountHT), src);
        built.lines = built.lines.map((l, i) => ({ ...l, amountTVA: tva[i], tvaRate: Math.round((src / built.totalHT) * 10000) / 10000 }));
        built.totalTVA = src; built.totalTTC = built.totalHT + src;
      }
      p.set("needsImputation", undefined);
      // Le type de dépense du marché survit à la modification d'un brouillon.
      const old = p.lines as Array<{ accountCode: string; costTypeId?: unknown }>;
      p.set({ ...built, lines: built.lines.map((l, i) => (old[i]?.costTypeId && old[i].accountCode === l.accountCode ? { ...l, costTypeId: old[i].costTypeId } : l)) });
    }
    if (body.date) p.date = new Date(body.date);
    if ("dueDate" in body) p.dueDate = body.dueDate ? new Date(body.dueDate) : undefined;
    if ("supplierRef" in body) p.supplierRef = String(body.supplierRef ?? "").slice(0, 80);
    if ("supplierRef" in body || "supplierId" in body) {
      const dup = await findSupplierInvoice(auth.tenantId, p.supplierId, p.supplierRef, p._id);
      if (dup) throw new PurchaseError(`Facture ${p.supplierRef} de ce fournisseur déjà enregistrée (${dup.number ?? "pièce"}).`);
    }
    if ("notes" in body) p.notes = String(body.notes ?? "").slice(0, 2000);
    if (body.kind === "cash" || body.kind === "invoice") p.kind = body.kind;
    await p.save();
  } catch (e) {
    if (e instanceof PurchaseError) return badRequest(e.message);
    if (isSupplierKeyConflict(e)) return badRequest("Cette facture de fournisseur est déjà enregistrée.");
    throw e;
  }
  await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id });
  return ok(p);
});

export const DELETE = withAuth("purchases", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  if (p.status !== "draft") return badRequest("Seul un brouillon se supprime : un achat validé s'annule (extourne).");
  // Brouillon reçu par l'API : gardé au statut annulé, pour que l'appelant (ISIC…) le voie et ne le renvoie pas.
  if (p.externalRef) await PurchaseModel.updateOne({ _id: p._id }, { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: "Brouillon supprimé dans Kanoo" }, $unset: { activeSupplierKey: 1 } });
  else await PurchaseModel.deleteOne({ _id: p._id });
  if (p.commandeId) await CommandeModel.updateOne({ _id: p.commandeId, purchaseId: p._id }, { $unset: { purchaseId: 1 } });
  if (p.externalRef) await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id, before: { status: "draft", number: p.number }, after: { status: "cancelled", externalRef: p.externalRef }, metadata: { action: "cancel_api_draft" } });
  else await logAudit(auth, "DELETE", "purchases", { resourceId: params.id, before: { number: p.number } });
  return noContent();
});
