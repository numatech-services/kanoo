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
