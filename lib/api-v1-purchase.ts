import { createHash } from "crypto";
import { texte, date } from "@/lib/api-v1-draft";

/**
 * Brouillon d'achat fournisseur reçu par l'API v1 (docs/API-ACHATS.md).
 * Liste blanche stricte : l'appelant transmet la facture du fournisseur telle
 * qu'elle est (lignes hors taxes, TVA portée par la pièce) ; le compte de
 * charge, la validation, l'écriture et les règlements restent à Kanoo.
 */
export interface PurchaseDraftLine { description: string; quantity: number; unitPrice: number }
export interface PurchaseDraft {
  externalRef: string; supplierCode: string; supplierInvoiceRef: string;
  issueDate: Date; dueDate: Date; vatAmount: number;
  object?: string; reference?: string; period?: string;
  lines: PurchaseDraftLine[];
}

const MAX_LINES = 50;
const MAX_MONTANT = 1_000_000_000;
const entier = (v: unknown) => typeof v === "number" && Number.isInteger(v);

export function parsePurchaseDraft(body: unknown): { draft: PurchaseDraft } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Corps JSON attendu." };
  const b = body as Record<string, unknown>;
  const externalRef = typeof b.externalRef === "string" && /^[A-Za-z0-9._:-]{3,120}$/.test(b.externalRef) ? b.externalRef : null;
  if (!externalRef) return { error: "externalRef invalide (3 à 120 caractères : lettres, chiffres, . _ : -)." };
  const supplierCode = texte(b.supplierCode, 60);
  if (!supplierCode) return { error: "supplierCode obligatoire." };
  const supplierInvoiceRef = texte(b.supplierInvoiceRef, 61);
  if (!supplierInvoiceRef || supplierInvoiceRef.length > 60) return { error: "supplierInvoiceRef obligatoire, 1 à 60 caractères (numéro de la facture du fournisseur)." };
  const issueDate = date(b.issueDate), dueDate = date(b.dueDate);
  if (!issueDate || !dueDate) return { error: "issueDate et dueDate au format AAAA-MM-JJ." };
  if (dueDate < issueDate) return { error: "L'échéance précède la date de la facture." };
  if (!entier(b.vatAmount) || (b.vatAmount as number) < 0) return { error: "vatAmount obligatoire : TVA de la facture en F CFA entiers, 0 si elle n'en porte pas." };
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > MAX_LINES) return { error: `De 1 à ${MAX_LINES} lignes.` };
  const lines: PurchaseDraftLine[] = [];
  for (const l of b.lines) {
    const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
    const description = texte(o.description, 200);
    if (!description || !entier(o.quantity) || (o.quantity as number) <= 0 || (o.quantity as number) > MAX_MONTANT
      || !entier(o.unitPrice) || (o.unitPrice as number) <= 0 || (o.unitPrice as number) > MAX_MONTANT) {
      return { error: "Ligne invalide : description, quantité entière positive, prix unitaire hors taxes en F CFA entiers strictement positif." };
    }
    if ((o.quantity as number) * (o.unitPrice as number) > MAX_MONTANT) return { error: "Montant de ligne hors limites." };
    lines.push({ description, quantity: o.quantity as number, unitPrice: o.unitPrice as number });
  }
  const totalHT = lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0);
  // Garde-fou : une TVA de plus de 99 % du hors taxes est une erreur de saisie (taux légaux bien plus bas).
  if ((b.vatAmount as number) * 100 > totalHT * 99) return { error: "vatAmount anormalement élevée par rapport au total hors taxes." };
  return { draft: { externalRef, supplierCode, supplierInvoiceRef, issueDate, dueDate, vatAmount: b.vatAmount as number,
    object: texte(b.object, 600), reference: texte(b.reference, 120), period: texte(b.period, 120), lines } };
}

/** Compte provisoire des lignes : le comptable choisit le compte de charge avant de valider. */
export const DRAFT_EXPENSE_ACCOUNT = { accountCode: "608000", accountLabel: "Achats divers (à imputer)" };

/** Répartit une TVA entière au prorata de montants (plus forts restes) : somme exacte, jamais négative. */
export function distributeVat(amounts: number[], vat: number): number[] {
  const total = amounts.reduce((t, a) => t + a, 0);
  if (!(total > 0) || !(vat > 0)) return amounts.map(() => 0);
  const shares = amounts.map(a => (vat * a) / total);
  const out = shares.map(Math.floor);
  let rest = vat - out.reduce((t, v) => t + v, 0);
  for (const i of shares.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]).map(x => x[1])) { if (rest <= 0) break; out[i]++; rest--; }
  return out;
}

/** Lignes d'achat Kanoo : TVA de la pièce reprise telle quelle, répartie sur les lignes. */
export function purchaseLinesFromDraft(d: PurchaseDraft) {
  const amounts = d.lines.map(l => l.quantity * l.unitPrice);
  const totalHT = amounts.reduce((t, a) => t + a, 0);
  const tva = distributeVat(amounts, d.vatAmount);
  const lines = d.lines.map((l, i) => ({ description: l.description, ...DRAFT_EXPENSE_ACCOUNT, quantity: l.quantity, unitPrice: l.unitPrice,
    amountHT: amounts[i], tvaRate: Math.round((d.vatAmount / totalHT) * 10000) / 10000, amountTVA: tva[i] }));
  return { lines, totalHT, totalTVA: d.vatAmount, totalTTC: totalHT + d.vatAmount };
}

/** Empreinte du contenu reçu : un rejeu identique rend la pièce, un contenu différent est refusé (409). */
export function draftHash(d: PurchaseDraft) {
  return createHash("sha256").update(JSON.stringify([d.supplierCode, d.supplierInvoiceRef.toUpperCase(), d.issueDate.toISOString().slice(0, 10), d.dueDate.toISOString().slice(0, 10),
    d.vatAmount, d.lines.map(l => [l.description, l.quantity, l.unitPrice])])).digest("hex");
}
