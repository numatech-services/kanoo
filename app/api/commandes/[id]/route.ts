import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CommandeModel } from "@/models/Commande";
import { SupplierModel } from "@/models/Supplier";
import { buildCommandeLines } from "@/lib/commande";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { logAudit } from "@/lib/audit";

export const GET = withAuth("commandes", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const c = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("supplierId", "name code address phone email nif")
    .populate("lines.productId", "code label unit stockQty")
    .populate("projectId", "code name").populate("activityId", "name")
    .lean();
  if (!c) return notFound();
  return ok(c);
});

/**
 * PATCH — modification d'un bon NON reçu (fournisseur, dates, lignes, notes,
 * imputation) et changements de statut autorisés :
 * brouillon → confirmé → (réception via /receive) ; annulé si rien n'est reçu.
 * L'ancienne version recopiait le corps brut (statut, totaux, lignes) et
 * passait la commande « reçue » à la main, stock compté deux fois au besoin.
 */
export const PATCH = withAuth("commandes", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const cmd = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!cmd) return notFound();
  const received = (cmd.lines as Array<{ receivedQty?: number }>).some(l => (l.receivedQty ?? 0) > 0);

  if (body.status !== undefined && body.status !== cmd.status) {
    const next = String(body.status);
    const allowed: Record<string, string[]> = { draft: ["confirmed", "cancelled"], confirmed: ["draft", "cancelled"] };
    if (next === "cancelled" && received) return badRequest("Des articles ont déjà été reçus : la commande ne peut plus être annulée.");
    if (!(allowed[cmd.status] ?? []).includes(next)) {
      return badRequest(next === "received" || next === "partially_received"
        ? "La réception se fait par « Réceptionner » : elle entre les articles en stock."
        : `Passage de « ${cmd.status} » à « ${next} » impossible.`);
    }
    cmd.status = next as typeof cmd.status;
    if (next === "confirmed") { cmd.approvedBy = auth.userId as never; cmd.approvedAt = new Date(); }
  }

  const editsContent = ["lines", "supplierId", "orderDate", "expectedDeliveryDate", "notes", "projectId", "activityId", "costCenter"].some(k => k in body);
  if (editsContent) {
    if (!["draft", "confirmed"].includes(cmd.status)) return badRequest("Commande reçue, facturée ou annulée : elle ne se modifie plus.");
    if ("lines" in body) {
      if (received) return badRequest("Des articles ont déjà été reçus : les lignes ne se modifient plus.");
      const built = await buildCommandeLines(auth.tenantId, body.lines);
      if ("error" in built) return badRequest(built.error as string);
      cmd.set({ lines: built.lines.map(l => ({ ...l, receivedQty: 0 })), totalHT: built.totalHT, totalTVA: built.totalTVA, totalTTC: built.totalTTC });
    }
    if (body.supplierId && String(body.supplierId) !== String(cmd.supplierId)) {
      if (!(await SupplierModel.exists({ ...tenantFilter(auth), _id: body.supplierId }))) return badRequest("Fournisseur introuvable.");
      cmd.supplierId = body.supplierId;
    }
    if (body.orderDate) cmd.orderDate = new Date(body.orderDate);
    if ("expectedDeliveryDate" in body) cmd.expectedDeliveryDate = body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined;
    if ("notes" in body) cmd.notes = String(body.notes ?? "").slice(0, 2000);
    if (["projectId", "activityId", "costCenter"].some(k => k in body)) {
      const imp = pickImputation(body);
      const e = await checkImputations(auth.tenantId, [imp]);
      if (e) return badRequest(e);
      cmd.set({ projectId: imp.projectId, activityId: imp.activityId, costCenter: imp.costCenter });
    }
  }
  await cmd.save();
  await logAudit(auth, "UPDATE", "commandes", { resourceId: params.id, after: { status: cmd.status } });
  return ok(cmd);
});

/** DELETE — un brouillon seulement (une commande envoyée s'annule). */
export const DELETE = withAuth("commandes", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const cmd = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!cmd) return notFound();
  if (cmd.status !== "draft") return badRequest("Seul un brouillon se supprime : annulez la commande.");
  await CommandeModel.deleteOne({ _id: cmd._id });
  await logAudit(auth, "DELETE", "commandes", { resourceId: params.id, before: { number: cmd.number } });
  return noContent();
});
