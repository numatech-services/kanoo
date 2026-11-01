/**
 * Restauration, en calcul pur (testé sans base, partagé avec l'écran) :
 * réassort entre réserve et comptoir, hausses de coût, résultat mensuel du
 * comptoir (compte de résultat de gestion), ratios et analyse de la carte.
 *
 * Le résultat est un résultat DE GESTION, construit sans double saisie :
 *  - ventes et coût des marchandises vendues : les tickets du comptoir
 *    (comptabilité matière, au coût de revient de chaque ligne) ;
 *  - pertes et écarts d'inventaire : les mouvements de stock du comptoir ;
 *  - charges : les écritures comptables de classe 6 imputées au secteur du
 *    comptoir, HORS achats de marchandises et de matières (601 à 603, déjà
 *    comptés au coût des ventes) ;
 *  - personnel : le coût employeur des bulletins du mois, au prorata du temps
 *    passé au comptoir.
 */

/**
 * Quantité BRUTE d'un ingrédient consommée par portion vendue : quantité
 * nette de la fiche ÷ rendement (poids net ÷ brut) ÷ nombre de portions de la
 * recette. Sans rendement ni portions : la quantité telle quelle.
 */
export function perPortion(line: { quantity: number; yield?: number | null }, portions?: number | null): number {
  const y = line.yield && line.yield > 0 && line.yield <= 1 ? line.yield : 1;
  const p = portions && portions >= 1 ? portions : 1;
  return Math.round((Number(line.quantity) / y / p) * 1e6) / 1e6;
}

/**
 * Recette ramenée à une portion vendue, en quantités brutes. Champs repris un
 * à un : une ligne lue par Mongoose (sous-document) ne se recopie pas par
 * décomposition (« ...r » perdrait l'identifiant de l'ingrédient).
 */
export const portionRecipe = <I>(recipe: Array<{ itemId: I; quantity: number; yield?: number | null }> | undefined, portions?: number | null) =>
  (recipe ?? []).map(r => ({ itemId: r.itemId, quantity: perPortion({ quantity: r.quantity, yield: r.yield }, portions) }));

/** Les 14 allergènes à déclarer (règlement UE 1169/2011, annexe II), repère pour la carte. */
export const ALLERGENS = ["Gluten", "Crustacés", "Œufs", "Poissons", "Arachides", "Soja", "Lait", "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques"] as const;

/** Hausse du coût d'achat notable (5 % et plus) : en points de % arrondis, sinon null. */
export function costRise(before: number, after: number, threshold = 0.05): number | null {
  if (!(before > 0) || !(after > before)) return null;
  const r = (after - before) / before;
  return r >= threshold ? Math.round(r * 1000) / 10 : null;
}

/**
 * Quantité à monter de la réserve au comptoir : de quoi revenir au double du
 * seuil (au moins un paquet entier), dans la limite de la réserve ; 0 si le
 * comptoir est au-dessus de son seuil ou sans seuil.
 */
export function supplySuggestion(i: { desk: number; reserve: number; threshold?: number; packSize?: number }): number {
  if (i.threshold == null || !Number.isFinite(i.threshold) || !Number.isFinite(i.desk) || !Number.isFinite(i.reserve) || i.desk > i.threshold || i.reserve <= 0) return 0;
  const pack = i.packSize && i.packSize > 0 ? i.packSize : 0;
  const want = Math.max(i.threshold * 2 - i.desk, pack || 1);
  // Arrondi au paquet entier sans erreur de virgule flottante (0,3 / 0,1 = 2,9999…).
  const rounded = pack ? Math.ceil(Math.round((want / pack) * 1e9) / 1e9) * pack : Math.ceil(want);
  return Math.min(i.reserve, Math.round(rounded * 1000) / 1000);
}

export const CHARGE_CATEGORIES = {
  personnel: "Personnel (salaires et charges)",
  eau: "Eau",
  electricite: "Électricité",
  energie: "Gaz, carburant, autres énergies",
  consommables: "Consommables, emballages, entretien",
  petit_materiel: "Petit matériel et vaisselle",
  loyer: "Loyer et charges locatives",
  entretien: "Entretien et réparations",
  assurance: "Assurances",
  transport: "Transport et livraisons",
  telecom: "Téléphone et internet",
  honoraires: "Honoraires et services extérieurs",
  publicite: "Publicité",
  banque: "Frais bancaires et mobile money",
  impots: "Impôts et taxes",
  amortissements: "Amortissements",
  autres: "Autres charges",
} as const;
export type ChargeCategory = keyof typeof CHARGE_CATEGORIES;

/** Achats de marchandises, matières et leurs variations : comptés au coût des ventes, pas en charges. */
export const isGoodsPurchase = (code: string) => /^60[123]/.test(code);

/** Compte SYSCOHADA de classe 6 → rubrique de charges du restaurant (null : hors charges). */
export function chargeCategory(code: string): ChargeCategory | null {
  const c = String(code ?? "");
  if (!c.startsWith("6") || isGoodsPurchase(c)) return null;
  if (c.startsWith("66")) return "personnel";
  if (c.startsWith("6051")) return "eau";
  if (c.startsWith("6052")) return "electricite";
  if (c.startsWith("6053")) return "energie";
  if (c.startsWith("6056")) return "petit_materiel";
  if (c.startsWith("604") || c.startsWith("6054") || c.startsWith("6055") || c.startsWith("608")) return "consommables";
  if (c.startsWith("622")) return "loyer";
  if (c.startsWith("624")) return "entretien";
  if (c.startsWith("625")) return "assurance";
  if (c.startsWith("61")) return "transport";
  if (c.startsWith("628")) return "telecom";
  if (c.startsWith("627")) return "publicite";
  if (c.startsWith("631")) return "banque";
  if (c.startsWith("62") || c.startsWith("63")) return "honoraires";
  if (c.startsWith("64")) return "impots";
  if (c.startsWith("68")) return "amortissements";
  return "autres";
}

export interface PnlInput {
  revenueHT: number;
  /** Coût de revient des lignes vendues au coût connu. */
  costOfSales: number;
  /** CA HT des lignes vendues sans coût connu : hors marge (on ne suppose pas un coût nul). */
  unvaluedRevenueHT: number;
  tickets: number;
  /** Achats de marchandises payés en caisse sans passer par une réception (comptés comme consommés). */
  cashPurchases?: number;
  /** Pertes déclarées (casse, péremption, invendus, déchets…), au coût. */
  losses: number;
  /** Repas du personnel et offerts, au coût : à part du coût matière. */
  staffAndOffered?: number;
  /** Écarts d'inventaire nets, au coût (négatif = manquant). */
  inventoryGap: number;
  charges: Partial<Record<ChargeCategory, number>>;
  planned: Partial<Record<ChargeCategory, number>>;
  openDays: number;
  /** Mois écoulé : le point mort se calcule sur les charges réelles. */
  pastMonth?: boolean;
}

export interface Pnl {
  revenueHT: number; valuedRevenueHT: number; costOfSales: number; cashPurchases: number; grossMargin: number;
  losses: number; staffAndOffered: number; inventoryGap: number; materialMargin: number;
  charges: Array<{ category: ChargeCategory; label: string; actual: number; planned: number }>;
  totalCharges: number; plannedCharges: number; result: number;
  ratios: {
    foodCostPct: number | null; staffCostPct: number | null; primeCostPct: number | null; resultPct: number | null;
    averageTicket: number | null; costPerTicket: number | null; marginRate: number | null;
    breakEvenRevenue: number | null; breakEvenPerDay: number | null;
  };
  unvaluedRevenueHT: number;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/**
 * Compte de résultat de gestion du mois.
 * Marge brute = CA des ventes au coût connu − leur coût − achats de caisse
 * hors réception ; marge matière = marge brute − pertes − repas du personnel
 * et offerts + écarts d'inventaire ; résultat = marge matière − charges.
 * Le CA des ventes sans coût connu est affiché mais n'entre pas dans la marge.
 * Ratios rapportés au CA au coût connu. Point mort : CA qui couvre les
 * charges au taux de marge matière (charges prévues si elles dépassent le
 * réel, pour le mois en cours seulement).
 */
export function computePnl(i: PnlInput): Pnl {
  // Entrées arrondies d'abord (une valeur manquante ou invalide vaut 0) : chaque ligne affichée s'additionne exactement.
  const r = (n: number | undefined) => (Number.isFinite(n) ? Math.round(n as number) : 0);
  const revenue = r(i.revenueHT), unvalued = Math.min(revenue, Math.max(0, r(i.unvaluedRevenueHT)));
  const valued = revenue - unvalued;
  const cost = r(i.costOfSales), cash = r(i.cashPurchases), losses = r(i.losses), staffMeals = r(i.staffAndOffered), gap = r(i.inventoryGap);
  const grossMargin = valued - cost - cash;
  const materialMargin = grossMargin - losses - staffMeals + gap;
  const cats = Object.keys(CHARGE_CATEGORIES) as ChargeCategory[];
  const charges = cats
    .map(c => ({ category: c, label: CHARGE_CATEGORIES[c], actual: r(i.charges[c]), planned: r(i.planned[c]) }))
    .filter(c => c.actual || c.planned);
  const totalCharges = charges.reduce((t, c) => t + c.actual, 0);
  const plannedCharges = charges.reduce((t, c) => t + c.planned, 0);
  const result = materialMargin - totalCharges;
  const staff = r(i.charges.personnel);
  // Coût matière : ce que la marchandise a coûté pour vendre (hors repas du personnel et offerts), rapporté au CA au coût connu.
  const foodCost = cost + cash + losses - gap;
  const marginRate = valued > 0 ? materialMargin / valued : null;
  // Mois en cours : pour chaque rubrique, le plus élevé du prévu et du réel ; mois écoulé : le réel.
  const fixed = i.pastMonth ? totalCharges : charges.reduce((t, c) => t + Math.max(c.actual, c.planned), 0);
  const breakEvenRevenue = marginRate && marginRate > 0 && fixed > 0 ? r(fixed / marginRate) : null;
  return {
    revenueHT: revenue, valuedRevenueHT: valued, costOfSales: cost, cashPurchases: cash, grossMargin,
    losses, staffAndOffered: staffMeals, inventoryGap: gap, materialMargin,
    charges, totalCharges, plannedCharges, result,
    ratios: {
      // Personnel et résultat : rapportés au CA total, comme d'usage ; coût matière et marge : au CA au coût connu.
      foodCostPct: pct(foodCost, valued), staffCostPct: pct(staff, revenue), primeCostPct: valued > 0 && revenue > 0 ? Math.round((foodCost / valued + staff / revenue) * 1000) / 10 : null,
      resultPct: pct(result, revenue), averageTicket: i.tickets ? r(i.revenueHT / i.tickets) : null,
      costPerTicket: i.tickets ? r((foodCost + staffMeals + totalCharges) / i.tickets) : null, marginRate: marginRate === null ? null : Math.round(marginRate * 1000) / 10,
      breakEvenRevenue, breakEvenPerDay: breakEvenRevenue && i.openDays > 0 ? r(breakEvenRevenue / i.openDays) : null,
    },
    unvaluedRevenueHT: r(i.unvaluedRevenueHT),
  };
}

/** Coût du personnel affecté : coût employeur du mois × part du temps au comptoir. */
export function staffCost(payslips: Array<{ employeeId: string; employerCost?: number; grossTotal?: number; cnssEmployer?: number }>, staff: Array<{ employeeId: string; share: number }>): number {
  const share = new Map(staff.map(s => [String(s.employeeId), Number.isFinite(s.share) ? Math.min(1, Math.max(0, s.share)) : 0]));
  return Math.round(payslips.reduce((t, p) => {
    const s = share.get(String(p.employeeId)) ?? 0;
    const cost = p.employerCost && p.employerCost > 0 ? p.employerCost : (p.grossTotal ?? 0) + (p.cnssEmployer ?? 0);
    return t + s * cost;
  }, 0));
}

/**
 * Affectations datées ramenées au mois : part de temps × jours couverts ÷
 * jours du mois, cumulée par collaborateur (deux périodes successives dans le
 * même mois s'additionnent). Sans dates, la part vaut pour tout le mois.
 */
export function monthShares(staff: Array<{ employeeId: unknown; share: number; from?: string | null; to?: string | null }>, year: number, m: number): Array<{ employeeId: string; share: number }> {
  const mm = String(m).padStart(2, "0"), days = new Date(year, m, 0).getDate();
  const first = `${year}-${mm}-01`, last = `${year}-${mm}-${String(days).padStart(2, "0")}`;
  const covered = (from?: string | null, to?: string | null) => {
    const a = from && from > first ? from : first, b = to && to < last ? to : last;
    return a > b ? 0 : Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000) + 1;
  };
  const out = new Map<string, number>();
  for (const s of staff) {
    const v = s.share * (covered(s.from, s.to) / days);
    if (v > 0) out.set(String(s.employeeId), (out.get(String(s.employeeId)) ?? 0) + v);
  }
  return [...out].map(([employeeId, v]) => ({ employeeId, share: Math.round(Math.min(1, v) * 1e6) / 1e6 }));
}

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";
export const MENU_LABELS: Record<MenuClass, { label: string; advice: string }> = {
  star: { label: "Locomotive", advice: "très vendu et rentable : à garder en vue, ne pas toucher au prix" },
  plowhorse: { label: "Cheval de labour", advice: "très vendu, peu rentable : revoir la portion, la recette ou le prix" },
  puzzle: { label: "Énigme", advice: "rentable, peu vendu : mettre en avant (carte, conseil du caissier)" },
  dog: { label: "Poids mort", advice: "peu vendu, peu rentable : à retravailler ou retirer de la carte" },
};

/**
 * Analyse de la carte (popularité × marge unitaire) : populaire si la part des
 * ventes dépasse 70 % de la part moyenne ; rentable si la marge unitaire
 * dépasse la marge unitaire moyenne pondérée. Articles sans coût exclus.
 */
export function menuEngineering(rows: Array<{ id: string; name: string; quantity: number; marginHT: number; category?: string }>): Array<{ id: string; name: string; category?: string; quantity: number; unitMargin: number; mix: number; class: MenuClass }> {
  // Méthode appliquée par famille de la carte : une canette ne se compare pas à un plat.
  const fams = [...new Set(rows.map(r => r.category || "Sans famille"))];
  if (fams.length > 1) return fams.flatMap(f => menuEngineering(rows.filter(r => (r.category || "Sans famille") === f).map(r => ({ ...r, category: undefined }))).map(m => ({ ...m, category: f })));
  const valued = rows.filter(r => r.quantity > 0);
  const totalQty = valued.reduce((t, r) => t + r.quantity, 0);
  if (!valued.length || !totalQty) return [];
  const avgMargin = valued.reduce((t, r) => t + r.marginHT, 0) / totalQty;
  const popular = 0.7 / valued.length;
  return valued.map(r => {
    const mix = r.quantity / totalQty, unitMargin = r.marginHT / r.quantity;
    const hi = mix >= popular, rich = unitMargin >= avgMargin;
    return { id: r.id, name: r.name, ...(r.category ? { category: r.category } : {}), quantity: r.quantity, unitMargin: Math.round(unitMargin), mix: Math.round(mix * 1000) / 10, class: (hi && rich ? "star" : hi ? "plowhorse" : rich ? "puzzle" : "dog") as MenuClass };
  }).sort((a, b) => b.quantity - a.quantity);
}

/** Mois « AAAA-MM » → bornes locales [début, fin]. */
export function monthBounds(month: string): { from: Date; to: Date; fromDay: string; toDay: string; year: number; m: number } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: new Date(y, m - 1, 1), to: new Date(y, m - 1, last, 23, 59, 59, 999), fromDay: `${y}-${mm}-01`, toDay: `${y}-${mm}-${String(last).padStart(2, "0")}`, year: y, m };
}

export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/**
 * Charges qui suivent le volume vendu (par défaut) : consommables et
 * emballages, gaz de cuisson, livraisons, frais de paiement. Les autres
 * (personnel, loyer, électricité, assurances, amortissements…) sont tenues
 * pour fixes sur le mois. Chaque restaurant peut corriger la liste.
 */
export const DEFAULT_VARIABLE_CATEGORIES: ChargeCategory[] = ["consommables", "energie", "transport", "banque"];

/**
 * Charges fixes et variables d'un mois, point mort et effet d'une baisse du
 * volume vendu (prix et coûts unitaires inchangés). Variables : coût matière
 * complet (coût des ventes, pertes, repas, écarts d'inventaire) et charges
 * variables ; fixes : le reste.
 */
export function volumeSimulation(pnl: Pick<Pnl, "revenueHT" | "materialMargin" | "charges">, variableCats: string[] = DEFAULT_VARIABLE_CATEGORIES, drops = [0.1, 0.2, 0.3]) {
  const R = pnl.revenueHT;
  const variableCharges = pnl.charges.filter(c => variableCats.includes(c.category)).reduce((t, c) => t + c.actual, 0);
  const fixed = pnl.charges.filter(c => !variableCats.includes(c.category)).reduce((t, c) => t + c.actual, 0);
  const variable = Math.round(R - pnl.materialMargin + variableCharges);
  const contribution = R - variable;
  const rate = R > 0 ? contribution / R : null;
  const breakEven = rate && rate > 0 ? Math.round(fixed / rate) : null;
  return {
    revenueHT: R, variable, variableCharges: Math.round(variableCharges), fixed: Math.round(fixed), contribution: Math.round(contribution),
    contributionPct: rate === null ? null : Math.round(rate * 1000) / 10,
    breakEvenRevenue: breakEven, safetyMarginPct: breakEven !== null && R > 0 ? Math.round(((R - breakEven) / R) * 1000) / 10 : null,
    scenarios: drops.map(d => {
      const r = R * (1 - d), result = Math.round(r * (rate ?? 0) - fixed);
      return { dropPct: Math.round(d * 100), revenueHT: Math.round(r), result, resultPct: r > 0 ? Math.round((result / r) * 1000) / 10 : null };
    }),
  };
}

const dayMs = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/**
 * Dotation aux amortissements d'un équipement pour un mois, au prorata des
 * jours. Linéaire : (coût − valeur résiduelle) ÷ durée, du jour d'acquisition
 * jusqu'à la fin de la durée ; autre méthode : annuité du plan de l'exercice
 * répartie sur ses jours. Rien avant l'acquisition, après la cession ou la fin.
 */
export function monthlyDepreciation(a: {
  acquisitionDate: Date | string; acquisitionCost: number; residualValue?: number; usefulLifeYears?: number; depreciationMethod?: string;
  disposalDate?: Date | string | null; depreciationSchedule?: Array<{ year: number; annuity: number }>;
}, year: number, month: number): number {
  if (a.depreciationMethod === "none") return 0;
  const acq = new Date(a.acquisitionDate), life = a.usefulLifeYears && a.usefulLifeYears > 0 ? a.usefulLifeYears : 5;
  const endLife = Date.UTC(acq.getUTCFullYear() + life, acq.getUTCMonth(), acq.getUTCDate()); // exclu
  const stop = a.disposalDate ? Math.min(endLife, utcDay(new Date(a.disposalDate)) + dayMs) : endLife;
  const mStart = Date.UTC(year, month - 1, 1), mEnd = Date.UTC(year, month, 1);
  const from = Math.max(mStart, utcDay(acq)), to = Math.min(mEnd, stop);
  if (to <= from) return 0;
  const days = (to - from) / dayMs;
  if (a.depreciationMethod === "degressive") {
    const annuity = a.depreciationSchedule?.find(s => s.year === year)?.annuity ?? 0;
    const yFrom = Math.max(Date.UTC(year, 0, 1), utcDay(acq)), yTo = Math.min(Date.UTC(year + 1, 0, 1), stop);
    return yTo > yFrom ? Math.round(annuity * days / ((yTo - yFrom) / dayMs)) : 0;
  }
  const base = Math.max(0, a.acquisitionCost - (a.residualValue ?? 0));
  return Math.round(base * days / ((endLife - utcDay(acq)) / dayMs));
}

/**
 * Rythme d'un article : il est compté à l'inventaire du samedi chaque semaine,
 * une semaine sur deux, ou à la première semaine du mois ; le réassort couvre
 * la même durée. Sans rythme : chaque semaine, réassort du restaurant.
 */
export const RHYTHMS = {
  week: { label: "Chaque semaine", days: 7 },
  fortnight: { label: "Toutes les deux semaines", days: 14 },
  month: { label: "Chaque mois", days: 30 },
} as const;
export type Rhythm = keyof typeof RHYTHMS;

/** L'article est-il à compter à l'inventaire de fin de semaine du jour donné (AAAA-MM-JJ) ? */
export function countDue(rhythm: string | null | undefined, day: string): boolean {
  if (rhythm === "fortnight") {
    // Semaines comptées depuis le lundi 5 janvier 1970 : une sur deux, sans saut au changement d'année.
    const weeks = Math.floor((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(1970, 0, 5)) / (7 * 86_400_000));
    return weeks % 2 === 0;
  }
  if (rhythm === "month") return +day.slice(8, 10) <= 7;
  return true;
}
