import type { ClientSession } from "mongoose";
import { DeliveryNoteModel } from "@/models/DeliveryNote";

/**
 * Livré par ligne de facture.
 *
 * Un bon de livraison sortait du stock ce qu'on y saisissait, sans regarder ce
 * qui avait déjà été livré : on pouvait livrer deux fois la même facture, ou
 * plus que facturé. Chaque ligne de bon est désormais rattachée à sa ligne de
 * facture et plafonnée au reste à livrer.
 */

export interface InvoiceLineLite { description?: string; quantity?: number; unit?: string; productId?: unknown }
export interface DeliveryLineIn { invoiceLineIndex?: unknown; description?: unknown; quantity?: unknown; productId?: unknown }

/** Quantités déjà livrées, par index de ligne de facture (bons retournés exclus). */
export async function deliveredByLine(tenantId: string, invoiceId: unknown, session?: ClientSession): Promise<Map<number, number>> {
  const notes = await DeliveryNoteModel.find({ tenantId, invoiceId, status: { $nin: ["draft", "returned"] } })
    .select("lines.invoiceLineIndex lines.quantity").session(session ?? null)
    .lean<Array<{ lines: Array<{ invoiceLineIndex?: number; quantity: number }> }>>();
  const map = new Map<number, number>();
  for (const n of notes) for (const l of n.lines) {
    if (typeof l.invoiceLineIndex === "number") map.set(l.invoiceLineIndex, (map.get(l.invoiceLineIndex) ?? 0) + (l.quantity || 0));
  }
  return map;
}

/** Lignes de la facture avec livré et reste à livrer. */
export function remainingLines(lines: InvoiceLineLite[], delivered: Map<number, number>) {
  return lines.map((l, i) => {
    const done = delivered.get(i) ?? 0;
    return { invoiceLineIndex: i, description: l.description, unit: l.unit || "unité", productId: l.productId,
      quantity: l.quantity ?? 0, delivered: done, remaining: Math.max(0, (l.quantity ?? 0) - done) };
  });
}

/**
 * Rattache chaque ligne demandée à une ligne de facture (index fourni, sinon
 * même article ou même libellé ayant encore un reste) et vérifie le plafond.
 * Renvoie les lignes normalisées, ou un message d'erreur.
 */
export function allocateDelivery(lines: InvoiceLineLite[], delivered: Map<number, number>, requested: DeliveryLineIn[]):
  { ok: true; lines: Array<{ invoiceLineIndex: number; description: string; quantity: number; productId?: unknown }> } | { ok: false; error: string } {
  const left = remainingLines(lines, delivered).map(l => l.remaining);
  const out: Array<{ invoiceLineIndex: number; description: string; quantity: number; productId?: unknown }> = [];
  for (const [k, r] of requested.entries()) {
    const qty = Number(r.quantity);
    if (!(qty > 0)) continue;
    let idx = r.invoiceLineIndex !== undefined && r.invoiceLineIndex !== null && r.invoiceLineIndex !== "" ? Number(r.invoiceLineIndex) : -1;
    if (idx < 0) {
      idx = lines.findIndex((l, i) => left[i] > 0 && (
        (r.productId && l.productId && String(l.productId) === String(r.productId))
        || (!r.productId && String(l.description ?? "").trim() === String(r.description ?? "").trim())));
    }
    const src = lines[idx];
    if (!Number.isInteger(idx) || !src) return { ok: false, error: `Ligne ${k + 1} : elle ne correspond à aucune ligne de la facture.` };
    if (qty > left[idx] + 1e-9) {
      return { ok: false, error: `« ${src.description ?? `Ligne ${idx + 1}`} » : ${qty} demandé, ${left[idx]} restant à livrer (${src.quantity ?? 0} facturé).` };
    }
    left[idx] -= qty;
    out.push({ invoiceLineIndex: idx, description: String(src.description ?? ""), quantity: qty, ...(src.productId ? { productId: src.productId } : {}) });
  }
  if (out.length === 0) return { ok: false, error: "Aucune quantité à livrer." };
  return { ok: true, lines: out };
}
