/**
 * Acomptes sur marché. Compte d'avances clients du plan par défaut (SYSCOHADA
 * 419) : une facture d'acompte le crédite, la facture qui le déduit le débite.
 * Sans dépendance : partagé par l'écriture de vente et celle de l'avoir.
 */
export const DEPOSIT_ACCOUNT = { accountCode: "419000", accountLabel: "Clients créditeurs, avances reçues" };
