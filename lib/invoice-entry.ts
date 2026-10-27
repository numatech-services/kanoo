import type { ClientSession } from "mongoose";
import { ProductModel } from "@/models/Product";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { reverseEntry } from "@/lib/accounting-reversal";
import { calculerTVA, calculerDTS, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { DEPOSIT_ACCOUNT } from "@/lib/deposit";
import { RETENTION_ACCOUNT } from "@/lib/retention";

export interface InvoiceLineIn { description?: string; quantity?: number; unitPrice?: number; tvaRate?: number; discount?: number; productId?: unknown; kind?: "deposit_deduction"; depositInvoiceId?: unknown }

/**
 * Totaux d'une facture : somme des lignes arrondies (jamais l'arrondi de la somme).
 * Une ligne de déduction d'acompte (prix négatif) n'est admise que si
 * l'appelant la construit lui-même (`allowDeduction`) : jamais depuis la saisie.
 */
export function computeInvoiceLines(raw: InvoiceLineIn[], opts: { allowDeduction?: boolean } = {}) {
  let totalHT = 0, totalTVA = 0;
  const lines = raw.map(input => {
    const { kind, depositInvoiceId, ...rest } = input;
    const line: InvoiceLineIn = opts.allowDeduction && kind === "deposit_deduction" ? { ...rest, kind, depositInvoiceId } : rest;
    const q = Number(line.quantity) || 0, pu = Number(line.unitPrice) || 0;
    const lineHT = Math.round(q * pu * (1 - (Number(line.discount) || 0) / 100));
    const lineTVA = calculerTVA(lineHT, line.tvaRate ?? TVA_TAUX_STANDARD);
    totalHT += lineHT; totalTVA += lineTVA;
    return { ...line, quantity: q, unitPrice: pu, totalHT: lineHT, totalTVA: lineTVA, totalTTC: lineHT + lineTVA };
  });
  const totalDTS = calculerDTS(totalHT + totalTVA);
  return { lines, totalHT, totalTVA, totalDTS, totalTTC: totalHT + totalTVA + totalDTS };
}

export { DEPOSIT_ACCOUNT };

/**
 * Lignes de l'écriture de vente (VT). Le chiffre d'affaires est ventilé par
 * compte de produit — celui de l'article (marchandises 701, services 706…) —
 * et porte l'imputation de la facture (projet, secteur) : c'est ce qui
 * alimente les recettes des projets et la rentabilité par secteur.
 */
export async function saleEntryLines(
  tenantId: string,
  inv: { clientId: unknown; lines: Array<{ productId?: unknown; totalHT: number; kind?: string }>; totalTVA: number; totalDTS: number; totalTTC: number; projectId?: unknown; activityId?: unknown; kind?: string; retentionAmount?: number },
  session?: ClientSession,
) {
  // Facture d'acompte : avance reçue (419), pas encore du chiffre d'affaires.
  // Facture finale : l'acompte déduit solde 419 au débit ; les produits portent tout le marché.
  const deduction = -inv.lines.filter(l => l.kind === "deposit_deduction").reduce((t, l) => t + l.totalHT, 0);
  const sales = inv.lines.filter(l => l.kind !== "deposit_deduction");
  const ids = inv.lines.map(l => l.productId).filter(Boolean);
  const products = ids.length
    ? await ProductModel.find({ tenantId, _id: { $in: ids } }).select("accountCode isService").session(session ?? null).lean<Array<{ _id: unknown; accountCode?: string; isService?: boolean }>>()
    : [];
  const byId = new Map(products.map(p => [String(p._id), p]));
  const byAccount = new Map<string, number>();
  for (const l of sales) {
    const p = l.productId ? byId.get(String(l.productId)) : undefined;
    const code = inv.kind === "deposit" ? DEPOSIT_ACCOUNT.accountCode
      : p?.accountCode && /^7\d{2,7}$/.test(p.accountCode) ? p.accountCode : p && !p.isService ? "701100" : "706000";
    byAccount.set(code, (byAccount.get(code) ?? 0) + l.totalHT);
  }
  const LABELS: Record<string, string> = { "701100": "Ventes de marchandises", "706000": "Prestations de services", [DEPOSIT_ACCOUNT.accountCode]: DEPOSIT_ACCOUNT.accountLabel };
  const tags = { ...(inv.projectId ? { projectId: inv.projectId } : {}), ...(inv.activityId ? { activityId: inv.activityId } : {}) };
  // Retenue de garantie : la part gardée par le maître d'ouvrage passe au 4117
  // (due à la réception définitive) ; le 411 ne porte que l'exigible.
  const retention = Math.min(Math.max(0, Math.round(inv.retentionAmount ?? 0)), inv.totalTTC);
  return [
    { accountCode: "411000", accountLabel: "Clients", debit: inv.totalTTC - retention, credit: 0, thirdPartyId: inv.clientId },
    ...(retention > 0 ? [{ ...RETENTION_ACCOUNT, debit: retention, credit: 0, thirdPartyId: inv.clientId }] : []),
    ...(deduction > 0 ? [{ ...DEPOSIT_ACCOUNT, debit: deduction, credit: 0, thirdPartyId: inv.clientId }] : []),
    // Un solde négatif (déduction d'acompte supérieure aux lignes d'un compte)
    // passe au débit : un crédit négatif rend l'écriture invalide.
    ...[...byAccount.entries()].filter(([, v]) => v !== 0).map(([code, v]) => ({
      accountCode: code, accountLabel: LABELS[code] ?? "Ventes", debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0,
      ...(code === DEPOSIT_ACCOUNT.accountCode ? { thirdPartyId: inv.clientId } : tags),
    })),
    // TVA nette négative (acompte à 19 %, solde à 0 %) : elle était omise, et
    // l'écriture déséquilibrée faisait échouer l'émission. Elle régularise la
    // TVA collectée sur l'acompte, au débit.
    ...(inv.totalTVA > 0 ? [{ accountCode: "443000", accountLabel: "TVA collectée", debit: 0, credit: inv.totalTVA }]
      : inv.totalTVA < 0 ? [{ accountCode: "443000", accountLabel: "TVA collectée (régularisation d'acompte)", debit: -inv.totalTVA, credit: 0 }] : []),
    ...(inv.totalDTS > 0 ? [{ accountCode: "447000", accountLabel: "Droits de timbre", debit: 0, credit: inv.totalDTS }] : []),
  ];
}

/** Écriture de vente active (non extournée) d'une facture. */
export function findSaleEntry(tenantId: string, invoiceId: unknown, session?: ClientSession) {
  return AccountingEntryModel.findOne({
    tenantId, linkedDocType: "invoice", linkedDocId: invoiceId, journalCode: "VT", reversedBy: { $exists: false }, reverses: { $exists: false },
  }).session(session ?? null);
}

/** Annulation d'une facture : son écriture de vente est extournée. */
export async function reverseSaleEntry(opts: { tenantId: string; userId: string; invoiceId: unknown; reason: string }, session?: ClientSession) {
  const entry = await findSaleEntry(opts.tenantId, opts.invoiceId, session);
  if (entry) await reverseEntry({ tenantId: opts.tenantId, userId: opts.userId, entryId: entry._id, reason: opts.reason }, session);
}
