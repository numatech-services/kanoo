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

export const CNSS_SALARIE = 0.036;     // 3,6% part salariale
export const CNSS_PATRONAL = 0.164;   // 16,4% part patronale
export const CNSS_TOTAL = CNSS_SALARIE + CNSS_PATRONAL; // 20%

export function calculerCNSS(salaireBrut: number) {
  return {
    salarie: Math.round(salaireBrut * CNSS_SALARIE),
    patronal: Math.round(salaireBrut * CNSS_PATRONAL),
    total: Math.round(salaireBrut * CNSS_TOTAL),
  };
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

// ─── Droits de Timbre sur Factures (DTS) ─────────────────────────────────────

/** DTS — appliqué sur les factures commerciales (montant forfaitaire par tranche) */
export function calculerDTS(montantTTC: number): number {
  if (montantTTC < 10_000) return 0;
  if (montantTTC < 100_000) return 200;
  if (montantTTC < 500_000) return 500;
  if (montantTTC < 1_000_000) return 1_000;
  return 2_000;
}

// ─── Code des Marchés Publics Niger 2017 ─────────────────────────────────────

export const SEUILS_MARCHES = {
  ACHAT_DIRECT: 5_000_000,          // < 5M XOF : achat direct
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
  achat_direct: "Achat direct (< 5 millions XOF)",
  consultation_restreinte: "Consultation restreinte (3 fournisseurs min) — 5M à 30M XOF",
  appel_offres_ouvert: "Appel d'offres ouvert — 30M à 100M XOF",
  appel_offres_international: "Appel d'offres ouvert avec publicité nationale — > 100M XOF",
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

export const IS_MINIMUM_FORFAITAIRE = 1_000_000; // 1 000 000 XOF minimum IS
export const IS_TAUX_PME = 0.30; // 30% taux normal
export const IS_TAUX_REDUIT_AGRI = 0.15; // 15% secteur agricole

/**
 * Calcule l'IS/BIC annuel avec minimum forfaitaire
 * @param resultatFiscal Résultat fiscal net après déductions
 * @param secteur "normal" | "agricole"
 */
export function calculerIS(resultatFiscal: number, secteur: "normal" | "agricole" = "normal"): {
  base: number;
  taux: number;
  montantTheorique: number;
  minimumForfaitaire: number;
  montantDu: number;
  isMinimumApplique: boolean;
} {
  const taux = secteur === "agricole" ? IS_TAUX_REDUIT_AGRI : IS_TAUX_PME;
  const montantTheorique = Math.round(Math.max(0, resultatFiscal) * taux);
  const isMinimumApplique = montantTheorique < IS_MINIMUM_FORFAITAIRE;
  const montantDu = Math.max(montantTheorique, IS_MINIMUM_FORFAITAIRE);
  return {
    base: resultatFiscal,
    taux,
    montantTheorique,
    minimumForfaitaire: IS_MINIMUM_FORFAITAIRE,
    montantDu,
    isMinimumApplique,
  };
}

/**
 * Acomptes provisionnels IS Niger (CGI art. 56)
 * 1/3 de l'IS N-1 payable en mars et en juillet
 */
export function calculerAcomptesIS(isAnneeN1: number): {
  acompte1: { montant: number; echeance: string };
  acompte2: { montant: number; echeance: string };
  total: number;
} {
  const acompte = Math.round(isAnneeN1 / 3);
  const anneeN = new Date().getFullYear();
  return {
    acompte1: { montant: acompte, echeance: `31/03/${anneeN}` },
    acompte2: { montant: acompte, echeance: `31/07/${anneeN}` },
    total: acompte * 2,
  };
}

// ─── Barème IR progressif (Impôt sur le Revenu) ───────────────────────────────

/** Tranches IR Niger — CGI art. 84 (barème mensuel) */
export const BAREME_IR_MENSUEL: Array<{ min: number; max: number; taux: number; abattement: number }> = [
  { min: 0, max: 35_000, taux: 0, abattement: 0 },
  { min: 35_001, max: 50_000, taux: 0.08, abattement: 2_800 },
  { min: 50_001, max: 100_000, taux: 0.15, abattement: 6_300 },
  { min: 100_001, max: 200_000, taux: 0.20, abattement: 11_300 },
  { min: 200_001, max: 400_000, taux: 0.25, abattement: 21_300 },
  { min: 400_001, max: Infinity, taux: 0.30, abattement: 41_300 },
];

/**
 * Calcule l'IR mensuel sur salaire net imposable
 * @param salaireNetImposable Salaire brut − CNSS salarié
 */
export function calculerIR(salaireNetImposable: number): number {
  if (salaireNetImposable <= 0) return 0;
  const tranche = BAREME_IR_MENSUEL.find(
    t => salaireNetImposable >= t.min && salaireNetImposable <= t.max
  );
  if (!tranche || tranche.taux === 0) return 0;
  return Math.round(salaireNetImposable * tranche.taux - tranche.abattement);
}

// ─── SMIG Niger ───────────────────────────────────────────────────────────────

export const SMIG_MENSUEL = 41_000; // XOF/mois — arrêté 2023
export const SMIG_JOURNALIER = Math.round(SMIG_MENSUEL / 26); // base 26 jours ouvrables

/**
 * Vérifie si un salaire respecte le SMIG Niger
 * @returns { conforme, ecart, message }
 */
export function verifierSMIG(salaireBrut: number): { conforme: boolean; ecart: number; message: string } {
  const conforme = salaireBrut >= SMIG_MENSUEL;
  const ecart = salaireBrut - SMIG_MENSUEL;
  return {
    conforme,
    ecart,
    message: conforme
      ? `Conforme SMIG (${ecart >= 0 ? "+" : ""}${ecart.toLocaleString("fr-FR")} XOF au-dessus du minimum)`
      : `⚠ Inférieur au SMIG de ${Math.abs(ecart).toLocaleString("fr-FR")} XOF — risque légal`,
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

export function calculerPrimeAnciennete(salaireBrut: number, dateEntree: Date): {
  annees: number;
  mois: number;
  taux: number;
  montant: number;
} {
  // Calcul calendaire exact (des mois de 30,44 j comptaient 5 ans pile comme
  // 4 ans → prime sous-évaluée à chaque date anniversaire).
  const now = new Date();
  let annees = now.getFullYear() - dateEntree.getFullYear();
  let mois = now.getMonth() - dateEntree.getMonth();
  if (now.getDate() < dateEntree.getDate()) mois -= 1;
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
 * Calcule le plan d'amortissement linéaire complet
 */
export function calculerAmortissementLineaire(
  acquisitionCost: number,
  residualValue: number = 0,
  usefulLifeYears: number,
  acquisitionYear: number
): AmortissementEntry[] {
  const base = acquisitionCost - residualValue;
  const annuity = Math.round(base / usefulLifeYears);
  const plan: AmortissementEntry[] = [];
  let cumulative = 0;

  for (let i = 0; i < usefulLifeYears; i++) {
    const isLast = i === usefulLifeYears - 1;
    // La dernière annuité absorbe les arrondis
    const yearAnnuity = isLast ? base - cumulative : annuity;
    cumulative += yearAnnuity;
    plan.push({
      year: acquisitionYear + i,
      annuity: yearAnnuity,
      cumulative,
      netValue: Math.max(0, acquisitionCost - cumulative),
    });
  }
  return plan;
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
