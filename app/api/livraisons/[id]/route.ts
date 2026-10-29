import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { StockMovementModel } from "@/models/StockMovement";
import { reverseMovement } from "@/lib/stock";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { InvoiceModel } from "@/models/Invoice";
import type { ClientSession } from "mongoose";

/** Sorties de stock de CE bon (et non tout mouvement portant le même numéro). */
const exitsOf = (tenantId: string, noteId: unknown) => ({ tenantId, type: "exit", linkedDocType: "delivery", linkedDocId: noteId, reversedBy: { $exists: false } });

/**
 * Un avoir a-t-il déjà repris en stock la marchandise de la facture ? Alors
 * retourner ou supprimer le bon la ferait rentrer une seconde fois.
 */
async function stockTakenBackByCredit(tenantId: string, invoiceId: unknown, session?: ClientSession) {
  const credits = await InvoiceModel.find({ tenantId, documentType: "credit_note", originalInvoiceId: invoiceId, status: { $ne: "cancelled" } })
    .select("_id").session(session ?? null).lean<Array<{ _id: unknown }>>();
  if (!credits.length) return false;
  return Boolean(await StockMovementModel.exists({ tenantId, type: "return", linkedDocType: "invoice", linkedDocId: { $in: credits.map(c => c._id) } }).session(session ?? null));
}

/** Transitions permises : un bon émis ne redevient jamais brouillon (la quantité redeviendrait livrable sans retour de stock). */
const TRANSITIONS: Record<string, string[]> = {
  draft: ["issued"],
  issued: ["delivered", "partially_delivered", "returned"],
  partially_delivered: ["delivered", "returned"],
  delivered: ["returned"],
  returned: [],
};

// Un bon de livraison relève des livraisons (Administration, Achats), pas de la
// facturation : le détail répondait 403 à qui gérait pourtant la liste.
export const GET = withAuth("livraisons", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("invoiceId", authCan(auth, "invoices", "read") ? "number totalTTC issueDate" : "number issueDate")
    .populate("clientId", "name code nif address phone")
    .lean();
  if (!item) return notFound();
  return ok(item);
});

export const PATCH = withAuth("livraisons", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const raw = await req.json().catch(() => ({}));
  // Liste blanche. Les lignes ont déjà sorti le stock : on ne les modifie pas
  // après coup (on annule le bon et on en émet un autre).
  const body: Record<string, unknown> = {};
  for (const k of ["notes", "internalNotes", "deliveryAddress", "signedBy"]) if (k in raw) body[k] = raw[k] === null ? "" : String(raw[k]).slice(0, 2000);
  for (const k of ["deliveryDate", "signedAt"]) {
    if (!(k in raw)) continue;
    const d = new Date(String(raw[k])); if (isNaN(d.getTime())) return badRequest("Date invalide."); body[k] = d;
  }
  const note = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!note) return notFound();
  if ("status" in raw && raw.status !== note.status) {
    if (note.status === "returned") return badRequest("Bon retourné : émettez un nouveau bon.");
    if (!(TRANSITIONS[note.status] ?? []).includes(String(raw.status))) return badRequest("Changement de statut impossible pour ce bon.");
    if (raw.status === "returned" && await stockTakenBackByCredit(auth.tenantId, note.invoiceId)) {
      return badRequest("Un avoir a déjà repris cette marchandise en stock : le retour du bon la ferait rentrer deux fois.");
    }
    body.status = raw.status;
  }

  await withTransaction(async (session) => {
    // Retour : la marchandise revient en stock, dans la même transaction. Le
    // simple changement de statut ne remettait rien en stock, et comme les
    // quantités des bons retournés ne comptent plus comme livrées, la même
    // quantité pouvait être relivrée et sortie une seconde fois.
    if (body.status === "returned") {
      const exits = await StockMovementModel.find(exitsOf(auth.tenantId, note._id))
        .select("_id quantity").session(session ?? null).lean<Array<{ _id: unknown; quantity: number }>>();
      for (const m of exits) {
        if (!m.quantity) continue;
        await reverseMovement({ tenantId: auth.tenantId, userId: auth.userId, movementId: m._id, reason: `retour du BL ${note.number}` }, session);
      }
    }
    note.set(body);
    await note.save({ session });
  });
  await logAudit(auth, "UPDATE", "livraisons", { resourceId: params.id, ...(body.status ? { after: { status: body.status } } : {}) });
  return ok(note);
});

/**
 * DELETE — annule un bon de livraison et remet en stock ce qu'il avait sorti,
 * dans la même transaction, avec un mouvement « retour » traçable.
 */
export const DELETE = withAuth("livraisons", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const note = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!note) return notFound();
  // Un bon signé ou livré est une preuve de livraison : il se retourne, il ne s'efface pas.
  if (note.signedAt || ["delivered", "partially_delivered"].includes(note.status)) {
    return badRequest("Bon signé ou livré : il ne se supprime pas. Passez-le en « retourné » pour remettre la marchandise en stock.");
  }
  if (note.status !== "returned" && await stockTakenBackByCredit(auth.tenantId, note.invoiceId)) {
    return badRequest("Un avoir a déjà repris cette marchandise en stock : supprimer le bon la ferait rentrer deux fois.");
  }

  await withTransaction(async (session) => {
    // Contre-mouvement de chaque sortie du bon : on rend exactement ce qui était
    // sorti (la sortie avait pu être plafonnée au stock disponible).
    const exits = await StockMovementModel.find(exitsOf(auth.tenantId, note._id))
      .select("_id quantity").session(session ?? null).lean<Array<{ _id: unknown; quantity: number }>>();
    for (const m of exits) {
      if (!m.quantity) continue;
      await reverseMovement({ tenantId: auth.tenantId, userId: auth.userId, movementId: m._id, reason: `annulation du BL ${note.number}` }, session);
    }
    await DeliveryNoteModel.deleteOne({ _id: note._id }, { session });
  });

  await logAudit(auth, "DELETE", "livraisons", { resourceId: params.id, before: { number: note.number } });
  return noContent();
});
