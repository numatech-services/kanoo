/**
 * Fuseau de l'application : Africa/Niamey (UTC+1, sans heure d'été).
 *
 * Le code calcule « le jour » avec l'horloge locale du processus (journée de
 * caisse, arrêtés, mois de paie, échéances, promotions à heure fixe…). Un
 * hébergement en UTC décalait tout d'une heure : de minuit à 1 h, une vente
 * était refusée comme « caisse arrêtée », l'écart d'un arrêté du dernier jour
 * du mois tombait le mois suivant. Le fuseau est donc fixé au démarrage du
 * serveur (instrumentation.ts, next.config.mjs), sauf si l'hébergement en
 * impose un explicitement (variable TZ).
 */
export const APP_TIMEZONE = "Africa/Niamey";

/** Pose TZ si elle est absente ; rend le fuseau en vigueur. */
export function ensureProcessTimezone(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.TZ || !env.TZ.trim()) env.TZ = APP_TIMEZONE;
  return env.TZ;
}
