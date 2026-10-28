/**
 * Droits d'enregistrement et timbres des marchés — CGI Niger 2026.
 *
 *  - art. 470-1/2 : commande publique (marchés, bons de commande, délégations
 *    de service public, PPP de l'État, des collectivités, des établissements
 *    publics, des sociétés d'économie mixte, des projets et de toute personne
 *    bénéficiant du concours financier de l'État) : 5 % du prix HT, payé par
 *    l'attributaire ;
 *  - art. 470-5 (LF 2026) : contrats entre personnes privées, ONG et
 *    associations de développement comprises : 2 % HT ;
 *  - art. 471 : sous-traitance prévue au marché principal : 50 000 FCFA ;
 *  - art. 548-8° et 552 : bon de commande de moins de 1 000 000 FCFA :
 *    timbre de dimension, 1 500 FCFA par page (pas d'enregistrement) ;
 *  - art. 584 e) : timbre de 25 000 FCFA sur l'original d'un marché public et
 *    sur l'original du procès-verbal de réception définitive ;
 *  - art. 481 : délai d'enregistrement d'un mois ; pour la commande publique,
 *    à compter de l'approbation.
 *
 * Fonctions pures : le calcul se teste sans base.
 */

/** Nature de l'acheteur du marché. */
export const BUYER_TYPES = {
  state: { label: "État (ministère, administration centrale)", public: true },
  local_authority: { label: "Collectivité territoriale (région, commune)", public: true },
  public_establishment: { label: "Établissement public, société d'État", public: true },
  sem: { label: "Société d'économie mixte", public: true },
  project: { label: "Projet ou programme financé par l'État ou un bailleur", public: true },
  state_funded: { label: "Autre bénéficiaire d'un concours financier de l'État", public: true },
  private: { label: "Entreprise ou particulier", public: false },
  ngo: { label: "ONG ou association de développement", public: false },
} as const;
export type BuyerType = keyof typeof BUYER_TYPES;

/** Nature de l'acte. */
export const INSTRUMENTS = {
  market: "Marché",
  purchase_order: "Bon de commande",
  dsp: "Délégation de service public",
  ppp: "Partenariat public-privé",
  private_contract: "Contrat",
} as const;
export type Instrument = keyof typeof INSTRUMENTS;

export const PUBLIC_RATE = 0.05;
export const PRIVATE_RATE = 0.02;
export const SUBCONTRACT_FIXED = 50_000;
export const PURCHASE_ORDER_THRESHOLD = 1_000_000;
export const DIMENSION_STAMP_PER_PAGE = 1_500;
export const PUBLIC_ORIGINAL_STAMP = 25_000;

export function isPublicBuyer(t?: string | null): boolean {
  return !!t && (BUYER_TYPES as Record<string, { public: boolean }>)[t]?.public === true;
}

export interface RegistrationInput {
  buyerType?: string | null;
  instrument?: string | null;
  /** Montant HT du marché (hors TVA). */
  amountHT: number;
  isSubcontract?: boolean;
  /** Pages de l'acte, pour le timbre de dimension. */
  pages?: number | null;
}

export interface RegistrationAssessment {
  kind: "proportional_public" | "proportional_private" | "subcontract" | "dimension_stamp";
  /** Droit d'enregistrement (0 pour un bon de commande au timbre de dimension). */
  duty: number;
  rate: number | null;
  /** Timbres : dimension (petit bon de commande) ou original du marché public. */
  stamp: number;
  total: number;
  article: string;
  explanation: string;
}

/** Droit et timbres dus pour l'enregistrement d'un marché ou d'un contrat. */
export function assessRegistration(input: RegistrationInput): RegistrationAssessment {
  const ht = Math.max(0, Math.round(input.amountHT || 0));
  const pub = isPublicBuyer(input.buyerType);
  const pages = Math.max(1, Math.floor(Number(input.pages) || 1));
  const original = pub ? PUBLIC_ORIGINAL_STAMP : 0;
  const fmt = (n: number) => n.toLocaleString("fr-FR");

  if (input.isSubcontract) {
    return {
      kind: "subcontract", duty: SUBCONTRACT_FIXED, rate: null, stamp: 0, total: SUBCONTRACT_FIXED,
      article: "CGI art. 471", explanation: `Contrat de sous-traitance prévu au marché : droit fixe de ${fmt(SUBCONTRACT_FIXED)} FCFA.`,
    };
  }
  if (pub && input.instrument === "purchase_order" && ht < PURCHASE_ORDER_THRESHOLD) {
    const stamp = DIMENSION_STAMP_PER_PAGE * pages;
    return {
      kind: "dimension_stamp", duty: 0, rate: null, stamp, total: stamp,
      article: "CGI art. 548-8° et 552",
      explanation: `Bon de commande de moins de ${fmt(PURCHASE_ORDER_THRESHOLD)} FCFA : pas d'enregistrement, timbre de dimension de ${fmt(DIMENSION_STAMP_PER_PAGE)} FCFA × ${pages} page(s).`,
    };
  }
  if (pub) {
    const duty = Math.round(ht * PUBLIC_RATE);
    return {
      kind: "proportional_public", duty, rate: PUBLIC_RATE, stamp: original, total: duty + original,
      article: "CGI art. 470-1/2 et 584 e)",
      explanation: `Commande publique : 5 % de ${fmt(ht)} FCFA HT = ${fmt(duty)} FCFA, plus le timbre de ${fmt(original)} FCFA sur l'original du marché.`,
    };
  }
  const duty = Math.round(ht * PRIVATE_RATE);
  return {
    kind: "proportional_private", duty, rate: PRIVATE_RATE, stamp: 0, total: duty,
    article: "CGI art. 470-5 (LF 2026)",
    explanation: `Contrat entre personnes privées (ONG comprises) : 2 % de ${fmt(ht)} FCFA HT = ${fmt(duty)} FCFA.`,
  };
}

/** Échéance d'enregistrement : un mois après l'approbation (à défaut, la signature). */
export function registrationDueDate(approvalDate?: Date | string | null, signedDate?: Date | string | null): Date | null {
  const base = approvalDate || signedDate;
  if (!base) return null;
  const d = new Date(base);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Timbre sur l'original du PV de réception définitive (marché public). */
export function receptionStamp(buyerType?: string | null): number {
  return isPublicBuyer(buyerType) ? PUBLIC_ORIGINAL_STAMP : 0;
}
