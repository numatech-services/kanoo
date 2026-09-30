/** Services (centres de coût) — sans dépendance serveur, utilisable à l'écran. */
export const COST_CENTERS = {
  direction: "Direction (gérant)",
  admin: "Administration",
  comm: "Communication",
  prosp: "Prospection",
  dev: "Développement",
  prod: "Production & Cartes",
  spot: "The Spot",
  secu: "Sécurité",
  compta: "Comptabilité",
} as const;
export type CostCenter = keyof typeof COST_CENTERS;
export const isCostCenter = (v: unknown): v is CostCenter => typeof v === "string" && v in COST_CENTERS;

