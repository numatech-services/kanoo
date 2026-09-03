/**
 * Notes de frais — moteur de calcul.
 *
 * Module pur : il calcule, contrôle et prépare les écritures, sans rien
 * écrire. Cela permet à l'écran de saisie d'afficher exactement ce que le
 * serveur retiendra, plutôt qu'un total optimiste corrigé après validation.
 */

export type ExpenseCategory =
  | "transport" | "carburant" | "hebergement" | "restauration" | "mission"
  | "fournitures" | "telecom" | "representation" | "formation" | "autre";

export type ExpenseStatus =
  | "draft" | "submitted" | "approved" | "rejected" | "reimbursed";

export interface CategorySpec {
  label: string;
  /** Compte de charge SYSCOHADA. */
  account: string;
  accountLabel: string;
  /**
   * TVA récupérable par défaut.
   *
   * **À confirmer contre le Code général des impôts nigérien avant mise en
   * service.** Les valeurs ci-dessous suivent les usages courants des systèmes
   * de TVA — le carburant des véhicules de tourisme, la restauration et les
   * cadeaux sont classiquement exclus du droit à déduction — mais la règle
   * applicable est celle du CGI, pas celle d'un usage. Chaque ligne reste
   * modifiable par le comptable, et le drapeau est stocké sur la ligne : une
   * évolution de la doctrine ne réécrit pas le passé.
   */
  vatRecoverableByDefault: boolean;
  /** Un justificatif est-il exigé pour cette nature ? */
  receiptRequired: boolean;
}

export const CATEGORIES: Record<ExpenseCategory, CategorySpec> = {
  transport:      { label: "Transport", account: "624100", accountLabel: "Transports du personnel", vatRecoverableByDefault: true, receiptRequired: true },
  carburant:      { label: "Carburant", account: "605300", accountLabel: "Carburants et lubrifiants", vatRecoverableByDefault: false, receiptRequired: true },
  hebergement:    { label: "Hébergement", account: "625100", accountLabel: "Voyages et déplacements", vatRecoverableByDefault: true, receiptRequired: true },
  restauration:   { label: "Restauration", account: "625200", accountLabel: "Missions et réceptions", vatRecoverableByDefault: false, receiptRequired: true },
  mission:        { label: "Indemnité de mission", account: "625300", accountLabel: "Frais de mission", vatRecoverableByDefault: false, receiptRequired: false },
  fournitures:    { label: "Fournitures", account: "605100", accountLabel: "Fournitures de bureau", vatRecoverableByDefault: true, receiptRequired: true },
  telecom:        { label: "Télécommunications", account: "628100", accountLabel: "Frais de télécommunications", vatRecoverableByDefault: true, receiptRequired: true },
  representation: { label: "Représentation", account: "627100", accountLabel: "Frais de représentation", vatRecoverableByDefault: false, receiptRequired: true },
  formation:      { label: "Formation", account: "628800", accountLabel: "Formation du personnel", vatRecoverableByDefault: true, receiptRequired: true },
  autre:          { label: "Autre", account: "628900", accountLabel: "Autres charges externes", vatRecoverableByDefault: false, receiptRequired: true },
};

/** Compte de dette envers le salarié, entre l'approbation et le remboursement. */
export const STAFF_PAYABLE = { account: "422000", label: "Personnel — frais à rembourser" };
export const VAT_RECOVERABLE = { account: "445100", label: "TVA récupérable" };

export interface ExpensePolicy {
  /**
   * Plafond par nature, en XOF. `undefined` = pas de plafond.
   * Un dépassement n'interdit pas la saisie : il la signale à l'approbateur.
   * Bloquer obligerait le salarié à mentir sur la nature pour se faire
   * rembourser un repas légitimement plus cher.
   */
  caps: Partial<Record<ExpenseCategory, number>>;
  /**
   * Tarif kilométrique. **Aucune valeur par défaut** : le Niger ne publie pas
   * de barème officiel, et en inventer un ferait passer un chiffre arbitraire
   * pour une référence fiscale. Tant qu'il n'est pas renseigné, la saisie au
   * kilomètre est refusée.
   */
  mileageRate?: number;
  /** Montant au-delà duquel un justificatif est exigé, toutes natures. */
  receiptThreshold: number;
  /** Antériorité maximale acceptée, en jours. */
  maxAgeDays: number;
  vatRate: number;
}

export const DEFAULT_POLICY: ExpensePolicy = {
  caps: {},
  receiptThreshold: 5_000,
  maxAgeDays: 90,
  vatRate: 0.19,
};

export interface ExpenseLine {
  date: Date | string;
  category: ExpenseCategory;
  description: string;
  /** Montant TTC engagé. */
  amountTTC: number;
  /** TVA figurant sur le justificatif. Zéro si non ventilée. */
  vatAmount?: number;
  /** La TVA de cette ligne est-elle déductible ? Décidé à la saisie, figé. */
  vatRecoverable?: boolean;
  /** Kilomètres, pour une indemnité kilométrique. */
  distanceKm?: number;
  /** Devise d'origine et taux, si la dépense a été engagée hors XOF. */
  currency?: string;
  exchangeRate?: number;
  projectId?: string;
  clientId?: string;
  attachmentCount?: number;
}

export interface LineComputation {
  /** Montant retenu en XOF, après conversion éventuelle. */
  amountTTC: number;
  vatAmount: number;
  /** Base hors taxe imputée au compte de charge. */
  amountHT: number;
  /** TVA effectivement récupérable — nulle si la nature l'exclut. */
  vatDeducted: number;
  account: string;
  accountLabel: string;
}

/**
 * Calcule une ligne.
 *
 * La TVA non récupérable **reste dans la charge**. La sortir sans la déduire
 * ferait disparaître du résultat une dépense réellement supportée : c'est
 * l'erreur classique sur les frais de restauration.
 */
export function computeLine(line: ExpenseLine, policy: ExpensePolicy): LineComputation {
  const spec = CATEGORIES[line.category] ?? CATEGORIES.autre;
  const rate = line.exchangeRate && line.currency && line.currency !== "XOF"
    ? line.exchangeRate : 1;

  const amountTTC = Math.round((line.amountTTC || 0) * rate);
  const vatAmount = Math.round((line.vatAmount || 0) * rate);

  const recoverable = line.vatRecoverable ?? spec.vatRecoverableByDefault;
  const vatDeducted = recoverable ? Math.min(vatAmount, amountTTC) : 0;

  return {
    amountTTC,
    vatAmount,
    vatDeducted,
    amountHT: amountTTC - vatDeducted,
    account: spec.account,
    accountLabel: spec.accountLabel,
  };
}

export interface ExpenseTotals {
  totalTTC: number;
  totalVatDeducted: number;
  /** Ce qui pèse réellement sur le résultat. */
  totalCharge: number;
  lineCount: number;
}

export function totals(lines: ExpenseLine[], policy: ExpensePolicy): ExpenseTotals {
  return lines.reduce<ExpenseTotals>((acc, line) => {
    const c = computeLine(line, policy);
    return {
      totalTTC: acc.totalTTC + c.amountTTC,
      totalVatDeducted: acc.totalVatDeducted + c.vatDeducted,
      totalCharge: acc.totalCharge + c.amountHT,
      lineCount: acc.lineCount + 1,
    };
  }, { totalTTC: 0, totalVatDeducted: 0, totalCharge: 0, lineCount: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrôles
// ─────────────────────────────────────────────────────────────────────────────

export type IssueLevel = "block" | "warn";

export interface LineIssue {
  index: number;
  level: IssueLevel;
  message: string;
}

/**
 * Contrôle des lignes.
 *
 * La distinction entre bloquant et signalé est le cœur du module. Un
 * justificatif manquant **bloque** : sans lui la charge n'est pas déductible et
 * la TVA pas récupérable, rembourser reviendrait à faire supporter le risque à
 * l'entreprise. Un dépassement de plafond **signale** : il peut être
 * parfaitement justifié, et c'est à un humain d'en décider. Bloquer un
 * dépassement pousse le salarié à reclasser sa dépense dans une autre nature —
 * on perd la dépense réelle *et* le contrôle.
 */
export function checkLines(
  lines: ExpenseLine[], policy: ExpensePolicy, asOf: Date = new Date()
): LineIssue[] {
  const issues: LineIssue[] = [];

  lines.forEach((line, index) => {
    const spec = CATEGORIES[line.category] ?? CATEGORIES.autre;
    const c = computeLine(line, policy);
    const add = (level: IssueLevel, message: string) => issues.push({ index, level, message });

    if (!line.description?.trim()) {
      add("block", "Objet de la dépense manquant : une charge sans motif n'est pas justifiable.");
    }
    if (c.amountTTC <= 0) {
      add("block", "Montant nul ou négatif.");
    }
    if (line.currency && line.currency !== "XOF" && !line.exchangeRate) {
      add("block", `Dépense en ${line.currency} sans taux de conversion.`);
    }

    const needsReceipt = spec.receiptRequired || c.amountTTC >= policy.receiptThreshold;
    if (needsReceipt && !line.attachmentCount) {
      add("block",
        `Justificatif obligatoire (${spec.label.toLowerCase()}) : sans lui, la charge n'est pas `
        + `déductible et la TVA pas récupérable.`);
    }

    if (c.vatDeducted > 0 && !line.attachmentCount) {
      add("block", "TVA récupérée sans justificatif : la facture est la condition de la déduction.");
    }
    if (c.vatAmount > c.amountTTC) {
      add("block", "La TVA dépasse le montant total de la dépense.");
    }

    const age = Math.round((asOf.getTime() - new Date(line.date).getTime()) / 86_400_000);
    if (age > policy.maxAgeDays) {
      add("warn", `Dépense vieille de ${age} jours, au-delà du délai de ${policy.maxAgeDays} jours.`);
    }
    if (age < -1) {
      add("block", "Dépense datée dans le futur.");
    }

    const cap = policy.caps[line.category];
    if (cap !== undefined && c.amountTTC > cap) {
      add("warn",
        `${c.amountTTC.toLocaleString("fr-FR")} XOF pour un plafond de `
        + `${cap.toLocaleString("fr-FR")} XOF. À justifier auprès de l'approbateur.`);
    }

    if (line.distanceKm && !policy.mileageRate) {
      add("block",
        "Aucun tarif kilométrique n'est défini pour votre organisation. "
        + "Renseignez-le dans les paramètres, ou saisissez le montant réel.");
    }
  });

  return issues;
}

/** Une note ne part en validation que si rien ne bloque. */
export function canSubmit(issues: LineIssue[]): boolean {
  return !issues.some(i => i.level === "block");
}

/** Montant d'une indemnité kilométrique. Refuse plutôt que d'inventer un tarif. */
export function mileageAmount(distanceKm: number, policy: ExpensePolicy): number | null {
  if (!policy.mileageRate || policy.mileageRate <= 0) return null;
  return Math.round(distanceKm * policy.mileageRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Écritures
// ─────────────────────────────────────────────────────────────────────────────

export interface EntryLine {
  accountCode: string;
  accountLabel: string;
  debit: number;
  credit: number;
}

/**
 * Écriture d'engagement, à l'approbation.
 *
 * Charges au débit, TVA récupérable au débit, dette envers le salarié au
 * crédit. Les charges sont regroupées par compte : une note de douze tickets
 * de taxi ne produit pas douze lignes au même compte.
 *
 * L'écriture est équilibrée par construction, et le vérifier reste utile —
 * un arrondi de conversion mal placé déséquilibre un journal sans prévenir.
 */
export function commitmentEntry(
  lines: ExpenseLine[], policy: ExpensePolicy
): EntryLine[] {
  const byAccount = new Map<string, { label: string; amount: number }>();
  let vat = 0;
  let total = 0;

  for (const line of lines) {
    const c = computeLine(line, policy);
    const current = byAccount.get(c.account);
    if (current) current.amount += c.amountHT;
    else byAccount.set(c.account, { label: c.accountLabel, amount: c.amountHT });
    vat += c.vatDeducted;
    total += c.amountTTC;
  }

  const entry: EntryLine[] = [...byAccount.entries()]
    .filter(([, v]) => v.amount !== 0)
    .map(([code, v]) => ({ accountCode: code, accountLabel: v.label, debit: v.amount, credit: 0 }));

  if (vat > 0) {
    entry.push({ accountCode: VAT_RECOVERABLE.account, accountLabel: VAT_RECOVERABLE.label, debit: vat, credit: 0 });
  }
  entry.push({ accountCode: STAFF_PAYABLE.account, accountLabel: STAFF_PAYABLE.label, debit: 0, credit: total });

  return entry;
}

/** Écriture de règlement : la dette s'éteint, la trésorerie sort. */
export function reimbursementEntry(amount: number): EntryLine[] {
  return [
    { accountCode: STAFF_PAYABLE.account, accountLabel: STAFF_PAYABLE.label, debit: amount, credit: 0 },
    { accountCode: "521000", accountLabel: "Banque", debit: 0, credit: amount },
  ];
}

export function isBalanced(entry: EntryLine[]): boolean {
  const debit = entry.reduce((s, l) => s + l.debit, 0);
  const credit = entry.reduce((s, l) => s + l.credit, 0);
  return debit === credit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle de vie
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: "Brouillon",
  submitted: "En validation",
  approved: "Approuvée",
  rejected: "Refusée",
  reimbursed: "Remboursée",
};

/**
 * Transitions autorisées.
 *
 * Une note approuvée ne redevient pas brouillon : elle a produit une écriture
 * comptable, et l'annuler suppose une contre-passation, pas un retour en
 * arrière silencieux. Une note remboursée est un terminus.
 */
const TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected", "draft"],
  approved: ["reimbursed"],
  rejected: ["draft"],
  reimbursed: [],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(from: ExpenseStatus, to: ExpenseStatus): string {
  if (from === "reimbursed") {
    return "Cette note est remboursée : elle ne se modifie plus. Émettez une note corrective.";
  }
  if (from === "approved" && to !== "reimbursed") {
    return "Cette note est approuvée et a produit une écriture comptable. "
      + "Revenir en arrière suppose une contre-passation, pas une modification.";
  }
  return `Passage impossible de « ${STATUS_LABEL[from]} » à « ${STATUS_LABEL[to]} ».`;
}
