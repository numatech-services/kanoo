import type { ClientSession } from "mongoose";
import { PaymentModel } from "@/models/Payment";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { TenantModel } from "@/models/Tenant";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { localDay } from "@/lib/format";

/**
 * Correction d'une facture déjà émise par l'administrateur de l'organisation
 * (« correction contrôlée ») : le contenu (client, date, lignes) est réécrit
 * sous le même numéro, l'écriture de vente extournée puis repassée, l'avant et
 * l'après gardés au journal d'audit.
 *
 * Elle n'est permise que tant que la facture n'a produit aucun effet qu'elle
 * remettrait en cause — sinon, l'avoir reste la seule voie :
 *  - certifiée SECeF (la DGI détient déjà son contenu) ;
 *  - un encaissement, un avoir, une livraison, une créance douteuse ou
 *    irrécouvrable s'y rattache ;
 *  - facture de marché, ou acompte déjà déduit d'une facture de solde ;
 *  - période comptable verrouillée, ou TVA du mois déjà déclarée ;
 *  - changement d'année de la date (le numéro porte l'année).
 * Le client ne change pas : une facture à un autre débiteur est une autre
 * facture (avoir, puis nouvelle facture). Le motif est obligatoire.
 * La TVA « déclarée » est celle saisie dans Kanoo (Fiscalité) : une
 * déclaration déposée ailleurs n'est pas connue — l'écran le rappelle.
 */
export const REASON_MIN = 5;

export interface CorrectionFacts {
  payments: number;
  deliveries: number;
  lockedUntil?: Date | null;
  vatDeclared: boolean;
}

export interface CorrectableInvoice {
  status: string; documentType?: string; kind?: string; secef?: { code?: string } | null;
  paidAmount?: number; creditedAmount?: number; depositUsedHT?: number; doubtfulAt?: Date | null;
  contractId?: unknown; issueDate: Date; lines?: Array<{ kind?: string }>;
}

export function correctionBlock(inv: CorrectableInvoice, f: CorrectionFacts, newIssueDate?: Date | null): string | null {
  if (inv.documentType === "credit_note") return "Un avoir ne se corrige pas : émettez un nouvel avoir ; pour l'annuler, émettez une facture.";
  if (inv.status === "cancelled") return "Facture annulée : elle ne se corrige plus.";
  if (inv.status === "written_off" || inv.doubtfulAt) return "Créance douteuse ou irrécouvrable : corrigez par un avoir.";
  if (inv.secef?.code) return "Facture certifiée SECeF : son contenu est déjà transmis à la DGI. Émettez un avoir puis une nouvelle facture.";
  if ((inv.paidAmount ?? 0) > 0 || f.payments > 0) return "Des encaissements sont enregistrés sur cette facture : annulez-les d'abord, ou émettez un avoir.";
  if ((inv.creditedAmount ?? 0) > 0) return "Un avoir a déjà été émis sur cette facture : corrigez par un nouvel avoir.";
  if (inv.contractId) return "Facture de marché : émettez un avoir, puis refacturez depuis la fiche du marché.";
  if (inv.lines?.some(l => l.kind === "deposit_deduction")) return "Facture qui déduit des acomptes : corrigez par un avoir.";
  if (inv.kind === "deposit" && (inv.depositUsedHT ?? 0) > 0) return "Acompte déjà déduit d'une facture de solde : corrigez par un avoir.";
  if (f.deliveries > 0) return "Des bons de livraison sont établis sur cette facture : supprimez-les d'abord, ou émettez un avoir.";
  const day = localDay(inv.issueDate), lock = f.lockedUntil ? localDay(f.lockedUntil) : null;
  if (lock && day <= lock) return `Période comptable verrouillée jusqu'au ${new Date(f.lockedUntil!).toLocaleDateString("fr-FR", { timeZone: "UTC" })} : corrigez par un avoir.`;
  if (f.vatDeclared) return "La TVA du mois de cette facture (ou de sa nouvelle date) est déjà déclarée : corrigez par un avoir.";
  if (newIssueDate) {
    const nd = localDay(newIssueDate);
    if (lock && nd <= lock) return "La nouvelle date tombe dans une période comptable verrouillée.";
    if (nd.slice(0, 4) !== day.slice(0, 4)) return "La date ne peut pas changer d'année : le numéro de la facture porte son année.";
  }
  return null;
}

/**
 * Faits qui bloquent une correction. `newIssueDate` : la TVA du mois d'arrivée
 * compte aussi (déplacer une facture vers un mois déjà déclaré le fausserait).
 */
export async function correctionFacts(tenantId: string, inv: { _id: unknown; issueDate: Date }, newIssueDate?: Date | null, session?: ClientSession): Promise<CorrectionFacts> {
  const months = [...new Set([inv.issueDate, newIssueDate].filter(Boolean).map(d => localDay(d!).slice(0, 7)))].map(k => k.split("-").map(Number));
  // Dans une transaction, les lectures se font l'une après l'autre : des
  // opérations simultanées sur une même session MongoDB font échouer la
  // transaction (« NoSuchTransaction »).
  const reads: Array<() => Promise<unknown>> = [
    () => PaymentModel.countDocuments({ tenantId, invoiceId: inv._id, status: { $ne: "cancelled" } }).session(session ?? null),
    () => DeliveryNoteModel.countDocuments({ tenantId, invoiceId: inv._id }).session(session ?? null),
    () => TenantModel.findById(tenantId).select("accountingLockedUntil").session(session ?? null).lean<{ accountingLockedUntil?: Date } | null>(),
    () => FiscalDeclarationModel.exists({
      tenantId, type: "tva", status: { $in: ["submitted", "paid", "late"] },
      $or: months.flatMap(([y, m]) => [
        { "period.annee": y, "period.mois": m },
        { "period.annee": y, "period.trimestre": Math.ceil(m / 3), "period.mois": { $in: [null] } },
      ]),
    }).session(session ?? null),
  ];
  const out: unknown[] = [];
  if (session) for (const r of reads) out.push(await r());
  else out.push(...await Promise.all(reads.map(r => r())));
  const [payments, deliveries, tenant, vat] = out as [number, number, { accountingLockedUntil?: Date } | null, unknown];
  return { payments, deliveries, lockedUntil: tenant?.accountingLockedUntil ?? null, vatDeclared: !!vat };
}

/** Empreinte du contenu imprimé et comptabilisé d'une ligne : une correction ne part que si elle change vraiment. */
export function contentKey(x: { clientId?: unknown; issueDate?: Date | string; lines?: Array<Record<string, unknown>> }) {
  const lines = (x.lines ?? []).map(l => [l.description, l.details ?? "", l.section ?? "", l.unit ?? "", Number(l.quantity), Number(l.unitPrice), Number(l.tvaRate ?? 0), Number(l.discount ?? 0), String(l.productId ?? "")]);
  return JSON.stringify([String(x.clientId ?? ""), x.issueDate ? localDay(new Date(x.issueDate)) : "", lines]);
}
