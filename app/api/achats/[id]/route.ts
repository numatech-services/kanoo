import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { CommandeModel } from "@/models/Commande";
import { buildPurchaseLines, checkSupplier, PurchaseError, commandeMatch } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

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

/** PATCH — modification d'un BROUILLON (après validation : extourne puis nouvelle saisie). */
export const PATCH = withAuth("purchases", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  if (p.status !== "draft") return badRequest("Achat validé : il ne se modifie plus. Annulez-le puis ressaisissez-le.");
  const body = await req.json().catch(() => ({}));
  try {
    if ("supplierId" in body || "payee" in body) {
      const s = await checkSupplier(auth.tenantId, body.supplierId);
      if (!s && !String(body.payee ?? "").trim()) throw new PurchaseError("Indiquez le fournisseur ou le bénéficiaire.");
      p.supplierId = s?._id ?? undefined;
      p.payee = s ? s.name : String(body.payee).trim().slice(0, 160);
    }
    if ("lines" in body) p.set(await buildPurchaseLines(auth.tenantId, body.lines, body));
    if (body.date) p.date = new Date(body.date);
    if ("dueDate" in body) p.dueDate = body.dueDate ? new Date(body.dueDate) : undefined;
    if ("supplierRef" in body) p.supplierRef = String(body.supplierRef ?? "").slice(0, 80);
    if ("notes" in body) p.notes = String(body.notes ?? "").slice(0, 2000);
    if (body.kind === "cash" || body.kind === "invoice") p.kind = body.kind;
    await p.save();
  } catch (e) {
    if (e instanceof PurchaseError) return badRequest(e.message);
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
  await PurchaseModel.deleteOne({ _id: p._id });
  if (p.commandeId) await CommandeModel.updateOne({ _id: p.commandeId, purchaseId: p._id }, { $unset: { purchaseId: 1 } });
  await logAudit(auth, "DELETE", "purchases", { resourceId: params.id, before: { number: p.number } });
  return noContent();
});
