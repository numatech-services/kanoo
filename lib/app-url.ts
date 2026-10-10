/**
 * Adresse publique de l'application, pour les liens envoyés par courriel
 * (réinitialisation, activation). Jamais déduite de l'en-tête Host de la
 * requête : un attaquant pourrait faire partir chez la victime un lien vers
 * son propre domaine et y capter le jeton.
 */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return url.replace(/\/+$/, "");
}
