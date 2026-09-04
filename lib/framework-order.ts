/**
 * Marché-cadre (commande-cadre) : une quantité annuelle commandée par un client,
 * livrée par **lots** au fil de la période, et facturée au fur et à mesure.
 *
 * Le cas type : des cartes étudiantes vendues à une université, fabriquées à
 * partir d'un stock d'intrants (numéros ISIC), livrées par tranches. Trois
 * quantités se suivent et ne se dépassent jamais :
 *
 *     commandée  ≥  livrée  ≥  facturée
 *
 * Ce module est pur : il calcule les reliquats et les garde-fous, sans toucher
 * la base. Les mêmes fonctions servent l'écran (aperçu) et l'API (contrôle).
 */

export interface FrameworkOrderLike {
  totalQuantity: number;
  deliveredQuantity?: number;
  invoicedQuantity?: number;
  unitPrice: number;
  tvaRate?: number;
  status?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  /** Intrant consommé par unité livrée (ex. 1 numéro ISIC par carte). */
  inputPerUnit?: number;
}

export interface OrderProgress {
  total: number;
  delivered: number;
  invoiced: number;
  /** Reste à livrer = commandé − livré. */
  toDeliver: number;
  /** Reste à facturer = livré − facturé (on ne facture que ce qui est livré). */
  toInvoice: number;
  deliveredPct: number;
  invoicedPct: number;
  /** Valeur du reste à livrer, au prix unitaire. */
  remainingValueTTC: number;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function orderProgress(order: FrameworkOrderLike): OrderProgress {
  const total = order.totalQuantity || 0;
  const delivered = order.deliveredQuantity || 0;
  const invoiced = order.invoicedQuantity || 0;
  const toDeliver = Math.max(0, total - delivered);
  const toInvoice = Math.max(0, delivered - invoiced);
  const line = lotTotals(toDeliver, order.unitPrice, order.tvaRate);
  return {
    total, delivered, invoiced, toDeliver, toInvoice,
    deliveredPct: total > 0 ? clampPct((delivered / total) * 100) : 0,
    invoicedPct: total > 0 ? clampPct((invoiced / total) * 100) : 0,
    remainingValueTTC: line.ttc,
  };
}

export type DeliveryCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "over_delivery" | "closed"; message: string };

/**
 * Peut-on livrer `qty` unités de plus ? On refuse au-delà du reste à livrer :
 * un lot qui dépasse la commande n'est pas une livraison, c'est une erreur de
 * saisie qui gonflerait la facturation d'un client au-delà de ce qu'il a commandé.
 */
export function canDeliver(order: FrameworkOrderLike, qty: number): DeliveryCheck {
  if (order.status === "cancelled" || order.status === "completed") {
    return { ok: false, reason: "closed", message: "Ce marché est clôturé : aucun nouveau lot." };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: "invalid", message: "La quantité livrée doit être positive." };
  }
  const remaining = Math.max(0, (order.totalQuantity || 0) - (order.deliveredQuantity || 0));
  if (qty > remaining) {
    return {
      ok: false, reason: "over_delivery",
      message: `Il ne reste que ${remaining} à livrer sur ce marché ; ${qty} dépasserait la commande.`,
    };
  }
  return { ok: true };
}

/** Peut-on facturer `qty` unités ? On ne facture que ce qui est livré et pas encore facturé. */
export function canInvoice(order: FrameworkOrderLike, qty: number): DeliveryCheck {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: "invalid", message: "Quantité à facturer invalide." };
  }
  const toInvoice = Math.max(0, (order.deliveredQuantity || 0) - (order.invoicedQuantity || 0));
  if (qty > toInvoice) {
    return {
      ok: false, reason: "over_delivery",
      message: `Seules ${toInvoice} unités livrées restent à facturer ; on ne facture pas d'avance.`,
    };
  }
  return { ok: true };
}

export interface LineTotals { ht: number; tva: number; ttc: number }

/** Montants d'un lot de `qty` unités au prix unitaire, arrondis au franc. */
export function lotTotals(qty: number, unitPrice: number, tvaRate = 0.19): LineTotals {
  const ht = Math.round((qty || 0) * (unitPrice || 0));
  const tva = Math.round(ht * (tvaRate || 0));
  return { ht, tva, ttc: ht + tva };
}

/** Intrants consommés par un lot (ex. numéros ISIC). Défaut : 1 par unité. */
export function inputConsumption(order: FrameworkOrderLike, qty: number): number {
  const per = order.inputPerUnit && order.inputPerUnit > 0 ? order.inputPerUnit : 1;
  return Math.round(qty * per);
}

/** Un marché est complet quand tout est livré ET facturé. */
export function isFullyCompleted(order: FrameworkOrderLike): boolean {
  const total = order.totalQuantity || 0;
  return total > 0
    && (order.deliveredQuantity || 0) >= total
    && (order.invoicedQuantity || 0) >= total;
}
