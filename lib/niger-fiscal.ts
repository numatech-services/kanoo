import { buildLinearSchedule } from "./depreciation";
import { parametresPaie, calculerCotisationsCnss } from "./paie-parametres";

/**
 * Règles fiscales Niger — conformes au Code Général des Impôts (CGI Niger)
 * et au Code des Marchés Publics (CMP Niger 2017)
 */

// ─── TVA ──────────────────────────────────────────────────────────────────────

export const TVA_TAUX_STANDARD = 0.19; // 19% — taux normal Niger 

export const TVA_TAUX_REDUIT = 0.10;   // 10% — certains produits alimentaires

export const TVA_EXONERE = 0;          // Exonéré

/** Codes d'exonération TVA fréquents */
export const TVA_CODES = {
  STANDARD: "STD",
  REDUIT: "RED",
  EXONERE_EXPORT: "EXP",
  EXONERE_MEDICAL: "MED",
  EXONERE_EDUCATION: "EDU",
  EXONERE_AGRICULTURE: "AGR",
} as const;

export function calculerTVA(montantHT: number, taux: number = TVA_TAUX_STANDARD): number {
  return Math.round(montantHT * taux);
}

export function calculerTTC(montantHT: number, taux: number = TVA_TAUX_STANDARD): number {
  return montantHT + calculerTVA(montantHT, taux);
}

// ─── CNSS ─────────────────────────────────────────────────────────────────────
//
// Taux, plafond et SMIG sont datés dans lib/paie-parametres.ts : un bulletin
// est calculé avec les paramètres de sa période.

export {
  parametresPaie, tauxCnss, calculerCotisationsCnss, calculerITS, impotParTranches,
  evaluerAvantagesEnNature, pourcent, AVANTAGES_EN_NATURE, AVANTAGES_KEYS, CHARGES_FAMILLE_MAX,
  type CategorieCnss, type ResultatCnss, type ResultatITS, type AvantageEnNature,
} from "./paie-parametres";

/** Cotisations CNSS d'un salarié du secteur privé (plafond appliqué, sans plancher). */
export function calculerCNSS(salaireBrut: number, date: Date = new Date()) {
  const r = calculerCotisationsCnss(salaireBrut, "standard", date);
  return { salarie: r.salarie, patronal: r.patronal, total: r.total, assiette: r.assiette, branches: r.branches };
}

// ─── IS / Impôt sur les Sociétés ─────────────────────────────────────────────

export const IS_TAUX = 0.30; // 30% — taux normal Niger

// ─── Retenues à la source ─────────────────────────────────────────────────────

/** Taux de retenue selon la nature de la prestation */
export const RETENUES_A_LA_SOURCE = {
  MARCHES_PUBLICS: 0.10,        // 10% sur marchés publics
  PRESTATIONS_SERVICES: 0.05,   // 5% sur prestations de services
  LOYERS: 0.05,                 // 5% sur loyers
  DIVIDENDES: 0.10,             // 10% sur dividendes
  HONORAIRES: 0.10,             // 10% sur honoraires
} as const;

export function calculerRetenue(montant: number, type: keyof typeof RETENUES_A_LA_SOURCE): number {
  return Math.round(montant * RETENUES_A_LA_SOURCE[type]);
}

// ─── Timbre ───────────────────────────────────────────────────────────────────

/**
 * Droit de timbre ajouté au TTC d'une facture : supprimé (0).
 *
 * Kanoo appliquait un barème par tranches (200 à 2 000 FCFA) sur toutes les
 * factures, y compris celles payées par l'État. Le CGI 2026 (art. 560) ne
 * connaît que le timbre-quittance de 200 FCFA, dû sur le reçu d'un paiement
 * en espèces : il est constaté à l'encaissement (voir `timbreQuittanceDu`).
 * Les factures déjà émises gardent leur timbre.
 */
export function calculerDTS(_montantTTC: number): number {
  return 0;
}

/** Timbre-quittance (CGI art. 560) : par reçu de paiement en espèces. */
export const TIMBRE_QUITTANCE = 200;
/** En deçà de ce montant TTC, le reçu est exonéré. */
export const SEUIL_TIMBRE_QUITTANCE = 5_000;

/**
 * Timbre-quittance dû sur l'encaissement d'une facture : paiement en
 * espèces, d'au moins 5 000 FCFA TTC, d'un client qui n'est pas une
 * collectivité publique (exonérée). Les paiements scripturaux (virement,
 * chèque, mobile money) ne sont pas soumis.
 */
export function timbreQuittanceDu(opts: { cash: boolean; montantTTC: number; clientPublic?: boolean }): number {
  if (!opts.cash || opts.clientPublic) return 0;
  return opts.montantTTC >= SEUIL_TIMBRE_QUITTANCE ? TIMBRE_QUITTANCE : 0;
}

// ─── Code des Marchés Publics Niger 2017 ─────────────────────────────────────

export const SEUILS_MARCHES = {
  ACHAT_DIRECT: 5_000_000,          // < 5M FCFA : achat direct
  CONSULTATION_RESTREINTE: 30_000_000, // 5M - 30M : consultation ≥ 3 fournisseurs
  APPEL_OFFRES_OUVERT: 100_000_000, // 30M - 100M : AO ouvert
  PUBLICITE_NATIONALE: 100_000_001,  // > 100M : publicité nationale obligatoire
} as const;

export type ProcedureMarche =
  | "achat_direct"
  | "consultation_restreinte"
  | "appel_offres_ouvert"
  | "appel_offres_international";

export function determineProcedureMarche(montantEstime: number): ProcedureMarche {
  if (montantEstime < SEUILS_MARCHES.ACHAT_DIRECT) return "achat_direct";
  if (montantEstime < SEUILS_MARCHES.CONSULTATION_RESTREINTE) return "consultation_restreinte";
  if (montantEstime < SEUILS_MARCHES.PUBLICITE_NATIONALE) return "appel_offres_ouvert";
  return "appel_offres_international";
}

export const LIBELLES_PROCEDURES: Record<ProcedureMarche, string> = {
  achat_direct: "Achat direct (< 5 millions FCFA)",
  consultation_restreinte: "Consultation restreinte (3 fournisseurs min) — 5M à 30M FCFA",
  appel_offres_ouvert: "Appel d'offres ouvert — 30M à 100M FCFA",
  appel_offres_international: "Appel d'offres ouvert avec publicité nationale — > 100M FCFA",
};

// ─── Exercice fiscal ──────────────────────────────────────────────────────────

/** Niger : exercice fiscal = année civile (1er janvier → 31 décembre) */
export function getExerciceFiscal(date = new Date()): number {
  return date.getFullYear();
}

export function getPeriodeTVA(date = new Date()): { mois: number; annee: number } {
  return { mois: date.getMonth() + 1, annee: date.getFullYear() };
}

export function getPeriodeCNSS(date = new Date()): { trimestre: 1 | 2 | 3 | 4; annee: number } {
  const trimestre = Math.ceil((date.getMonth() + 1) / 3) as 1 | 2 | 3 | 4;
  return { trimestre, annee: date.getFullYear() };
}

// ─── Numérotation ─────────────────────────────────────────────────────────────

export function genererNumeroFacture(annee: number, sequence: number): string {
  return `FAC-${annee}-${String(sequence).padStart(5, "0")}`;
}

export function genererNumeroDevis(annee: number, sequence: number): string {
  return `DEV-${annee}-${String(sequence).padStart(5, "0")}`;
}

export function genererNumeroBonCommande(annee: number, sequence: number): string {
  return `BC-${annee}-${String(sequence).padStart(5, "0")}`;
}

export function genererNumeroMarche(annee: number, sequence: number): string {
  return `MRC-${annee}-${String(sequence).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2 — IS/BIC, IR, SMIG, ANCIENNETÉ (ajouts V5)
// ─────────────────────────────────────────────────────────────────────────────

// ─── IS/BIC ──────────────────────────────────────────────────────────────────

/**
 * CGI 2026 (Ordonnance n° 2025-22, loi de finances 2026) — voir
 * docs/REFERENTIEL-FISCAL-SOCIAL-2026.md §6. Le minimum était codé à
 * 1 000 000 FCFA fixe, les acomptes à 2 × 1/3 (mars, juillet) et un taux
 * agricole de 15 % qui n'existe plus. Lecture technique des textes : à faire
 * valider par un fiscaliste (marge brute, exonération des entreprises
 * nouvelles et retraitements non gérés).
 */
export const IS_TAUX_PME = 0.30; // taux normal
export const IS_TAUX_REDUIT = 0.26; // industrie manufacturière, presse agréée, enseignement ou santé exclusifs
export const IMF_TAUX = 0.0175; // impôt minimum forfaitaire : 1,75 % du CA HT
export const IMF_TAUX_INDUSTRIE = 0.0075; // 0,75 % pour l'industrie

/** normal : 30 %, IMF 1,75 % ; industrie : 26 %, IMF 0,75 % ; reduit : 26 % (presse, enseignement, santé), IMF 1,75 %. */
export type RegimeIS = "normal" | "industrie" | "reduit";

/**
 * IS/BIC annuel : IS sur la base arrondie au millier inférieur, comparé à
 * l'IMF sur le chiffre d'affaires HT ; l'impôt dû est le plus élevé des deux.
 */
export function calculerIS(resultatFiscal: number, opts: { regime?: RegimeIS; chiffreAffairesHT?: number } = {}): {
  base: number;
  taux: number;
  montantTheorique: number;
  /** IMF de l'exercice (taux × CA HT). */
  minimumForfaitaire: number;
  tauxIMF: number;
  montantDu: number;
  isMinimumApplique: boolean;
} {
  const regime = opts.regime ?? "normal";
  const taux = regime === "normal" ? IS_TAUX_PME : IS_TAUX_REDUIT;
  const tauxIMF = regime === "industrie" ? IMF_TAUX_INDUSTRIE : IMF_TAUX;
  const base = Math.floor(Math.max(0, resultatFiscal) / 1000) * 1000;
  const montantTheorique = Math.round(base * taux);
  const minimumForfaitaire = Math.round(Math.max(0, opts.chiffreAffairesHT ?? 0) * tauxIMF);
  const isMinimumApplique = minimumForfaitaire > montantTheorique;
  return { base, taux, montantTheorique, minimumForfaitaire, tauxIMF, montantDu: Math.max(montantTheorique, minimumForfaitaire), isMinimumApplique };
}

/** Acomptes de l'exercice suivant : 3 × 20 % de l'impôt de l'exercice, avant le 1/07, le 1/09 et le 1/11. */
export function calculerAcomptesIS(isExercice: number, exercice = new Date().getFullYear() - 1): {
  acomptes: Array<{ montant: number; echeance: string }>;
  total: number;
} {
  const montant = Math.round(isExercice * 0.2);
  const y = exercice + 1;
  return { acomptes: ["01/07", "01/09", "01/11"].map(d => ({ montant, echeance: `avant le ${d}/${y}` })), total: montant * 3 };
}

// ─── SMIG Niger ───────────────────────────────────────────────────────────────

/**
 * Vérifie qu'un salaire de base atteint le SMIG en vigueur à la date donnée
 * (30 047 FCFA selon le guide de l'employeur CNSS de juillet 2025).
 */
export function verifierSMIG(salaireBrut: number, date: Date = new Date()): { conforme: boolean; ecart: number; message: string } {
  const smig = parametresPaie(date).smig;
  const conforme = salaireBrut >= smig;
  const ecart = salaireBrut - smig;
  return {
    conforme,
    ecart,
    message: conforme
      ? `Conforme SMIG (${ecart >= 0 ? "+" : ""}${ecart.toLocaleString("fr-FR")} FCFA au-dessus du minimum)`
      : `⚠ Inférieur au SMIG (${smig.toLocaleString("fr-FR")} FCFA) de ${Math.abs(ecart).toLocaleString("fr-FR")} FCFA — risque légal`,
  };
}

// ─── Prime d'ancienneté ───────────────────────────────────────────────────────

/**
 * Taux de prime d'ancienneté Niger (Code du Travail art. 167)
 * 2% par an de 1 à 5 ans, 1% par an au-delà (max 15%)
 */
export function calculerTauxAnciennete(annees: number): number {
  if (annees <= 0) return 0;
  if (annees <= 5) return Math.min(annees * 0.02, 0.10);
  return Math.min(0.10 + (annees - 5) * 0.01, 0.15);
}

/**
 * Prime d'ancienneté à une date donnée.
 *
 * @param asOf Date d'appréciation — **la fin de la période de paie**, pas le
 *   jour de calcul. Elle était lue dans `new Date()` : régénérer le bulletin de
 *   janvier au mois de décembre donnait alors un montant différent de celui
 *   qui avait été payé, et un bulletin réédité pour un contrôle ne
 *   correspondait plus à l'original.
 */
export function calculerPrimeAnciennete(
  salaireBrut: number,
  dateEntree: Date,
  asOf: Date = new Date()
): {
  annees: number;
  mois: number;
  taux: number;
  montant: number;
} {
  // Calcul calendaire exact (des mois de 30,44 j comptaient 5 ans pile comme
  // 4 ans → prime sous-évaluée à chaque date anniversaire).
  let annees = asOf.getFullYear() - dateEntree.getFullYear();
  let mois = asOf.getMonth() - dateEntree.getMonth();
  if (asOf.getDate() < dateEntree.getDate()) mois -= 1;
  if (mois < 0) { annees -= 1; mois += 12; }
  if (annees < 0) { annees = 0; mois = 0; }
  const taux = calculerTauxAnciennete(annees);
  const montant = Math.round(salaireBrut * taux);
  return { annees, mois, taux, montant };
}

// ─── Retenues à la source enrichies ──────────────────────────────────────────

export const RETENUES_DETAILLEES: Record<string, { taux: number; base: string; article: string; description: string }> = {
  marche_public: { taux: 0.10, base: "montant TTC", article: "CGI art. 124", description: "Marchés publics — retenue 10%" },
  prestation_service: { taux: 0.05, base: "montant HT", article: "CGI art. 118", description: "Prestations de services — 5%" },
  loyer_immeuble: { taux: 0.05, base: "loyer mensuel", article: "CGI art. 120", description: "Loyers d'immeubles — 5%" },
  dividendes: { taux: 0.10, base: "montant brut", article: "CGI art. 110", description: "Dividendes — 10%" },
  honoraires: { taux: 0.10, base: "montant HT", article: "CGI art. 118", description: "Honoraires professionnels — 10%" },
  commissions: { taux: 0.10, base: "montant HT", article: "CGI art. 118", description: "Commissions et courtages — 10%" },
  interet_pret: { taux: 0.15, base: "montant brut", article: "CGI art. 112", description: "Intérêts de prêts — 15%" },
  transport_inter: { taux: 0.03, base: "montant TTC", article: "CGI art. 122", description: "Transport international — 3%" },
};

export function calculerRetenueDetaillee(montant: number, type: keyof typeof RETENUES_DETAILLEES): {
  montantBrut: number;
  taux: number;
  montantRetenue: number;
  montantNet: number;
  article: string;
} {
  const retenue = RETENUES_DETAILLEES[type];
  if (!retenue) throw new Error(`Type de retenue inconnu: ${type}`);
  const montantRetenue = Math.round(montant * retenue.taux);
  return {
    montantBrut: montant,
    taux: retenue.taux,
    montantRetenue,
    montantNet: montant - montantRetenue,
    article: retenue.article,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — NUMÉROTATION PERSONNALISÉE PAR TENANT (Q5)
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentPrefixes {
  invoice: string;
  devis: string;
  commande: string;
  delivery: string;
  marche: string;
  contract: string;
}

export interface DocumentSequences {
  invoice: number;
  devis: number;
  commande: number;
  delivery: number;
}

export const DEFAULT_PREFIXES: DocumentPrefixes = {
  invoice: "FAC",
  devis: "DEV",
  commande: "BC",
  delivery: "BL",
  marche: "MRC",
  contract: "CTR",
};

/**
 * Génère un numéro de document avec le préfixe du tenant
 * Format : PREFIX-AAAA-NNNNN (ex: NML-2025-00042)
 */
export function genererNumeroDocument(
  type: keyof DocumentPrefixes,
  annee: number,
  sequence: number,
  prefixes: Partial<DocumentPrefixes> = {}
): string {
  const prefix = prefixes[type] || DEFAULT_PREFIXES[type];
  return `${prefix.toUpperCase()}-${annee}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Génère un numéro de facture avec préfixe tenant
 */
export function genererNumeroFactureTenant(
  annee: number,
  sequence: number,
  prefixes?: Partial<DocumentPrefixes>,
  startSequence = 0
): string {
  return genererNumeroDocument("invoice", annee, sequence + startSequence, prefixes);
}

/**
 * Génère un numéro de devis avec préfixe tenant
 */
export function genererNumeroDevisTenant(
  annee: number,
  sequence: number,
  prefixes?: Partial<DocumentPrefixes>,
  startSequence = 0
): string {
  return genererNumeroDocument("devis", annee, sequence + startSequence, prefixes);
}

/**
 * Validation d'un préfixe (2-6 caractères alphanumérique + tiret autorisé)
 */
export function validerPrefixe(prefix: string): { valide: boolean; message?: string } {
  if (!prefix || prefix.trim().length === 0) return { valide: false, message: "Préfixe vide" };
  if (prefix.length < 2 || prefix.length > 6) return { valide: false, message: "Le préfixe doit comporter 2 à 6 caractères" };
  if (!/^[A-Z0-9\-]+$/i.test(prefix)) return { valide: false, message: "Caractères autorisés : lettres, chiffres et tiret" };
  return { valide: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — IMMOBILISATIONS & AMORTISSEMENTS (OHADA)
// ─────────────────────────────────────────────────────────────────────────────

/** Taux d'amortissement linéaire standard par catégorie (OHADA / pratique Niger) */
export const AMORTISSEMENT_TAUX: Record<string, { taux: number; duree: number; compte: string }> = {
  building: { taux: 0.05, duree: 20, compte: "231" },
  equipment: { taux: 0.20, duree: 5, compte: "244" },
  vehicle: { taux: 0.25, duree: 4, compte: "245" },
  furniture: { taux: 0.10, duree: 10, compte: "245" },
  computer: { taux: 0.33, duree: 3, compte: "244" },
  software: { taux: 0.33, duree: 3, compte: "244" },
  land: { taux: 0, duree: 0, compte: "221" },
  other: { taux: 0.20, duree: 5, compte: "248" },
};

export interface AmortissementEntry {
  year: number;
  annuity: number;     // Dotation annuelle
  cumulative: number;  // Cumul amortissements
  netValue: number;    // Valeur nette comptable
}

/**
 * Plan d'amortissement linéaire, **prorata temporis**.
 *
 * Délègue à `lib/depreciation.ts`, qui porte l'implémentation unique. Ce
 * module en hébergeait une seconde copie, divergente : le calcul est le même,
 * seul le format de retour diffère (l'échéancier nu plutôt que le plan complet).
 *
 * @param serviceDate Date de mise en service. À défaut, annuité pleine dès
 *   l'année d'acquisition.
 */
export function calculerAmortissementLineaire(
  acquisitionCost: number,
  residualValue: number = 0,
  usefulLifeYears: number,
  acquisitionYear: number,
  serviceDate?: Date
): AmortissementEntry[] {
  return buildLinearSchedule(
    acquisitionCost, residualValue, usefulLifeYears, acquisitionYear, serviceDate
  );
}

/**
 * Calcule la dotation de l'exercice en cours
 */
export function dotationExercice(
  plan: AmortissementEntry[],
  year: number
): number {
  return plan.find(e => e.year === year)?.annuity || 0;
}

/**
 * Calcule la VNC à une date donnée
 */
export function vncADate(
  acquisitionCost: number,
  plan: AmortissementEntry[],
  year: number
): number {
  const lastPassed = plan.filter(e => e.year <= year).at(-1);
  return lastPassed?.netValue ?? acquisitionCost;
}
