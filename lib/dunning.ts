/**
 * Moteur de relance des factures impayées.
 *
 * Le module est **pur** : il décide quoi envoyer, à qui et pourquoi, sans rien
 * envoyer lui-même. C'est ce qui permet de le tester exhaustivement, et à
 * l'écran d'aperçu de montrer exactement ce que le job de nuit fera.
 *
 * Les garde-fous ci-dessous ne sont pas des raffinements : chacun correspond à
 * une façon connue de brûler une relation client avec un automate.
 */

export type DunningChannel = "email" | "sms" | "whatsapp";

/**
 * Ton du message. La progression est volontairement lente : une facture en
 * retard de trois jours est le plus souvent un oubli, pas un refus de payer.
 */
export type DunningTone = "courtesy" | "reminder" | "firm" | "formal_notice";

export interface DunningStep {
  label: string;
  /** Décalage en jours par rapport à l'échéance. Négatif = avant échéance. */
  offsetDays: number;
  channels: DunningChannel[];
  tone: DunningTone;
  /** Prévenir aussi l'équipe interne au moment de l'envoi. */
  notifyInternal?: boolean;
  /**
   * L'envoi attend une validation humaine. Une mise en demeure engage
   * juridiquement et se lit comme une rupture de confiance : elle ne part
   * jamais toute seule, même quand le barème la rend due.
   */
  requiresApproval?: boolean;
}

export interface DunningSettings {
  enabled: boolean;
  steps: DunningStep[];
  /**
   * Montant restant dû en dessous duquel on ne relance pas. Relancer 800 FCFA
   * coûte plus cher en irritation qu'il ne rapporte.
   */
  minAmount: number;
  /**
   * Jours d'envoi autorisés (0 = dimanche … 6 = samedi). Par défaut lundi à
   * jeudi : au Niger, le vendredi est écourté et personne ne traite un impayé
   * reçu le week-end — il est simplement lu de mauvaise humeur le lundi.
   */
  sendDays: number[];
  /** Délai minimum entre deux relances d'une même facture, tous barèmes confondus. */
  minIntervalDays: number;
  /** Ne pas relancer une facture marquée en litige. */
  respectDisputes: boolean;
}

/**
 * Barème par défaut.
 *
 * La première étape part **avant** l'échéance et n'est pas une relance : c'est
 * un rappel de courtoisie, celui qui évite le retard plutôt que de le
 * constater. C'est aussi le seul dont l'effet se mesure sur le délai moyen
 * d'encaissement.
 */
export const DEFAULT_DUNNING_STEPS: DunningStep[] = [
  { label: "Rappel avant échéance", offsetDays: -3, channels: ["email"], tone: "courtesy" },
  { label: "Relance à J+3", offsetDays: 3, channels: ["email"], tone: "reminder" },
  { label: "Relance à J+10", offsetDays: 10, channels: ["email", "sms"], tone: "reminder" },
  { label: "Relance ferme à J+21", offsetDays: 21, channels: ["email", "sms"], tone: "firm", notifyInternal: true },
  {
    label: "Mise en demeure à J+45", offsetDays: 45, channels: ["email"],
    tone: "formal_notice", notifyInternal: true, requiresApproval: true,
  },
];

export const DEFAULT_DUNNING_SETTINGS: DunningSettings = {
  enabled: false,
  steps: DEFAULT_DUNNING_STEPS,
  minAmount: 5_000,
  sendDays: [1, 2, 3, 4],
  minIntervalDays: 5,
  respectDisputes: true,
};

export interface InvoiceLike {
  _id: unknown;
  number: string;
  totalTTC: number;
  paidAmount?: number;
  creditedAmount?: number;
  /** Retenue de garantie : pas exigible, jamais relancée. */
  retentionAmount?: number;
  dueDate?: Date | string | null;
  status: string;
  documentType?: string;
  disputedAt?: Date | string | null;
  clientId?: unknown;
}

export interface ClientLike {
  _id: unknown;
  name: string;
  email?: string;
  phone?: string;
}

/** Une relance déjà partie. L'unicité (facture, étape) rend le job rejouable. */
export interface DunningHistoryEntry {
  invoiceId: string;
  stepIndex: number;
  sentAt: Date | string;
  outcome?: string;
}

export type SkipReason =
  | "disabled" | "not_an_invoice" | "not_due" | "settled" | "draft_or_cancelled"
  | "below_min_amount" | "disputed" | "no_step_due" | "already_sent"
  | "too_soon" | "not_a_send_day" | "no_contact" | "needs_approval";

export interface DunningAction {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  stepIndex: number;
  step: DunningStep;
  /** Canaux réellement praticables, une fois les coordonnées connues. */
  channels: DunningChannel[];
  outstanding: number;
  daysPastDue: number;
  /** L'action est prête à partir, ou attend une validation humaine. */
  needsApproval: boolean;
}

export interface DunningSkip {
  invoiceId: string;
  invoiceNumber: string;
  reason: SkipReason;
  /** Formulation destinée à l'écran : un impayé non relancé doit s'expliquer. */
  message: string;
}

export interface DunningPlan {
  actions: DunningAction[];
  skipped: DunningSkip[];
  /** Total restant dû sur les factures que le plan touche. */
  targetedAmount: number;
}

const DAY = 86_400_000;

/** Minuit local, pour que les écarts se comptent en jours calendaires. */
export function startOfDay(value: Date | string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/**
 * Restant dû.
 *
 * Les avoirs se retranchent : relancer un client pour un montant qu'on lui a
 * déjà crédité est la faute qui coûte le plus cher en crédibilité, et c'est
 * exactement ce que produit un `totalTTC - paidAmount` naïf.
 */
export function outstandingAmount(invoice: InvoiceLike): number {
  const paid = invoice.paidAmount || 0;
  const credited = invoice.creditedAmount || 0;
  const retention = invoice.status === "cancelled" ? 0 : (invoice.retentionAmount || 0);
  return Math.max(0, invoice.totalTTC - paid - credited - retention);
}

export function daysPastDue(invoice: InvoiceLike, asOf: Date): number {
  if (!invoice.dueDate) return 0;
  return daysBetween(invoice.dueDate, asOf);
}

/** Étapes triées par ancienneté croissante, index d'origine conservé. */
function orderedSteps(settings: DunningSettings): Array<{ step: DunningStep; index: number }> {
  return settings.steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.offsetDays - b.step.offsetDays);
}

/**
 * Étape due pour une facture, à une date donnée.
 *
 * On retient **la plus avancée** des étapes échues, pas la première non
 * envoyée. La différence n'apparaît qu'une fois : le jour où l'on active les
 * relances sur un portefeuille déjà ancien. Avec la première non envoyée, un
 * client qui traîne depuis six mois reçoit le rappel de courtoisie, puis la
 * relance à J+3, puis celle de J+10… un message tous les cinq jours pour une
 * facture unique. On envoie le message qui correspond à la situation réelle,
 * et on considère les étapes précédentes comme dépassées.
 */
export function dueStep(
  invoice: InvoiceLike,
  settings: DunningSettings,
  sentStepIndexes: Set<number>,
  asOf: Date
): { step: DunningStep; index: number } | null {
  const past = daysPastDue(invoice, asOf);
  const due = orderedSteps(settings).filter(s => past >= s.step.offsetDays);
  if (due.length === 0) return null;

  const latest = due[due.length - 1];
  if (sentStepIndexes.has(latest.index)) return null;
  return latest;
}

/** Étapes rendues caduques par l'envoi d'une étape plus avancée. */
export function supersededSteps(
  settings: DunningSettings,
  chosenIndex: number,
  sentStepIndexes: Set<number>
): number[] {
  const chosen = settings.steps[chosenIndex];
  if (!chosen) return [];
  return settings.steps
    .map((step, index) => ({ step, index }))
    .filter(s =>
      s.index !== chosenIndex
      && s.step.offsetDays < chosen.offsetDays
      && !sentStepIndexes.has(s.index)
    )
    .map(s => s.index);
}

export function isSendDay(settings: DunningSettings, asOf: Date): boolean {
  if (settings.sendDays.length === 0) return true;
  return settings.sendDays.includes(asOf.getDay());
}

/**
 * Construit le plan d'une exécution.
 *
 * Rien n'est envoyé ici. Ce que cette fonction renvoie est exactement ce que
 * l'écran d'aperçu affiche et ce que le job de nuit exécutera — une seule
 * définition, donc pas de surprise au réveil.
 */
export function planRun(
  invoices: InvoiceLike[],
  clients: Map<string, ClientLike>,
  settings: DunningSettings,
  history: DunningHistoryEntry[],
  asOf: Date = new Date()
): DunningPlan {
  const actions: DunningAction[] = [];
  const skipped: DunningSkip[] = [];

  if (!settings.enabled) {
    return {
      actions: [],
      targetedAmount: 0,
      skipped: invoices.map(inv => ({
        invoiceId: String(inv._id), invoiceNumber: inv.number, reason: "disabled" as const,
        message: "Les relances automatiques sont désactivées.",
      })),
    };
  }

  const sendDayOk = isSendDay(settings, asOf);

  // Historique indexé par facture : une seule passe, quel que soit le volume.
  const byInvoice = new Map<string, DunningHistoryEntry[]>();
  for (const entry of history) {
    const list = byInvoice.get(entry.invoiceId);
    if (list) list.push(entry);
    else byInvoice.set(entry.invoiceId, [entry]);
  }

  for (const invoice of invoices) {
    const id = String(invoice._id);
    const skip = (reason: SkipReason, message: string) =>
      skipped.push({ invoiceId: id, invoiceNumber: invoice.number, reason, message });

    if (invoice.documentType === "credit_note") {
      skip("not_an_invoice", "Un avoir ne se relance pas.");
      continue;
    }
    if (invoice.status === "draft" || invoice.status === "cancelled") {
      skip("draft_or_cancelled", `Facture ${invoice.status === "draft" ? "au brouillon" : "annulée"}.`);
      continue;
    }
    if (!invoice.dueDate) {
      skip("not_due", "Aucune date d'échéance : rien à relancer.");
      continue;
    }

    const outstanding = outstandingAmount(invoice);
    if (outstanding <= 0) {
      skip("settled", "Soldée — règlements et avoirs couvrent le montant.");
      continue;
    }
    if (outstanding < settings.minAmount) {
      skip("below_min_amount",
        `Restant dû ${outstanding.toLocaleString("fr-FR")} FCFA, sous le seuil de `
        + `${settings.minAmount.toLocaleString("fr-FR")} FCFA.`);
      continue;
    }
    if (settings.respectDisputes && invoice.disputedAt) {
      skip("disputed", "Facture en litige : la relance attend la résolution.");
      continue;
    }

    const entries = byInvoice.get(id) || [];
    const sentIndexes = new Set(entries.map(e => e.stepIndex));
    const chosen = dueStep(invoice, settings, sentIndexes, asOf);
    if (!chosen) {
      const past = daysPastDue(invoice, asOf);
      skip(sentIndexes.size > 0 ? "already_sent" : "no_step_due",
        sentIndexes.size > 0
          ? "Dernière étape due déjà envoyée."
          : past < 0
            ? `Échéance dans ${-past} jour(s).`
            : `Aucune étape du barème n'est due à J+${past}.`);
      continue;
    }

    // Le délai minimum prime sur le barème : deux étapes rapprochées ne
    // doivent pas produire deux messages en deux jours.
    const lastSent = entries
      .map(e => startOfDay(e.sentAt).getTime())
      .sort((a, b) => b - a)[0];
    if (lastSent !== undefined) {
      const since = daysBetween(new Date(lastSent), asOf);
      if (since < settings.minIntervalDays) {
        skip("too_soon",
          `Relancée il y a ${since} jour(s) ; l'intervalle minimum est de ${settings.minIntervalDays}.`);
        continue;
      }
    }

    if (!sendDayOk) {
      skip("not_a_send_day", "Jour non retenu pour les envois.");
      continue;
    }

    const client = clients.get(String(invoice.clientId));
    if (!client) {
      skip("no_contact", "Client introuvable.");
      continue;
    }

    // Un canal sans coordonnée n'est pas un canal. Le dire, plutôt que
    // d'enregistrer un envoi qui n'a jamais eu lieu.
    const channels = chosen.step.channels.filter(c =>
      c === "email" ? Boolean(client.email) : Boolean(client.phone)
    );
    if (channels.length === 0) {
      skip("no_contact",
        `Aucune coordonnée pour ${client.name} sur ${chosen.step.channels.join(", ")}.`);
      continue;
    }

    actions.push({
      invoiceId: id,
      invoiceNumber: invoice.number,
      clientId: String(client._id),
      clientName: client.name,
      stepIndex: chosen.index,
      step: chosen.step,
      channels,
      outstanding,
      daysPastDue: daysPastDue(invoice, asOf),
      needsApproval: Boolean(chosen.step.requiresApproval),
    });
  }

  return {
    actions,
    skipped,
    targetedAmount: actions.reduce((sum, a) => sum + a.outstanding, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rédaction
// ─────────────────────────────────────────────────────────────────────────────

export interface MessageContext {
  clientName: string;
  invoiceNumber: string;
  outstanding: number;
  dueDate: Date;
  daysPastDue: number;
  tenantName: string;
  /** Lien vers le portail de règlement, quand il est configuré. */
  payLink?: string;
}

const FR_DATE = (d: Date) => new Date(d).toLocaleDateString("fr-FR");
const FR_XOF = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Objet et corps selon le ton.
 *
 * Les formulations montent en fermeté sans jamais accuser : un retard a le
 * plus souvent une cause administrative, et le message qui suppose la mauvaise
 * foi se retourne contre l'émetteur quand la facture était simplement restée
 * dans une bannette.
 */
export function composeSubject(tone: DunningTone, ctx: MessageContext): string {
  switch (tone) {
    case "courtesy":
      return `Facture ${ctx.invoiceNumber} — échéance le ${FR_DATE(ctx.dueDate)}`;
    case "reminder":
      return `Rappel — facture ${ctx.invoiceNumber} en attente de règlement`;
    case "firm":
      return `Facture ${ctx.invoiceNumber} échue depuis ${ctx.daysPastDue} jours`;
    case "formal_notice":
      return `Mise en demeure — facture ${ctx.invoiceNumber}`;
  }
}

export function composeBody(tone: DunningTone, ctx: MessageContext): string {
  const amount = FR_XOF(ctx.outstanding);
  const due = FR_DATE(ctx.dueDate);

  switch (tone) {
    case "courtesy":
      return `Bonjour ${ctx.clientName},\n\n`
        + `Nous vous rappelons que la facture ${ctx.invoiceNumber}, d'un montant de ${amount}, `
        + `arrive à échéance le ${due}.\n\n`
        + `Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.\n\n`
        + `Cordialement,\n${ctx.tenantName}`;

    case "reminder":
      return `Bonjour ${ctx.clientName},\n\n`
        + `Sauf erreur de notre part, la facture ${ctx.invoiceNumber} (${amount}), échue le ${due}, `
        + `reste en attente de règlement à ce jour.\n\n`
        + `Si un point bloque — pièce manquante, bon de commande, référence — indiquez-le nous, `
        + `nous le traiterons rapidement.\n\n`
        + `Cordialement,\n${ctx.tenantName}`;

    case "firm":
      return `Bonjour ${ctx.clientName},\n\n`
        + `La facture ${ctx.invoiceNumber} d'un montant de ${amount} est échue depuis `
        + `${ctx.daysPastDue} jours (échéance : ${due}) et demeure impayée malgré nos relances.\n\n`
        + `Nous vous remercions de procéder au règlement sous huitaine, ou de nous contacter `
        + `pour convenir d'un échéancier.\n\n`
        + `Cordialement,\n${ctx.tenantName}`;

    case "formal_notice":
      return `Madame, Monsieur,\n\n`
        + `Malgré nos relances successives, la facture ${ctx.invoiceNumber} d'un montant de `
        + `${amount}, échue le ${due}, demeure impayée à ce jour, soit un retard de `
        + `${ctx.daysPastDue} jours.\n\n`
        + `Par la présente, nous vous mettons en demeure de régler cette somme sous quinze (15) `
        + `jours à compter de la réception de ce courrier.\n\n`
        + `À défaut, nous nous réservons le droit d'engager toute procédure de recouvrement, `
        + `et des intérêts de retard pourront être appliqués conformément aux conditions `
        + `générales de vente.\n\n`
        + `Nous restons à votre disposition pour convenir d'un règlement amiable.\n\n`
        + `${ctx.tenantName}`;
  }
}

/** 160 caractères : au-delà, l'opérateur facture un second message. */
export function composeSms(tone: DunningTone, ctx: MessageContext): string {
  const amount = FR_XOF(ctx.outstanding);
  const base = tone === "firm" || tone === "formal_notice"
    ? `${ctx.tenantName} : facture ${ctx.invoiceNumber} (${amount}) impayée depuis ${ctx.daysPastDue} j. Merci de régulariser.`
    : `${ctx.tenantName} : facture ${ctx.invoiceNumber} (${amount}) en attente de règlement. Merci.`;
  return base.length <= 160 ? base : `${base.slice(0, 157)}...`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture du portefeuille
// ─────────────────────────────────────────────────────────────────────────────

export interface AgingBucket {
  label: string;
  /** Bornes en jours de retard, `to` exclu ; `null` pour l'ouvert. */
  from: number;
  to: number | null;
  count: number;
  amount: number;
}

/**
 * Balance âgée.
 *
 * Le total des impayés ne dit rien : cent mille francs à cinq jours et cent
 * mille à six mois ne sont pas la même situation, ni le même travail.
 */
export function agingBuckets(invoices: InvoiceLike[], asOf: Date = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "À échoir", from: -Infinity, to: 0, count: 0, amount: 0 },
    { label: "1 – 30 jours", from: 0, to: 31, count: 0, amount: 0 },
    { label: "31 – 60 jours", from: 31, to: 61, count: 0, amount: 0 },
    { label: "61 – 90 jours", from: 61, to: 91, count: 0, amount: 0 },
    { label: "Plus de 90 jours", from: 91, to: null, count: 0, amount: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.documentType === "credit_note") continue;
    if (invoice.status === "draft" || invoice.status === "cancelled") continue;
    const outstanding = outstandingAmount(invoice);
    if (outstanding <= 0 || !invoice.dueDate) continue;

    const past = daysPastDue(invoice, asOf);
    const bucket = buckets.find(b => past >= b.from && (b.to === null || past < b.to));
    if (bucket) {
      bucket.count += 1;
      bucket.amount += outstanding;
    }
  }

  return buckets;
}

/**
 * Délai moyen de règlement pondéré par les montants (DSO simplifié).
 *
 * Pondérer par le montant, et non compter les factures : dix petites payées
 * comptant ne compensent pas une grosse à quatre-vingt-dix jours, et c'est
 * pourtant ce que dit une moyenne simple.
 */
export function averagePaymentDelay(
  paidInvoices: Array<InvoiceLike & { paidAt?: Date | string | null }>
): number | null {
  let weighted = 0;
  let total = 0;
  for (const invoice of paidInvoices) {
    if (!invoice.dueDate || !invoice.paidAt) continue;
    const amount = invoice.totalTTC - (invoice.creditedAmount || 0);
    if (amount <= 0) continue;
    weighted += daysBetween(invoice.dueDate, invoice.paidAt) * amount;
    total += amount;
  }
  // Sans facture réglée exploitable, il n'y a pas de délai moyen — répondre
  // « 0 jour » se lirait comme un paiement comptant généralisé.
  return total > 0 ? Math.round(weighted / total) : null;
}
