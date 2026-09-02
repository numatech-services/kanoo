/**
 * Factures d'avoir.
 *
 * Une facture émise ne se supprime pas — a fortiori une facture certifiée
 * SECeF, dont le code engage l'assujetti. La seule correction admise est
 * l'émission d'un avoir qui référence la facture d'origine et s'en retranche.
 *
 * Fonctions pures : elles reçoivent la facture et la demande, et rendent soit
 * un avoir calculé, soit un refus motivé. Aucun accès base, aucune horloge.
 */

import { calculerTVA, TVA_TAUX_STANDARD } from "./niger-fiscal";

export interface InvoiceLineLike {
  description: string;
  quantity: number;
  unitPrice: number;
  tvaRate?: number;
  discount?: number;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  productId?: unknown;
}

export interface InvoiceLike {
  _id: unknown;
  number: string;
  documentType?: string;
  status: string;
  lines: InvoiceLineLike[];
  totalHT: number;
  totalTVA: number;
  totalDTS?: number;
  totalTTC: number;
  creditedAmount?: number;
  secef?: { code?: string };
}

/** Une ligne que l'utilisateur choisit d'avoir, en tout ou partie. */
export interface CreditLineRequest {
  /** Index de la ligne dans la facture d'origine. */
  lineIndex: number;
  /** Quantité à créditer. Doit rester inférieure ou égale à l'originale. */
  quantity: number;
}

export interface CreditNoteDraft {
  lines: InvoiceLineLike[];
  totalHT: number;
  totalTVA: number;
  totalDTS: number;
  totalTTC: number;
  /** Vrai si l'avoir couvre l'intégralité du restant à créditer. */
  isFull: boolean;
}

export type CreditNoteResult =
  | { ok: true; draft: CreditNoteDraft }
  | { ok: false; error: string };

/** Montant TTC encore créditable sur une facture. */
export function creditableAmount(invoice: InvoiceLike): number {
  return Math.max(0, invoice.totalTTC - (invoice.creditedAmount || 0));
}

/**
 * Une facture peut-elle recevoir un avoir ?
 *
 * Les refus sont explicites plutôt que silencieux : un utilisateur qui ne peut
 * pas créditer doit savoir pourquoi, sinon il ressaisira.
 */
export function canCredit(invoice: InvoiceLike): { ok: true } | { ok: false; error: string } {
  if (invoice.documentType === "credit_note") {
    return { ok: false, error: "Un avoir ne peut pas faire l'objet d'un autre avoir." };
  }
  if (invoice.status === "draft") {
    return {
      ok: false,
      error: "Cette facture est un brouillon : modifiez-la directement plutôt que d'émettre un avoir.",
    };
  }
  if (invoice.status === "cancelled") {
    return { ok: false, error: "Cette facture est annulée." };
  }
  if (creditableAmount(invoice) <= 0) {
    return { ok: false, error: "Cette facture est déjà intégralement créditée." };
  }
  return { ok: true };
}

/**
 * Construit l'avoir à partir des lignes retenues.
 *
 * Les totaux sont recalculés ligne par ligne, jamais repris de la facture
 * d'origine : un avoir partiel ne se déduit pas d'une règle de trois, et
 * reprendre les totaux d'origine sur une sélection produirait un avoir
 * supérieur à ce qui est crédité.
 *
 * Le droit de timbre suit la même logique de proportion que dans la facture,
 * mais n'est repris qu'en cas d'avoir total : un timbre est un forfait par
 * document, il ne se fractionne pas.
 */
export function buildCreditNote(
  invoice: InvoiceLike,
  requested: CreditLineRequest[] | "full"
): CreditNoteResult {
  const eligibility = canCredit(invoice);
  if (!eligibility.ok) return { ok: false, error: eligibility.error };

  // ── Avoir total ────────────────────────────────────────────────────────
  if (requested === "full") {
    const remaining = creditableAmount(invoice);
    if (remaining < invoice.totalTTC) {
      return {
        ok: false,
        error:
          "Cette facture a déjà fait l'objet d'un avoir partiel. "
          + "Sélectionnez les lignes restantes plutôt qu'un avoir total.",
      };
    }
    return {
      ok: true,
      draft: {
        lines: invoice.lines.map(l => ({ ...l })),
        totalHT: invoice.totalHT,
        totalTVA: invoice.totalTVA,
        totalDTS: invoice.totalDTS || 0,
        totalTTC: invoice.totalTTC,
        isFull: true,
      },
    };
  }

  // ── Avoir partiel ──────────────────────────────────────────────────────
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, error: "Sélectionnez au moins une ligne à créditer." };
  }

  const seen = new Set<number>();
  const lines: InvoiceLineLike[] = [];
  let totalHT = 0;
  let totalTVA = 0;

  for (const req of requested) {
    const index = Number(req.lineIndex);
    const source = invoice.lines[index];
    if (!source) {
      return { ok: false, error: `Ligne ${index + 1} introuvable sur la facture.` };
    }
    if (seen.has(index)) {
      return { ok: false, error: `La ligne ${index + 1} est sélectionnée deux fois.` };
    }
    seen.add(index);

    const quantity = Number(req.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `Quantité invalide sur la ligne ${index + 1}.` };
    }
    if (quantity > source.quantity) {
      return {
        ok: false,
        error: `Ligne ${index + 1} : ${quantity} demandé pour ${source.quantity} facturé.`,
      };
    }

    // Même arrondi que sur la facture : la somme des lignes arrondies fait le
    // total, et non l'arrondi d'une somme.
    const rate = source.tvaRate ?? TVA_TAUX_STANDARD;
    const lineHT = Math.round(quantity * source.unitPrice * (1 - (source.discount || 0) / 100));
    const lineTVA = calculerTVA(lineHT, rate);

    totalHT += lineHT;
    totalTVA += lineTVA;
    lines.push({
      description: source.description,
      quantity,
      unitPrice: source.unitPrice,
      tvaRate: rate,
      discount: source.discount,
      productId: source.productId,
      totalHT: lineHT,
      totalTVA: lineTVA,
      totalTTC: lineHT + lineTVA,
    });
  }

  const isFull = lines.length === invoice.lines.length
    && requested.every((req, i) => {
      const source = invoice.lines[Number(req.lineIndex)];
      return source && Number(req.quantity) === source.quantity;
    })
    && requested.length === invoice.lines.length;

  // Le timbre est un forfait par document : repris intégralement sur un avoir
  // total, jamais fractionné sur un avoir partiel.
  const totalDTS = isFull ? (invoice.totalDTS || 0) : 0;
  const totalTTC = totalHT + totalTVA + totalDTS;

  const remaining = creditableAmount(invoice);
  if (totalTTC > remaining) {
    return {
      ok: false,
      error:
        `L'avoir demandé (${totalTTC.toLocaleString("fr-FR")} XOF) dépasse le montant `
        + `encore créditable (${remaining.toLocaleString("fr-FR")} XOF).`,
    };
  }

  return { ok: true, draft: { lines, totalHT, totalTVA, totalDTS, totalTTC, isFull } };
}

/**
 * Écriture comptable d'extourne.
 *
 * Exactement l'inverse de l'écriture de vente : le client est crédité, les
 * produits et la TVA collectée sont débités. L'équilibre est vérifié par
 * l'appelant avant enregistrement — une écriture déséquilibrée fausse la
 * balance sans jamais se signaler.
 */
export function reversalEntryLines(
  draft: CreditNoteDraft,
  clientId: unknown
): Array<{ accountCode: string; accountLabel: string; debit: number; credit: number; thirdPartyId?: unknown }> {
  return [
    { accountCode: "706000", accountLabel: "Prestations de services", debit: draft.totalHT, credit: 0 },
    ...(draft.totalTVA > 0
      ? [{ accountCode: "443000", accountLabel: "TVA collectée", debit: draft.totalTVA, credit: 0 }]
      : []),
    ...(draft.totalDTS > 0
      ? [{ accountCode: "447000", accountLabel: "Droits de timbre", debit: draft.totalDTS, credit: 0 }]
      : []),
    { accountCode: "411000", accountLabel: "Clients", debit: 0, credit: draft.totalTTC, thirdPartyId: clientId },
  ];
}
