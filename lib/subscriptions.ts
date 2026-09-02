/**
 * Rapprochement achat / revente des abonnements.
 *
 * Fonctions pures : elles reçoivent des enregistrements déjà chargés et ne
 * touchent ni la base ni l'horloge — la date d'appréciation est toujours un
 * paramètre. C'est ce qui rend les alertes reproductibles et le calcul de marge
 * vérifiable par un test plutôt que par une capture d'écran.
 */

import { IS_TAUX_PME, RETENUES_DETAILLEES } from "./niger-fiscal";

// ─────────────────────────────────────────────────────────────────────────────
// Formes attendues
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseLike {
  _id: unknown;
  reference: string;
  productName: string;
  startDate: Date | string;
  endDate: Date | string;
  quantity: number;
  costAmount: number;
  withholdingAmount?: number;
  purchaseVatAmount?: number;
  bankFeesAmount?: number;
  noticeDays?: number;
  autoRenew?: boolean;
  status?: string;
}

export interface SaleLike {
  _id: unknown;
  reference: string;
  purchaseId?: unknown;
  startDate: Date | string;
  endDate: Date | string;
  quantity: number;
  totalHT: number;
  totalTVA?: number;
  withholdingAmount?: number;
  invoiceId?: unknown;
  status?: string;
}

const day = 86_400_000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Jours entiers entre deux dates. Négatif si `to` précède `from`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / day);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coût de revient et marge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coût complet d'un abonnement souscrit.
 *
 * La retenue à la source et les frais bancaires sont des sorties de trésorerie
 * réelles : les ignorer gonfle la marge. La TVA supportée, elle, est en principe
 * récupérable et n'entre donc pas dans le coût de revient — elle est retournée
 * à part pour que l'écran puisse la montrer sans la mélanger.
 */
export function purchaseCost(purchase: PurchaseLike): {
  base: number;
  withholding: number;
  bankFees: number;
  /** Coût de revient retenu pour la marge. */
  total: number;
  /** TVA supportée, récupérable — hors coût de revient. */
  recoverableVat: number;
} {
  const base = purchase.costAmount || 0;
  const withholding = purchase.withholdingAmount || 0;
  const bankFees = purchase.bankFeesAmount || 0;
  return {
    base, withholding, bankFees,
    total: base + withholding + bankFees,
    recoverableVat: purchase.purchaseVatAmount || 0,
  };
}

export interface Reconciliation {
  purchaseRef: string;
  productName: string;
  /** Licences acquises. */
  quantityBought: number;
  /** Licences placées chez des clients. */
  quantitySold: number;
  quantityRemaining: number;
  /** Part du contrat placée, en pourcentage entier. */
  fillRate: number;

  cost: number;
  revenue: number;
  /** Revenu − coût complet. Peut être négatif. */
  margin: number;
  /** Marge rapportée au revenu, en pourcentage. Nul si aucun revenu. */
  marginRate: number;

  /** Coût unitaire moyen et prix de revente moyen, pour comparaison directe. */
  unitCost: number;
  averageUnitPrice: number;

  saleCount: number;
  /** Reventes actives dont la période dépasse celle du contrat amont. */
  overrunningSales: string[];
  /** Vrai si le nombre de licences placées dépasse le nombre acquis. */
  overSold: boolean;
  /** Reventes actives non encore facturées. */
  unbilledSales: string[];
}

/**
 * Rapproche un abonnement souscrit et les reventes qui s'y rattachent.
 *
 * Les reventes annulées sont exclues du décompte de licences — une revente
 * annulée libère sa part — mais restent hors du chiffre d'affaires.
 */
export function reconcile(purchase: PurchaseLike, sales: SaleLike[]): Reconciliation {
  const attached = sales.filter(s => String(s.purchaseId) === String(purchase._id));
  const live = attached.filter(s => s.status !== "cancelled");

  const quantityBought = purchase.quantity || 0;
  const quantitySold = live.reduce((sum, s) => sum + (s.quantity || 0), 0);
  const revenue = live.reduce((sum, s) => sum + (s.totalHT || 0), 0);

  const cost = purchaseCost(purchase).total;
  const margin = revenue - cost;

  const purchaseEnd = toDate(purchase.endDate);
  const overrunningSales = live
    .filter(s => toDate(s.endDate).getTime() > purchaseEnd.getTime())
    .map(s => s.reference);

  const unbilledSales = live
    .filter(s => !s.invoiceId && s.status !== "draft")
    .map(s => s.reference);

  return {
    purchaseRef: purchase.reference,
    productName: purchase.productName,
    quantityBought,
    quantitySold,
    quantityRemaining: quantityBought - quantitySold,
    fillRate: quantityBought > 0 ? Math.round((quantitySold / quantityBought) * 100) : 0,
    cost,
    revenue,
    margin,
    marginRate: revenue > 0 ? Math.round((margin / revenue) * 100) : 0,
    unitCost: quantityBought > 0 ? Math.round(cost / quantityBought) : 0,
    averageUnitPrice: quantitySold > 0 ? Math.round(revenue / quantitySold) : 0,
    saleCount: live.length,
    overrunningSales,
    overSold: quantitySold > quantityBought,
    unbilledSales,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertes
// ─────────────────────────────────────────────────────────────────────────────

export type AlertLevel = "critical" | "warning" | "info";

export interface SubscriptionAlert {
  level: AlertLevel;
  /** Famille d'alerte, pour le regroupement et les tests. */
  kind:
    | "purchase_expiring"
    | "purchase_expired"
    | "notice_deadline"
    | "sale_expiring"
    | "sale_beyond_purchase"
    | "over_sold"
    | "unbilled_sale"
    | "unsold_capacity";
  message: string;
  /** Référence concernée, pour renvoyer vers la fiche. */
  reference: string;
  daysLeft?: number;
}

const EXPIRY_HORIZON_DAYS = 60;

/**
 * Alertes d'un portefeuille d'abonnements à une date donnée.
 *
 * L'échéance de préavis est distinguée de l'échéance du contrat : sur un
 * abonnement à reconduction tacite, c'est la date limite de dénonciation qui
 * engage, pas la date de fin.
 */
export function buildAlerts(
  purchases: PurchaseLike[],
  sales: SaleLike[],
  asOf: Date = new Date()
): SubscriptionAlert[] {
  const alerts: SubscriptionAlert[] = [];

  for (const purchase of purchases) {
    if (purchase.status === "cancelled") continue;

    const end = toDate(purchase.endDate);
    const daysLeft = daysBetween(asOf, end);

    if (daysLeft < 0) {
      alerts.push({
        level: "critical", kind: "purchase_expired",
        reference: purchase.reference,
        message: `Contrat « ${purchase.productName} » expiré depuis ${Math.abs(daysLeft)} jour(s).`,
        daysLeft,
      });
    } else if (daysLeft <= EXPIRY_HORIZON_DAYS) {
      alerts.push({
        level: daysLeft <= 15 ? "critical" : "warning",
        kind: "purchase_expiring",
        reference: purchase.reference,
        message: `Contrat « ${purchase.productName} » à renouveler dans ${daysLeft} jour(s).`,
        daysLeft,
      });
    }

    // Reconduction tacite : la date qui engage est celle du préavis.
    if (purchase.autoRenew && purchase.noticeDays && daysLeft >= 0) {
      const daysToNotice = daysLeft - purchase.noticeDays;
      if (daysToNotice <= 30) {
        alerts.push({
          level: daysToNotice <= 0 ? "critical" : "warning",
          kind: "notice_deadline",
          reference: purchase.reference,
          message: daysToNotice <= 0
            ? `Préavis dépassé sur « ${purchase.productName} » : la reconduction est acquise.`
            : `Préavis de dénonciation de « ${purchase.productName} » dans ${daysToNotice} jour(s).`,
          daysLeft: daysToNotice,
        });
      }
    }

    const rec = reconcile(purchase, sales);

    if (rec.overSold) {
      alerts.push({
        level: "critical", kind: "over_sold",
        reference: purchase.reference,
        message: `${rec.quantitySold} licence(s) revendues pour ${rec.quantityBought} acquise(s) sur « ${purchase.productName} ».`,
      });
    }

    for (const ref of rec.overrunningSales) {
      alerts.push({
        level: "critical", kind: "sale_beyond_purchase",
        reference: ref,
        message: `La revente ${ref} court au-delà du contrat ${purchase.reference} : l'engagement client dépasse la couverture.`,
      });
    }

    // Capacité dormante : signalée seulement sur un contrat encore en cours.
    if (daysLeft > 0 && rec.quantityRemaining > 0 && rec.saleCount > 0) {
      alerts.push({
        level: "info", kind: "unsold_capacity",
        reference: purchase.reference,
        message: `${rec.quantityRemaining} licence(s) non placées sur « ${purchase.productName} » (${rec.fillRate} % du contrat vendu).`,
      });
    }
  }

  for (const sale of sales) {
    if (sale.status === "cancelled" || sale.status === "draft") continue;

    const daysLeft = daysBetween(asOf, toDate(sale.endDate));
    if (daysLeft >= 0 && daysLeft <= EXPIRY_HORIZON_DAYS) {
      alerts.push({
        level: daysLeft <= 15 ? "warning" : "info",
        kind: "sale_expiring",
        reference: sale.reference,
        message: `Revente ${sale.reference} à renouveler dans ${daysLeft} jour(s).`,
        daysLeft,
      });
    }

    if (!sale.invoiceId) {
      alerts.push({
        level: "warning", kind: "unbilled_sale",
        reference: sale.reference,
        message: `Revente ${sale.reference} active mais non facturée.`,
      });
    }
  }

  // Le plus urgent d'abord, puis l'échéance la plus proche.
  const weight: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) =>
    weight[a.level] - weight[b.level] ||
    (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Charges fiscales du portefeuille
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxSummary {
  /** TVA collectée sur les reventes. */
  vatCollected: number;
  /** TVA supportée sur les achats, récupérable. */
  vatRecoverable: number;
  /** Solde de TVA à reverser. Négatif = crédit de TVA reportable. */
  vatDue: number;
  /** Retenues opérées sur les règlements aux fournisseurs étrangers. */
  withholdingPaid: number;
  /** Retenues subies sur les encaissements clients. */
  withholdingSuffered: number;
  /** Marge brute du portefeuille. */
  grossMargin: number;
  /** IS estimé sur la marge, au taux normal. */
  estimatedCorporateTax: number;
  /** Marge après IS estimé. */
  marginAfterTax: number;
}

/**
 * Charges fiscales rattachables au portefeuille d'abonnements.
 *
 * ⚠ L'IS est une **estimation** appliquée à la marge de cette seule activité.
 * L'impôt réel se calcule sur le résultat fiscal de l'entreprise entière, après
 * toutes charges et retraitements, avec un minimum forfaitaire. Le chiffre sert
 * à arbitrer une politique de prix, pas à remplir une déclaration.
 */
export function taxSummary(purchases: PurchaseLike[], sales: SaleLike[]): TaxSummary {
  const live = sales.filter(s => s.status !== "cancelled" && s.status !== "draft");

  const vatCollected = live.reduce((sum, s) => sum + (s.totalTVA || 0), 0);
  const withholdingSuffered = live.reduce((sum, s) => sum + (s.withholdingAmount || 0), 0);
  const revenue = live.reduce((sum, s) => sum + (s.totalHT || 0), 0);

  const activePurchases = purchases.filter(p => p.status !== "cancelled");
  const vatRecoverable = activePurchases.reduce((sum, p) => sum + (p.purchaseVatAmount || 0), 0);
  const withholdingPaid = activePurchases.reduce((sum, p) => sum + (p.withholdingAmount || 0), 0);
  const cost = activePurchases.reduce((sum, p) => sum + purchaseCost(p).total, 0);

  const grossMargin = revenue - cost;
  const estimatedCorporateTax = grossMargin > 0 ? Math.round(grossMargin * IS_TAUX_PME) : 0;

  return {
    vatCollected,
    vatRecoverable,
    vatDue: vatCollected - vatRecoverable,
    withholdingPaid,
    withholdingSuffered,
    grossMargin,
    estimatedCorporateTax,
    marginAfterTax: grossMargin - estimatedCorporateTax,
  };
}

/**
 * Retenue à la source applicable à un règlement d'abonnement vers l'étranger.
 * Un abonnement logiciel relève de la prestation de services (CGI art. 118).
 */
export function suggestedWithholding(costAmount: number, foreignSupplier: boolean): number {
  if (!foreignSupplier || costAmount <= 0) return 0;
  return Math.round(costAmount * RETENUES_DETAILLEES.prestation_service.taux);
}

/**
 * Répartit un coût annuel sur les mois qu'il couvre, au prorata des jours.
 * Sert à étaler charge et produit sur la période plutôt qu'à les imputer
 * entièrement au mois de souscription.
 */
export function monthlyAllocation(
  amount: number,
  start: Date | string,
  end: Date | string
): Array<{ year: number; month: number; amount: number }> {
  const from = toDate(start);
  const to = toDate(end);
  const totalDays = daysBetween(from, to) + 1;
  if (totalDays <= 0 || amount <= 0) return [];

  const buckets: Array<{ year: number; month: number; amount: number }> = [];
  let allocated = 0;

  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const monthStart = new Date(Math.max(cursor.getTime(), from.getTime()));
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const sliceEnd = new Date(Math.min(monthEnd.getTime(), to.getTime()));
    const days = daysBetween(monthStart, sliceEnd) + 1;

    const isLast = sliceEnd.getTime() === to.getTime();
    // Le dernier mois absorbe l'arrondi : la somme des parts égale le montant.
    const slice = isLast
      ? amount - allocated
      : Math.round((amount * days) / totalDays);

    allocated += slice;
    buckets.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1, amount: slice });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return buckets;
}
