/**
 * Certification des factures — SECeF (Niger).
 *
 * ── Le système, en trois pièces ──────────────────────────────────────────────
 *  • **SFE** — Système de Facturation d'Entreprise : le logiciel qui émet la
 *    facture. C'est le rôle que tient Kanoo. Il doit être soumis à la DGI, qui
 *    délivre un certificat de conformité et un identifiant **ISF**.
 *  • **MCF** — Module de Contrôle de Facturation : le composant qui certifie.
 *    Physique (boîtier) ou en ligne (**e-MCF**).
 *  • **UF** — Unité de Facturation : SFE et MCF réunis dans une même machine.
 *
 * Une facture certifiée porte un **code SECeF/DGI**, un **QR code** et une
 * signature électronique. L'obligation vaut depuis le 1er septembre 2021 pour
 * les assujettis à la TVA, avec conservation dix ans.
 *
 * ── Pourquoi une interface plutôt qu'une implémentation ──────────────────────
 * Les spécifications techniques de l'API e-MCF ne sont pas publiées : elles
 * sont remises à l'éditeur pendant la procédure d'agrément. Écrire des URL et
 * des schémas de charge utile inventés donnerait un module qui compile, qui se
 * teste, et qui ne marchera pas le jour de l'agrément — le pire des trois états.
 *
 * Cette couche définit donc ce dont **Kanoo** a besoin, indépendamment du
 * transport, sur le modèle de `lib/paydunya.ts` : une interface, des pilotes
 * interchangeables, et un pilote « portail » qui fonctionne dès aujourd'hui
 * sans agrément.
 */

/** Ce que l'organisation déclare une fois pour toutes dans ses paramètres. */
export interface SecefIdentity {
  /** NIF de l'assujetti. */
  nif: string;
  /** Identifiant du Système de Facturation, délivré par la DGI à l'agrément. */
  isf?: string;
  /** Identifiant du MCF rattaché, physique ou en ligne. */
  mcfId?: string;
}

export type SecefInvoiceType =
  /** Facture de vente ordinaire. */
  | "FV"
  /** Facture d'avoir — annulation ou remise après coup. */
  | "FA";

export interface SecefLine {
  description: string;
  quantity: number;
  /** Prix unitaire HT, en francs entiers. */
  unitPrice: number;
  /** Taux de TVA appliqué à la ligne (0, 0.10 ou 0.19). */
  tvaRate: number;
  totalHT: number;
  totalTVA: number;
}

/** La facture telle que Kanoo la présente à la certification. */
export interface SecefInvoicePayload {
  type: SecefInvoiceType;
  /** Numéro interne Kanoo. Le code de certification, lui, vient du MCF. */
  number: string;
  issueDate: Date;
  client: {
    name: string;
    /** NIF du client — obligatoire entre assujettis. */
    nif?: string;
    address?: string;
  };
  lines: SecefLine[];
  totalHT: number;
  totalTVA: number;
  /** Droits de timbre, le cas échéant. */
  totalDTS: number;
  totalTTC: number;
  /** Facture d'origine, pour un avoir. */
  referencedInvoiceCode?: string;
}

/** Ce que le MCF renvoie, et que la facture doit porter. */
export interface SecefCertification {
  /** Code SECeF/DGI apposé sur la facture. */
  code: string;
  /** Contenu à encoder dans le QR code, tel que fourni par le MCF. */
  qrPayload: string;
  /** Horodatage de certification, côté MCF. */
  certifiedAt: Date;
  /** Compteurs du MCF, quand il les expose. */
  counters?: string;
  /** Signature électronique, quand le pilote la restitue. */
  signature?: string;
  /** Identifiant du MCF ayant certifié. */
  mcfId?: string;
  /** Pilote ayant produit la certification, pour la traçabilité. */
  driver: string;
}

export type SecefResult =
  | { ok: true; certification: SecefCertification }
  | { ok: false; error: string; /** Vrai si un nouvel essai a un sens. */ retryable: boolean };

/**
 * Un pilote de certification. Même forme que `PaymentGateway` : ajouter un
 * fournisseur revient à ajouter un fichier, jamais à modifier les routes.
 */
export interface SecefDriver {
  /** Identifiant technique, stocké sur la facture certifiée. */
  readonly name: string;
  /** Libellé pour l'interface. */
  readonly label: string;
  /**
   * Vrai si le pilote peut certifier sans intervention humaine. Faux pour le
   * pilote « portail », où l'opérateur ressaisit les codes.
   */
  readonly automatic: boolean;

  /** Le pilote est-il configuré et utilisable ? */
  isConfigured(): boolean;

  /** Certifie une facture. */
  certify(payload: SecefInvoicePayload, identity: SecefIdentity): Promise<SecefResult>;

  /**
   * Annule une facture certifiée. La réglementation interdit de supprimer une
   * facture émise : on émet un avoir. Un pilote qui ne sait pas le faire doit
   * le dire, pas laisser croire à une annulation.
   */
  cancel?(code: string, reason: string): Promise<SecefResult>;
}

/** Mentions qu'une facture certifiée doit porter à l'impression. */
export const REQUIRED_INVOICE_MENTIONS = [
  "NIF du vendeur",
  "NIF de l'acheteur assujetti",
  "Code SECeF/DGI",
  "QR code de vérification",
  "Date et heure de certification",
  "Identifiant du MCF",
] as const;
