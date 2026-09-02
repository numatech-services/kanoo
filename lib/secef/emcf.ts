import type {
  SecefDriver, SecefIdentity, SecefInvoicePayload, SecefResult,
} from "./types";

/**
 * Pilote e-MCF — certification automatique par appel à la plateforme DGI.
 *
 * ⚠ **Ce pilote est délibérément incomplet.**
 *
 * Les spécifications techniques de l'API e-MCF (URL, authentification, schéma
 * de la charge utile, codes d'erreur) ne sont pas publiées : elles sont remises
 * à l'éditeur pendant la procédure d'agrément auprès de la DGI. Inventer une
 * URL et un format aurait produit un module qui compile, qui passe des tests
 * écrits contre l'invention, et qui ne fonctionne pas le jour de l'agrément —
 * en donnant entre-temps l'illusion que l'intégration est faite.
 *
 * Ce fichier fixe donc tout ce qui ne dépend pas de la DGI : la place du pilote
 * dans l'application, la configuration, la gestion des erreurs, la distinction
 * entre échec réessayable et refus définitif. Il ne reste qu'à écrire
 * `callEmcf()` une fois la documentation reçue — un seul endroit, isolé.
 *
 * Ce qu'il faut obtenir de la DGI :
 *   1. le certificat de conformité du SFE et l'identifiant ISF ;
 *   2. la spécification de l'API e-MCF et le jeton d'accès ;
 *   3. un environnement de test avant bascule en production.
 *
 * Voir docs/SECEF.md pour la marche à suivre.
 */
export class EmcfSecefDriver implements SecefDriver {
  readonly name = "emcf";
  readonly label = "e-MCF (API DGI)";
  readonly automatic = true;

  private get baseUrl(): string | undefined {
    return process.env.SECEF_EMCF_BASE_URL;
  }
  private get token(): string | undefined {
    return process.env.SECEF_EMCF_TOKEN;
  }

  /**
   * Le pilote n'est utilisable que si l'adresse ET le jeton sont fournis —
   * tous deux issus de l'agrément. Sans eux, l'application bascule sur le
   * pilote portail plutôt que d'échouer à l'émission.
   */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async certify(payload: SecefInvoicePayload, identity: SecefIdentity): Promise<SecefResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        retryable: false,
        error:
          "Le pilote e-MCF n'est pas configuré. Renseignez SECEF_EMCF_BASE_URL et "
          + "SECEF_EMCF_TOKEN une fois l'agrément DGI obtenu, ou utilisez le mode portail.",
      };
    }
    if (!identity.isf) {
      return {
        ok: false,
        retryable: false,
        error: "Identifiant ISF absent : il est délivré avec le certificat de conformité du SFE.",
      };
    }

    // ── À écrire à réception des spécifications DGI ──────────────────────
    // La forme attendue est celle de `SecefResult` : à la réponse du MCF,
    // remplir `code`, `qrPayload`, `certifiedAt`, `counters` et `signature`.
    // Consigne pour l'implémentation : un incident réseau ou un 5xx est
    // `retryable: true` (la file hors ligne rejouera) ; un refus de conformité
    // est `retryable: false` (rejouer ne changera rien).
    return {
      ok: false,
      retryable: false,
      error:
        "Intégration e-MCF non implémentée : les spécifications de l'API sont "
        + "remises par la DGI lors de l'agrément du SFE. Voir docs/SECEF.md.",
    };
  }

  async cancel(code: string, reason: string): Promise<SecefResult> {
    return {
      ok: false,
      retryable: false,
      error:
        "Annulation e-MCF non implémentée. Réglementairement, l'annulation passe "
        + `par une facture d'avoir référençant ${code} (motif : ${reason}).`,
    };
  }
}

export const emcfDriver = new EmcfSecefDriver();
