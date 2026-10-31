/** Natures de dépense de caisse des comptoirs (sans dépendance serveur : utilisable à l'écran). */
export const EXPENSE_CATEGORIES: Record<string, string> = {
  supply: "Achats de marchandises",
  ingredients: "Ingrédients et préparation",
  staff: "Personnel (primes, repas)",
  transport: "Transport et livraison",
  water: "Eau",
  electricity: "Électricité",
  gas: "Gaz, charbon, autres énergies",
  consumables: "Produits d'entretien, emballages",
  small_equipment: "Petit matériel, vaisselle",
  utilities: "Eau, électricité, gaz (ancien)",
  maintenance: "Entretien et réparations",
  rent: "Loyer",
  telecom: "Téléphone, internet, crédit",
  other: "Autres dépenses",
};

/**
 * Compte SYSCOHADA de chaque nature (comptes à confirmer par le comptable de
 * l'organisation). Achats de marchandises et ingrédients : le compte d'achats
 * du comptoir (601) ; au résultat de gestion, ceux payés en caisse sans
 * réception en réserve sont comptés comme consommés dans le mois.
 */
export const EXPENSE_ACCOUNTS: Record<string, { accountCode: string; accountLabel: string } | null> = {
  supply: null,
  ingredients: null,
  staff: { accountCode: "661200", accountLabel: "Primes et gratifications" },
  transport: { accountCode: "618000", accountLabel: "Autres frais de transport" },
  water: { accountCode: "605100", accountLabel: "Fournitures non stockables — eau" },
  electricity: { accountCode: "605200", accountLabel: "Fournitures non stockables — électricité" },
  gas: { accountCode: "605300", accountLabel: "Fournitures non stockables — autres énergies" },
  consumables: { accountCode: "605400", accountLabel: "Fournitures d'entretien non stockables" },
  small_equipment: { accountCode: "605600", accountLabel: "Achats de petit matériel et outillage" },
  utilities: { accountCode: "605300", accountLabel: "Fournitures non stockables — énergies" },
  maintenance: { accountCode: "624000", accountLabel: "Entretien, réparations et maintenance" },
  rent: { accountCode: "622000", accountLabel: "Locations et charges locatives" },
  telecom: { accountCode: "628000", accountLabel: "Frais de télécommunications" },
  // Charge sans autre nature : jamais en achats (601), elle sortirait du résultat de gestion.
  other: { accountCode: "658000", accountLabel: "Charges diverses" },
};
