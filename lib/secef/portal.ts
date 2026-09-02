import type {
  SecefDriver, SecefIdentity, SecefInvoicePayload, SecefResult, SecefCertification,
} from "./types";

/**
 * Pilote « portail e-SECeF » — le seul qui fonctionne sans agrément.
 *
 * Marche à suivre : l'opérateur émet la facture sur le portail gratuit de la
 * DGI (sygmef.impots.gouv.ne), puis reporte dans Kanoo le code SECeF/DGI et le
 * contenu du QR code obtenus. Kanoo conserve l'appariement, l'affiche sur la
 * facture et l'archive.
 *
 * Ce n'est pas de l'automatisation : c'est la double saisie que l'organisation
 * fait déjà aujourd'hui, rendue traçable. Elle reste utilisable quel que soit
 * l'état de la procédure d'agrément, et sert de filet quand le MCF est
 * indisponible.
 */
export class PortalSecefDriver implements SecefDriver {
  readonly name = "portal";
  readonly label = "Portail e-SECeF (saisie manuelle)";
  readonly automatic = false;

  /** Toujours disponible : il ne dépend d'aucun secret ni d'aucun réseau. */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Ce pilote ne certifie pas : il ne peut que constater. La certification
   * passe par `record()`, appelé quand l'opérateur saisit les codes.
   */
  async certify(): Promise<SecefResult> {
    return {
      ok: false,
      retryable: false,
      error:
        "Le mode portail ne certifie pas automatiquement. Émettez la facture sur "
        + "e-SECeF, puis reportez le code SECeF/DGI et le QR code obtenus.",
    };
  }

  /**
   * Enregistre une certification obtenue sur le portail.
   *
   * Les contrôles portent sur la forme, jamais sur la validité : seule la DGI
   * peut dire qu'un code est authentique. Kanoo se borne à refuser une saisie
   * manifestement incomplète, pour éviter d'archiver une facture qui se croit
   * certifiée et ne l'est pas.
   */
  record(input: {
    code: string;
    qrPayload: string;
    certifiedAt?: Date;
    mcfId?: string;
    counters?: string;
  }): SecefResult {
    const code = input.code?.trim();
    const qrPayload = input.qrPayload?.trim();

    if (!code) {
      return { ok: false, retryable: false, error: "Le code SECeF/DGI est obligatoire." };
    }
    if (!qrPayload) {
      return {
        ok: false, retryable: false,
        error: "Le contenu du QR code est obligatoire : c'est lui qui permet la vérification.",
      };
    }

    const certifiedAt = input.certifiedAt ?? new Date();
    if (Number.isNaN(certifiedAt.getTime())) {
      return { ok: false, retryable: false, error: "Date de certification invalide." };
    }
    if (certifiedAt.getTime() > Date.now() + 60_000) {
      return { ok: false, retryable: false, error: "La date de certification est dans le futur." };
    }

    const certification: SecefCertification = {
      code,
      qrPayload,
      certifiedAt,
      mcfId: input.mcfId?.trim() || undefined,
      counters: input.counters?.trim() || undefined,
      driver: this.name,
    };
    return { ok: true, certification };
  }

  /**
   * L'annulation passe par une facture d'avoir émise sur le portail : une
   * facture certifiée ne se supprime pas.
   */
  async cancel(): Promise<SecefResult> {
    return {
      ok: false,
      retryable: false,
      error:
        "Une facture certifiée ne s'annule pas : émettez une facture d'avoir (FA) "
        + "sur e-SECeF en référençant le code d'origine, puis enregistrez-la ici.",
    };
  }
}

/** Instance partagée — le pilote est sans état. */
export const portalDriver = new PortalSecefDriver();

/** Adresse du portail, affichée dans l'interface pour éviter les faux sites. */
export const ESECEF_PORTAL_URL = "https://sygmef.impots.gouv.ne";
