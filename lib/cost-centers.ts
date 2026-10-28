/**
 * Services (centres de coût) — sans dépendance serveur, utilisable à l'écran.
 *
 * Liste PAR DÉFAUT, proposée aux organisations qui n'ont pas défini la leur
 * (Réglages → Services) : elle reprenait l'organigramme de NUMATECH (« The
 * Spot », « Production & Cartes ») pour tous les clients.
 */
export const COST_CENTERS = {
  direction: "Direction",
  admin: "Administration",
  comm: "Commercial & communication",
  prod: "Production",
  compta: "Comptabilité & finances",
} as const;
export type CostCenter = string;
/** Forme d'un code de service (validé ensuite contre la liste de l'organisation). */
export const isCostCenterCode = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_-]{1,20}$/i.test(v);
/** Code de la liste par défaut. */
export const isCostCenter = (v: unknown): v is CostCenter => typeof v === "string" && v in COST_CENTERS;
