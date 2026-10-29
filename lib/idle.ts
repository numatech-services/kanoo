/**
 * Déconnexion pour inactivité : 15 minutes par défaut côté navigateur (avec un
 * avertissement une minute avant), 20 côté serveur (session glissante, un peu
 * au-dessus, filet si le minuteur du navigateur est contourné).
 *
 * C'était 2 et 4 minutes : passer sur WhatsApp ou l'appli de mobile money le
 * temps d'un paiement suffisait à perdre la session et la saisie en cours.
 * Les saisies longues gardent en plus un brouillon sur l'appareil
 * (lib/use-draft).
 */
export const DEFAULT_IDLE_MINUTES = 15;
export const DEFAULT_SESSION_IDLE_MINUTES = 20;

const minutes = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? n : d;
};

/** Côté navigateur (valeur inlinée à la compilation). */
export const IDLE_MINUTES = minutes(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES, DEFAULT_IDLE_MINUTES);

/** Côté serveur : fenêtre de la session glissante. */
export function sessionIdleMinutes(env: string | undefined = process.env.SESSION_IDLE_MINUTES) {
  return minutes(env, DEFAULT_SESSION_IDLE_MINUTES);
}
