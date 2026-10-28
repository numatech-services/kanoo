import type { ClientSession, Types } from "mongoose";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { InvoiceModel } from "@/models/Invoice";
import { StockMovementModel } from "@/models/StockMovement";
import { applyMovement, StockError } from "@/lib/stock";
import type { TokenPayload } from "@/lib/auth";

/**
 * Retour en stock des articles d'un avoir : chaque ligne liée à un produit
 * rentre dans l'entrepôt d'où elle était partie, au plus à hauteur de ce que
 * les bons de livraison de la facture ont sorti, moins ce que les avoirs
 * précédents ont déjà repris. Un avoir sur une facture jamais livrée ne crée
 * pas de stock.
 */
export async function restockCreditNote(
  auth: TokenPayload, invoiceId: Types.ObjectId,
  creditNote: { _id: unknown; number: string; lines: Array<{ productId?: unknown; quantity: number }> },
  session?: ClientSession,
) {
  const tenantId = auth.tenantId;
  const notes = await DeliveryNoteModel.find({ tenantId, invoiceId, status: { $ne: "returned" } })
    .select("_id warehouseId").session(session ?? null).lean<Array<{ _id: Types.ObjectId; warehouseId?: Types.ObjectId }>>();
  if (!notes.length) return 0;
  const exits = await StockMovementModel.find({ tenantId, linkedDocType: "delivery", linkedDocId: { $in: notes.map(n => n._id) }, type: "exit" })
    .select("productId quantity warehouseId lots").session(session ?? null)
    .lean<Array<{ productId: Types.ObjectId; quantity: number; warehouseId?: Types.ObjectId; lots?: Array<{ lotNumber: string; expiryDate?: Date; qty: number }> }>>();
  const others = await InvoiceModel.find({ tenantId, documentType: "credit_note", originalInvoiceId: invoiceId, _id: { $ne: creditNote._id } })
    .select("_id").session(session ?? null).lean<Array<{ _id: Types.ObjectId }>>();
  const returned = others.length ? await StockMovementModel.find({ tenantId, linkedDocType: "invoice", linkedDocId: { $in: others.map(o => o._id) }, type: "return" })
    .select("productId quantity").session(session ?? null).lean<Array<{ productId: Types.ObjectId; quantity: number }>>() : [];

  type Lot = { lotNumber: string; expiryDate?: Date; qty: number };
  const room = new Map<string, { qty: number; warehouseId?: Types.ObjectId; lots: Lot[] }>();
  for (const m of exits) {
    const k = String(m.productId), cur = room.get(k) ?? { qty: 0, warehouseId: m.warehouseId, lots: [] };
    // Lots sortis par la livraison : un article suivi revient dans ses lots.
    for (const l of m.lots ?? []) cur.lots.push({ lotNumber: l.lotNumber, expiryDate: l.expiryDate, qty: Math.abs(l.qty) });
    room.set(k, { ...cur, qty: cur.qty + Math.abs(m.quantity), warehouseId: cur.warehouseId ?? m.warehouseId });
  }
  for (const m of returned) {
    const cur = room.get(String(m.productId));
    if (cur) cur.qty -= Math.abs(m.quantity);
  }

  let count = 0;
  for (const l of creditNote.lines) {
    if (!l.productId) continue;
    const cur = room.get(String(l.productId));
    const qty = Math.min(Math.abs(l.quantity), cur?.qty ?? 0);
    if (!(qty > 0) || !cur) continue;
    let lots: Lot[] | undefined;
    if (cur.lots.length) {
      lots = [];
      let left = qty;
      for (const lot of cur.lots) {
        if (left <= 0) break;
        const take = Math.min(left, lot.qty);
        if (take > 0) { lots.push({ ...lot, qty: take }); lot.qty -= take; left -= take; }
      }
      if (left > 0) lots = undefined;
    }
    try {
      await applyMovement({
        tenantId, userId: auth.userId, productId: l.productId, type: "return", quantity: qty,
        warehouseId: cur.warehouseId, lots, reason: `Avoir ${creditNote.number}`,
        linkedDocType: "invoice", linkedDocId: creditNote._id, linkedDocNumber: creditNote.number,
      }, session);
    } catch (e) {
      // Article suivi dont les lots livrés sont inconnus : retour à saisir à la main.
      if (e instanceof StockError) continue;
      throw e;
    }
    cur.qty -= qty;
    count++;
  }
  return count;
}
