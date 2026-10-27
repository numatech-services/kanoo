/**
 * Paramètres de paie du Niger, datés — CNSS et impôt sur les traitements et
 * salaires (ITS).
 *
 * Chaque jeu s'applique à partir de sa date `depuis` : un bulletin est calculé
 * avec les paramètres de SA période (fin du mois payé), jamais avec ceux du
 * jour. Rééditer en 2026 un bulletin de 2023 redonne donc le bulletin de 2023.
 *
 * Sources :
 *   - CNSS : Guide de l'employeur et Guide de l'assuré, juillet 2025 (taux en
 *     vigueur depuis le 1er janvier 2024) ;
 *   - ITS : Code général des impôts 2026, art. 136 à 160 (Ordonnance
 *     n° 2025-22, loi de finances 2026 = Ordonnance n° 2025-44).
 * Référentiel complet : docs/REFERENTIEL-FISCAL-SOCIAL-2026.md.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Branches de la cotisation patronale. */
export interface BranchesEmployeur {
  /** Prestations familiales. */
  pf: number;
  /** Accidents du travail et maladies professionnelles. */
  atmp: number;
  /** Pensions (vieillesse, invalidité, décès), part patronale. */
  pensions: number;
  /** Agence nationale pour la promotion de l'emploi, perçue par la CNSS. */
  anpe: number;
}

export interface TauxCnss {
  /** Part salariale (pensions). */
  salarie: number;
  employeur: BranchesEmployeur;
}

/**
 * Catégorie de cotisant :
 *   - `standard` : salarié du secteur privé ;
 *   - `stagiaire` : apprentis et stagiaires (ni PF ni ANPE) ;
 *   - `detache` : fonctionnaire détaché (pension servie par l'État : PF et
 *     AT/MP seulement, à la charge de l'employeur).
 */
export type CategorieCnss = "standard" | "stagiaire" | "detache";

/** Barème ITS : tranches progressives, borne haute incluse. */
export interface TrancheITS { jusqua: number; taux: number }

export interface ParametresITS {
  tranches: TrancheITS[];
  /** Cotisation de retraite déductible, en part de la rémunération principale brute (art. 143 a). */
  retraiteMax: number;
  /** Abattement des expatriés (art. 143 b) et seuil de l'indemnité de dépaysement qui l'ouvre. */
  abattementExpatrie: number;
  seuilDepaysement: number;
  /** Primes d'assurance déductibles, plafond mensuel (art. 143 c). */
  assuranceMax: number;
  /** Frais professionnels (art. 143 d). */
  fraisProfessionnels: number;
  /** Abattement pour charges de famille, indexé par le nombre de charges (art. 149). */
  abattementsFamille: number[];
  /** Arrondi de la base au millier inférieur (art. 145). */
  arrondiBase: number;
}

/** Ancien barème « IR » appliqué par Kanoo avant 2026 : taux × base − abattement de tranche. */
export interface TrancheIRAncien { min: number; taux: number; abattement: number }

export interface ParametresPaie {
  /** Date d'effet (AAAA-MM-JJ). */
  depuis: string;
  source: string;
  cnss: Record<CategorieCnss, TauxCnss>;
  /** Plafond mensuel de l'assiette CNSS ; null = pas de plafond. */
  plafondCnssMensuel: number | null;
  /** SMIG mensuel : plancher de l'assiette CNSS et contrôle du salaire de base. */
  smig: number;
  /** Plancher CNSS appliqué à l'assiette des salariés à temps plein. */
  plancherCnss: boolean;
  /** Impôt sur salaire : barème ITS (2026) ou ancien barème (avant 2026). */
  its: ParametresITS | null;
  irAncien: TrancheIRAncien[] | null;
}

// ─── Jeux de paramètres ──────────────────────────────────────────────────────

const AUCUNE_COTISATION: TauxCnss = { salarie: 0, employeur: { pf: 0, atmp: 0, pensions: 0, anpe: 0 } };

/** Barème appliqué par Kanoo avant 2026 (non vérifié sur un texte : conservé pour ne pas changer les bulletins déjà émis). */
const IR_ANCIEN: TrancheIRAncien[] = [
  { min: 0, taux: 0, abattement: 0 },
  { min: 35_001, taux: 0.08, abattement: 2_800 },
  { min: 50_001, taux: 0.15, abattement: 6_300 },
  { min: 100_001, taux: 0.20, abattement: 11_300 },
  { min: 200_001, taux: 0.25, abattement: 21_300 },
  { min: 400_001, taux: 0.30, abattement: 41_300 },
];

/** CNSS 2024 : 22,65 % (employeur 17,40 %, salarié 5,25 %). */
const CNSS_2024: Record<CategorieCnss, TauxCnss> = {
  standard: { salarie: 0.0525, employeur: { pf: 0.049, atmp: 0.0175, pensions: 0.0975, anpe: 0.01 } },
  stagiaire: { salarie: 0.0525, employeur: { pf: 0, atmp: 0.0175, pensions: 0.0975, anpe: 0 } },
  detache: { salarie: 0, employeur: { pf: 0.049, atmp: 0.0175, pensions: 0, anpe: 0 } },
};

export const PARAMETRES_PAIE: ParametresPaie[] = [
  {
    depuis: "2000-01-01",
    source: "Paramètres appliqués par Kanoo avant la mise à jour 2026",
    cnss: {
      // Ancien taux global, sans ventilation : porté par la branche pensions.
      standard: { salarie: 0.036, employeur: { pf: 0, atmp: 0, pensions: 0.164, anpe: 0 } },
      stagiaire: AUCUNE_COTISATION,
      detache: { salarie: 0.036, employeur: { pf: 0, atmp: 0, pensions: 0.164, anpe: 0 } },
    },
    plafondCnssMensuel: null,
    smig: 41_000,
    plancherCnss: false,
    its: null,
    irAncien: IR_ANCIEN,
  },
  {
    depuis: "2024-01-01",
    source: "CNSS : guides de l'employeur et de l'assuré (juillet 2025), taux en vigueur depuis le 1er janvier 2024",
    cnss: CNSS_2024,
    plafondCnssMensuel: 500_000,
    // « Actuellement, le montant du SMIG est de 30.047 Fcfa » (guide de l'employeur, VII).
    smig: 30_047,
    plancherCnss: true,
    its: null,
    irAncien: IR_ANCIEN,
  },
  {
    depuis: "2026-01-01",
    source: "CNSS 2024 ; ITS : CGI 2026, art. 143 à 150",
    cnss: CNSS_2024,
    plafondCnssMensuel: 500_000,
    smig: 30_047,
    plancherCnss: true,
    its: {
      tranches: [
        { jusqua: 25_000, taux: 0.01 },
        { jusqua: 50_000, taux: 0.02 },
        { jusqua: 100_000, taux: 0.06 },
        { jusqua: 150_000, taux: 0.13 },
        { jusqua: 300_000, taux: 0.25 },
        { jusqua: 400_000, taux: 0.30 },
        { jusqua: 700_000, taux: 0.32 },
        { jusqua: 1_000_000, taux: 0.34 },
        { jusqua: Infinity, taux: 0.35 },
      ],
      retraiteMax: 0.06,
      abattementExpatrie: 0.17,
      seuilDepaysement: 0.40,
      assuranceMax: 20_000,
      fraisProfessionnels: 0.13,
      abattementsFamille: [0, 0.07, 0.12, 0.17, 0.22, 0.25, 0.27, 0.30],
      arrondiBase: 1_000,
    },
    irAncien: null,
  },
];

/** Nombre maximal de charges de famille (art. 148) : 7 personnes, dont 6 enfants. */
export const CHARGES_FAMILLE_MAX = 7;

/** Paramètres en vigueur à une date (fin de la période payée). */
export function parametresPaie(date: Date = new Date()): ParametresPaie {
  // Date locale : la fin de période est construite en heure locale
  // (new Date(année, mois, 0)) ; en UTC elle tomberait la veille.
  const jour = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let retenu = PARAMETRES_PAIE[0];
  for (const p of PARAMETRES_PAIE) if (p.depuis <= jour) retenu = p;
  return retenu;
}

const somme = (b: BranchesEmployeur) => b.pf + b.atmp + b.pensions + b.anpe;

/** Taux en pourcentage lisible (« 5,25 % »). */
export function pourcent(taux: number): string {
  return `${(taux * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

/** Taux CNSS salarié et employeur en vigueur, pour l'affichage. */
export function tauxCnss(categorie: CategorieCnss = "standard", date: Date = new Date()) {
  const t = parametresPaie(date).cnss[categorie];
  return { salarie: t.salarie, employeur: somme(t.employeur), total: t.salarie + somme(t.employeur) };
}

// ─── CNSS ────────────────────────────────────────────────────────────────────

export interface ResultatCnss {
  /** Assiette retenue, après plancher et plafond. */
  assiette: number;
  salarie: number;
  patronal: number;
  total: number;
  /** Ventilation de la part patronale ; la somme vaut `patronal`. */
  branches: BranchesEmployeur;
  plafonnee: boolean;
  /** Assiette relevée au SMIG. */
  relevee: boolean;
}

/**
 * Cotisations CNSS d'un mois.
 *
 * @param remuneration Rémunération soumise du mois (primes et avantages en
 *   nature compris, frais professionnels exclus).
 * @param opts.plancher Relever l'assiette au SMIG (salarié à temps plein).
 */
export function calculerCotisationsCnss(
  remuneration: number,
  categorie: CategorieCnss = "standard",
  date: Date = new Date(),
  opts: { plancher?: boolean } = {},
): ResultatCnss {
  const p = parametresPaie(date);
  const t = p.cnss[categorie];
  let assiette = Math.max(0, remuneration);
  let relevee = false;
  if (opts.plancher && p.plancherCnss && assiette > 0 && assiette < p.smig) { assiette = p.smig; relevee = true; }
  const plafonnee = p.plafondCnssMensuel !== null && assiette > p.plafondCnssMensuel;
  if (plafonnee) assiette = p.plafondCnssMensuel!;

  const salarie = Math.round(assiette * t.salarie);
  const patronal = Math.round(assiette * somme(t.employeur));
  // Branches arrondies une à une ; l'écart d'arrondi est porté sur les pensions
  // pour que la ventilation retombe exactement sur la part patronale.
  const branches: BranchesEmployeur = {
    pf: Math.round(assiette * t.employeur.pf),
    atmp: Math.round(assiette * t.employeur.atmp),
    pensions: 0,
    anpe: Math.round(assiette * t.employeur.anpe),
  };
  branches.pensions = patronal - branches.pf - branches.atmp - branches.anpe;
  return { assiette, salarie, patronal, total: salarie + patronal, branches, plafonnee, relevee };
}

// ─── ITS ─────────────────────────────────────────────────────────────────────

export interface EntreeITS {
  /** Revenu brut imposable du mois : rémunérations en espèces soumises + avantages en nature. */
  revenuBrut: number;
  /** Rémunération principale brute : salaire de base (congés payés compris). */
  remunerationPrincipale: number;
  /** Cotisation de retraite retenue au salarié (CNSS salariale). */
  retraite: number;
  /** Primes d'assurance payées par le salarié (art. 35). */
  assurance?: number;
  /** Indemnité de dépaysement d'un expatrié. */
  indemniteDepaysement?: number;
  /** Charges de famille, de 0 à 7. */
  chargesFamille?: number;
}

export interface ResultatITS {
  impot: number;
  /** Base imposable arrondie, sur laquelle s'applique le barème. */
  base: number;
  deductions: {
    retraite: number; expatrie: number; assurance: number;
    fraisProfessionnels: number; chargesFamille: number;
  };
  /** Taux d'abattement familial appliqué. */
  tauxFamille: number;
  /** Barème appliqué : `its` (CGI 2026) ou `ancien`. */
  bareme: "its" | "ancien";
}

/** Impôt d'un barème progressif par tranches. */
export function impotParTranches(base: number, tranches: TrancheITS[]): number {
  let impot = 0, bas = 0;
  for (const t of tranches) {
    if (base <= bas) break;
    impot += (Math.min(base, t.jusqua) - bas) * t.taux;
    bas = t.jusqua;
  }
  return Math.round(impot);
}

function irAncien(base: number, bareme: TrancheIRAncien[]): number {
  if (base <= 0) return 0;
  const tranche = [...bareme].reverse().find(t => base >= t.min);
  if (!tranche || tranche.taux === 0) return 0;
  return Math.max(0, Math.round(base * tranche.taux - tranche.abattement));
}

/**
 * Impôt sur les traitements et salaires d'un mois (CGI 2026, art. 143 à 150).
 *
 * Ordre des déductions (art. 143) : retraite (≤ 6 % de la rémunération
 * principale), abattement de 17 % des expatriés, assurance (≤ 20 000),
 * 13 % de frais professionnels ; puis l'abattement pour charges de famille
 * (art. 148-149) ; base arrondie au millier inférieur (art. 145) ; barème
 * progressif (art. 150).
 *
 * Avant 2026, le calcul reprend celui que Kanoo appliquait (revenu brut moins
 * CNSS salariale, ancien barème).
 */
export function calculerITS(e: EntreeITS, date: Date = new Date()): ResultatITS {
  const p = parametresPaie(date);
  const vide = { retraite: 0, expatrie: 0, assurance: 0, fraisProfessionnels: 0, chargesFamille: 0 };
  if (!p.its) {
    const base = Math.max(0, e.revenuBrut - e.retraite);
    return { impot: irAncien(base, p.irAncien ?? IR_ANCIEN), base, deductions: { ...vide, retraite: e.retraite }, tauxFamille: 0, bareme: "ancien" };
  }
  const its = p.its;
  const principale = Math.max(0, e.remunerationPrincipale);
  const retraite = Math.min(Math.max(0, e.retraite), principale * its.retraiteMax);
  const depaysement = Math.max(0, e.indemniteDepaysement ?? 0);
  const expatrie = depaysement > 0 && depaysement >= principale * its.seuilDepaysement
    ? (principale + depaysement) * its.abattementExpatrie : 0;
  const assurance = Math.min(Math.max(0, e.assurance ?? 0), its.assuranceMax);
  const avantFrais = Math.max(0, e.revenuBrut - retraite - expatrie - assurance);
  const fraisProfessionnels = avantFrais * its.fraisProfessionnels;
  const apresFrais = avantFrais - fraisProfessionnels;
  const charges = Math.min(CHARGES_FAMILLE_MAX, Math.max(0, Math.floor(e.chargesFamille ?? 0)));
  const tauxFamille = its.abattementsFamille[charges] ?? 0;
  const chargesFamille = apresFrais * tauxFamille;
  const base = Math.floor((apresFrais - chargesFamille) / its.arrondiBase) * its.arrondiBase;
  return {
    impot: impotParTranches(Math.max(0, base), its.tranches),
    base: Math.max(0, base),
    deductions: {
      retraite: Math.round(retraite), expatrie: Math.round(expatrie), assurance: Math.round(assurance),
      fraisProfessionnels: Math.round(fraisProfessionnels), chargesFamille: Math.round(chargesFamille),
    },
    tauxFamille,
    bareme: "its",
  };
}

// ─── Avantages en nature (art. 144) ──────────────────────────────────────────

export const AVANTAGES_EN_NATURE = {
  logement: { libelle: "Logement", unite: "pièce", forfait: 20_000 },
  ameublement: { libelle: "Ameublement", unite: "", forfait: 0 },
  electricite: { libelle: "Électricité", unite: "", forfait: 50_000 },
  eau: { libelle: "Eau", unite: "", forfait: 15_000 },
  telephone: { libelle: "Téléphone", unite: "", forfait: 20_000 },
  vehicule: { libelle: "Véhicule", unite: "véhicule", forfait: 20_000 },
  domestique: { libelle: "Domesticité", unite: "domestique", forfait: 20_000 },
  nourriture: { libelle: "Nourriture", unite: "", forfait: 25_000 },
} as const;

export type AvantageEnNature = keyof typeof AVANTAGES_EN_NATURE;
export const AVANTAGES_KEYS = Object.keys(AVANTAGES_EN_NATURE) as AvantageEnNature[];

/**
 * Valeur mensuelle des avantages en nature, aux forfaits de l'art. 144 :
 * logement à 20 000 par pièce dans la limite du tiers de la rémunération
 * principale ; ameublement au tiers du logement ; les autres au forfait, par
 * unité (véhicule, domestique) ou une fois.
 */
export function evaluerAvantagesEnNature(
  avantages: Array<{ kind: string; count?: number }>,
  remunerationPrincipale: number,
): { total: number; detail: Array<{ kind: AvantageEnNature; label: string; amount: number }> } {
  const has = (k: AvantageEnNature) => avantages.find(a => a.kind === k);
  const nb = (k: AvantageEnNature) => Math.max(1, Math.floor(Number(has(k)?.count) || 1));
  const detail: Array<{ kind: AvantageEnNature; label: string; amount: number }> = [];
  let logement = 0;
  if (has("logement")) {
    logement = Math.min(nb("logement") * AVANTAGES_EN_NATURE.logement.forfait, Math.floor(remunerationPrincipale / 3));
    detail.push({ kind: "logement", label: `Logement (${nb("logement")} pièce${nb("logement") > 1 ? "s" : ""})`, amount: logement });
  }
  if (has("ameublement") && logement > 0) detail.push({ kind: "ameublement", label: "Ameublement", amount: Math.round(logement / 3) });
  for (const k of ["electricite", "eau", "telephone", "nourriture"] as const) {
    if (has(k)) detail.push({ kind: k, label: AVANTAGES_EN_NATURE[k].libelle, amount: AVANTAGES_EN_NATURE[k].forfait });
  }
  for (const k of ["vehicule", "domestique"] as const) {
    if (has(k)) detail.push({ kind: k, label: `${AVANTAGES_EN_NATURE[k].libelle}${nb(k) > 1 ? ` (${nb(k)})` : ""}`, amount: nb(k) * AVANTAGES_EN_NATURE[k].forfait });
  }
  return { total: detail.reduce((s, d) => s + d.amount, 0), detail };
}
