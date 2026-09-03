/**
 * Documents administratifs — veille des échéances.
 *
 * L'erreur qu'on fait naturellement, c'est d'alerter à l'expiration. Or une
 * attestation de régularité fiscale qui expire le 30 ne se renouvelle pas le
 * 29 : il faut déposer la demande, l'administration l'instruit, et le délai
 * réel se compte en semaines. **Ce qui compte, c'est la date à laquelle il
 * faut commencer**, pas celle à laquelle on est en faute.
 *
 * Tout le module tourne autour de cette date-là.
 */

export type DocumentStatus =
  | "valid"            // rien à faire
  | "renewal_due"      // il faut lancer le renouvellement maintenant
  | "renewal_late"     // on aurait dû commencer, la marge est entamée
  | "in_progress"      // renouvellement engagé, on attend l'administration
  | "expiring"         // expire sous peu, renouvellement non engagé
  | "expired"          // périmé
  | "perpetual";       // sans échéance

/**
 * Délai d'obtention par nature de document, en jours calendaires.
 *
 * **Ces valeurs sont des points de départ, pas une doctrine.** Elles reflètent
 * des ordres de grandeur couramment observés et doivent être ajustées par
 * chaque organisation en fonction de son expérience réelle avec
 * l'administration concernée — c'est précisément ce qu'un service
 * administratif sait et qu'un logiciel ne peut pas deviner. Chaque document
 * porte son propre délai, modifiable.
 *
 * Le délai est en jours **calendaires** parce que c'est ainsi qu'on le vit :
 * une administration fermée le week-end transforme quinze jours ouvrés en
 * trois semaines, et c'est la date au calendrier qui décide.
 */
export interface DocumentTypeSpec {
  label: string;
  /** Durée de validité usuelle, en jours. `null` = sans échéance. */
  validityDays: number | null;
  /** Délai d'obtention : combien de temps avant l'échéance il faut s'y prendre. */
  leadTimeDays: number;
  /** Rappel : l'échéance de ce document bloque-t-elle une activité ? */
  blocking: boolean;
  hint?: string;
}

export type DocumentType =
  | "rccm" | "nif" | "arf" | "cnss" | "patente" | "agrement" | "assurance"
  | "bail" | "contrat_travail" | "visa_travail" | "carte_grise"
  | "visite_technique" | "caution" | "certificat" | "autre";

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeSpec> = {
  rccm: {
    label: "RCCM",
    validityDays: null, leadTimeDays: 30, blocking: true,
    hint: "Sans échéance, mais toute modification statutaire doit y être inscrite.",
  },
  nif: {
    label: "NIF",
    validityDays: null, leadTimeDays: 15, blocking: true,
  },
  arf: {
    label: "Attestation de régularité fiscale",
    validityDays: 90, leadTimeDays: 21, blocking: true,
    hint: "Réclamée à chaque soumission de marché public. Sans elle, l'offre est écartée.",
  },
  cnss: {
    label: "Attestation CNSS",
    validityDays: 90, leadTimeDays: 21, blocking: true,
    hint: "Exigée avec l'attestation fiscale dans les dossiers de marché.",
  },
  patente: {
    label: "Patente / taxe professionnelle",
    validityDays: 365, leadTimeDays: 30, blocking: true,
  },
  agrement: {
    label: "Agrément ou autorisation d'exercer",
    validityDays: 365, leadTimeDays: 60, blocking: true,
    hint: "Le délai d'instruction varie fortement selon l'autorité : ajustez-le.",
  },
  assurance: {
    label: "Police d'assurance",
    validityDays: 365, leadTimeDays: 30, blocking: false,
  },
  bail: {
    label: "Bail commercial",
    validityDays: 1095, leadTimeDays: 90, blocking: false,
    hint: "Le préavis de renonciation court bien avant l'échéance : vérifiez le contrat.",
  },
  contrat_travail: {
    label: "Contrat de travail à durée déterminée",
    validityDays: null, leadTimeDays: 30, blocking: false,
    hint: "Un CDD qui court au-delà de son terme sans avenant se requalifie.",
  },
  visa_travail: {
    label: "Autorisation de travail / visa",
    validityDays: 365, leadTimeDays: 60, blocking: true,
  },
  carte_grise: {
    label: "Carte grise",
    validityDays: null, leadTimeDays: 15, blocking: false,
  },
  visite_technique: {
    label: "Visite technique de véhicule",
    validityDays: 180, leadTimeDays: 14, blocking: true,
  },
  caution: {
    label: "Caution ou garantie bancaire",
    validityDays: null, leadTimeDays: 30, blocking: true,
    hint: "La mainlevée ne se fait pas toute seule : une garantie oubliée immobilise des fonds.",
  },
  certificat: {
    label: "Certificat de conformité",
    validityDays: 365, leadTimeDays: 45, blocking: false,
  },
  autre: {
    label: "Autre document",
    validityDays: null, leadTimeDays: 30, blocking: false,
  },
};

export interface AdminDocumentLike {
  _id?: unknown;
  label: string;
  type: DocumentType;
  reference?: string;
  issuedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  /** Délai propre à ce document. À défaut, celui de sa nature. */
  leadTimeDays?: number;
  /** Renouvellement engagé : la démarche est partie, l'alerte se tait. */
  renewalStartedAt?: Date | string | null;
  /** Document remplacé par un autre : il sort de la veille. */
  replacedAt?: Date | string | null;
  archivedAt?: Date | string | null;
}

const DAY = 86_400_000;

function startOfDay(value: Date | string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** Délai retenu : celui du document s'il en porte un, sinon celui de sa nature. */
export function leadTimeFor(doc: AdminDocumentLike): number {
  if (typeof doc.leadTimeDays === "number" && doc.leadTimeDays >= 0) return doc.leadTimeDays;
  return DOCUMENT_TYPES[doc.type]?.leadTimeDays ?? 30;
}

/**
 * Date à laquelle il faut lancer la démarche.
 *
 * C'est **la** donnée du module. Un tableau qui n'affiche que la date
 * d'expiration laisse chacun faire la soustraction de tête — et se tromper,
 * puisque le délai varie d'un document à l'autre.
 */
export function renewalStartDate(doc: AdminDocumentLike): Date | null {
  if (!doc.expiresAt) return null;
  const expiry = startOfDay(doc.expiresAt);
  // Re-normalisé après la soustraction : un décalage horaire ferait retomber
  // le résultat à 23 h de la veille, et la date affichée serait fausse d'un
  // jour. Le Niger n'a pas d'heure d'été, mais le serveur n'est pas forcément
  // à Niamey.
  return startOfDay(new Date(expiry.getTime() - leadTimeFor(doc) * DAY));
}

export function statusOf(doc: AdminDocumentLike, asOf: Date = new Date()): DocumentStatus {
  if (doc.archivedAt || doc.replacedAt) return "perpetual";
  if (!doc.expiresAt) return "perpetual";

  const daysLeft = daysBetween(asOf, doc.expiresAt);
  if (daysLeft < 0) return "expired";

  // Une démarche engagée ne se réclame plus : c'est l'administration qu'on
  // attend, pas l'utilisateur. L'alerte revient si l'échéance arrive quand
  // même — un dossier peut dormir sur un bureau.
  if (doc.renewalStartedAt && daysLeft > 7) return "in_progress";

  const start = renewalStartDate(doc)!;
  const daysUntilStart = daysBetween(asOf, start);

  if (daysUntilStart > 0) return "valid";
  // Passé la date de lancement : « en retard » dès qu'on a consommé la moitié
  // de la marge, parce qu'à ce stade le renouvellement à temps devient
  // improbable et qu'il faut le dire autrement.
  const lead = leadTimeFor(doc);
  return daysLeft <= Math.floor(lead / 2)
    ? (doc.renewalStartedAt ? "expiring" : "renewal_late")
    : "renewal_due";
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  valid: "À jour",
  renewal_due: "À renouveler",
  renewal_late: "Renouvellement en retard",
  in_progress: "Renouvellement engagé",
  expiring: "Expire bientôt",
  expired: "Périmé",
  perpetual: "Sans échéance",
};

export const STATUS_TONE: Record<DocumentStatus, "pos" | "warn" | "neg" | "info" | "mute"> = {
  valid: "pos",
  renewal_due: "warn",
  renewal_late: "neg",
  in_progress: "info",
  expiring: "warn",
  expired: "neg",
  perpetual: "mute",
};

export interface DocumentAlert {
  documentId: string;
  label: string;
  type: DocumentType;
  status: DocumentStatus;
  level: "critical" | "warning" | "info";
  daysLeft: number | null;
  /** Jours avant la date de lancement. Négatif = on est déjà en retard. */
  daysUntilStart: number | null;
  message: string;
}

/**
 * Message d'alerte.
 *
 * Il dit **quoi faire et quand**, pas seulement ce qui ne va pas. « Expire
 * dans 20 jours » laisse le lecteur calculer s'il a le temps ; « commencez
 * aujourd'hui, comptez 21 jours d'instruction » lui donne la décision.
 */
export function buildAlerts(
  documents: Array<AdminDocumentLike & { _id: unknown }>,
  asOf: Date = new Date()
): DocumentAlert[] {
  const alerts: DocumentAlert[] = [];

  for (const doc of documents) {
    const status = statusOf(doc, asOf);
    if (status === "valid" || status === "perpetual") continue;

    const spec = DOCUMENT_TYPES[doc.type];
    const daysLeft = doc.expiresAt ? daysBetween(asOf, doc.expiresAt) : null;
    const start = renewalStartDate(doc);
    const daysUntilStart = start ? daysBetween(asOf, start) : null;
    const lead = leadTimeFor(doc);

    let level: DocumentAlert["level"] = "warning";
    let message: string;

    switch (status) {
      case "expired":
        level = "critical";
        message = `Périmé depuis ${Math.abs(daysLeft ?? 0)} jour(s).`
          + (spec?.blocking ? " Ce document conditionne votre activité : régularisez sans délai." : "");
        break;

      case "renewal_late":
        level = "critical";
        message = `Il reste ${daysLeft} jour(s) pour un renouvellement qui en demande `
          + `${lead}. La démarche aurait dû commencer il y a ${Math.abs(daysUntilStart ?? 0)} jour(s).`;
        break;

      case "renewal_due":
        level = spec?.blocking ? "critical" : "warning";
        message = daysUntilStart === 0
          ? `À lancer aujourd'hui : ${lead} jours d'instruction pour une échéance dans ${daysLeft} jours.`
          : `À lancer maintenant : ${lead} jours d'instruction pour une échéance dans ${daysLeft} jours.`;
        break;

      case "expiring":
        level = "warning";
        message = `Renouvellement engagé, mais l'échéance est dans ${daysLeft} jour(s). `
          + `Relancez l'administration.`;
        break;

      case "in_progress":
        level = "info";
        message = `Renouvellement engagé. Échéance dans ${daysLeft} jour(s).`;
        break;

      default:
        message = STATUS_LABEL[status];
    }

    alerts.push({
      documentId: String(doc._id),
      label: doc.label,
      type: doc.type,
      status,
      level,
      daysLeft,
      daysUntilStart,
      message,
    });
  }

  // Le plus urgent en tête, puis le plus proche de l'échéance. Un tableau
  // trié par nom de document oblige à tout lire pour trouver l'urgence.
  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) =>
    order[a.level] - order[b.level] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)
  );
}

/** Échéance calculée à partir de la date de délivrance et de la nature. */
export function suggestedExpiry(type: DocumentType, issuedAt: Date | string): Date | null {
  const validity = DOCUMENT_TYPES[type]?.validityDays;
  if (!validity) return null;
  return new Date(startOfDay(issuedAt).getTime() + validity * DAY);
}

export interface DocumentSummary {
  total: number;
  valid: number;
  toRenew: number;
  late: number;
  expired: number;
  /** Le plus urgent, pour la phrase de synthèse. */
  mostUrgent: DocumentAlert | null;
}

export function summarize(
  documents: Array<AdminDocumentLike & { _id: unknown }>,
  asOf: Date = new Date()
): DocumentSummary {
  const alerts = buildAlerts(documents, asOf);
  const counts = documents.reduce(
    (acc, doc) => {
      const status = statusOf(doc, asOf);
      if (status === "valid" || status === "perpetual") acc.valid++;
      else if (status === "expired") acc.expired++;
      else if (status === "renewal_late") acc.late++;
      else acc.toRenew++;
      return acc;
    },
    { valid: 0, toRenew: 0, late: 0, expired: 0 }
  );

  return { total: documents.length, ...counts, mostUrgent: alerts[0] ?? null };
}
