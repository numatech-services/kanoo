/**
 * Plan comptable SYSCOHADA révisé — comptes usuels d'une PME nigérienne.
 * Sert de plan par défaut (l'organisation l'enrichit) et de liste de choix
 * pour les dépenses. Codes à 6 chiffres, comme les écritures générées.
 */
export interface DefaultAccount { code: string; label: string }

export const SYSCOHADA_ACCOUNTS: DefaultAccount[] = [
  // Classe 1 — Capitaux
  { code: "101000", label: "Capital social" },
  { code: "111000", label: "Réserve légale" },
  { code: "121000", label: "Report à nouveau créditeur" },
  { code: "129000", label: "Report à nouveau débiteur" },
  { code: "131000", label: "Résultat net : bénéfice" },
  { code: "139000", label: "Résultat net : perte" },
  { code: "162000", label: "Emprunts auprès des établissements de crédit" },
  // Classe 2 — Immobilisations
  { code: "213000", label: "Logiciels et sites internet" },
  { code: "231000", label: "Bâtiments" },
  { code: "241000", label: "Matériel et outillage" },
  { code: "244000", label: "Matériel et mobilier de bureau" },
  { code: "244100", label: "Matériel informatique" },
  { code: "245000", label: "Matériel de transport" },
  { code: "281300", label: "Amortissements des logiciels" },
  { code: "284000", label: "Amortissements du matériel" },
  { code: "275000", label: "Dépôts et cautionnements versés" },
  // Classe 3 — Stocks
  { code: "311000", label: "Marchandises" },
  { code: "321000", label: "Matières premières" },
  { code: "335000", label: "Emballages" },
  // Classe 4 — Tiers
  { code: "401100", label: "Fournisseurs" },
  { code: "449200", label: "État — retenues à la source subies (acomptes d'impôt)" },
  { code: "401000", label: "Fournisseurs (général)" },
  { code: "408000", label: "Fournisseurs, factures non parvenues" },
  { code: "409000", label: "Fournisseurs débiteurs, avances versées" },
  { code: "411000", label: "Clients" },
  { code: "411700", label: "Clients, retenues de garantie" },
  { code: "416000", label: "Créances clients litigieuses ou douteuses" },
  { code: "491100", label: "Dépréciations des comptes clients" },
  { code: "419000", label: "Clients créditeurs, avances reçues" },
  { code: "421000", label: "Personnel, rémunérations dues" },
  { code: "422000", label: "Personnel, notes de frais à rembourser" },
  { code: "427000", label: "Personnel, oppositions et retenues" },
  { code: "431000", label: "CNSS, part salariale" },
  { code: "431100", label: "CNSS, part patronale" },
  { code: "441000", label: "État, impôt sur les bénéfices" },
  { code: "443000", label: "État, TVA facturée" },
  { code: "445200", label: "État, TVA récupérable sur achats" },
  { code: "445100", label: "État, TVA récupérable sur immobilisations" },
  { code: "447100", label: "État, IR retenu sur salaires" },
  { code: "447200", label: "État, retenues à la source" },
  { code: "447000", label: "État, autres impôts et taxes (ISB, DTS…)" },
  { code: "471000", label: "Débiteurs et créditeurs divers" },
  // Classe 5 — Trésorerie
  { code: "521000", label: "Banque" },
  { code: "521800", label: "Monnaie électronique (mobile money)" },
  { code: "571000", label: "Caisse" },
  { code: "585000", label: "Virements de fonds" },
  // Classe 6 — Charges
  { code: "601100", label: "Achats de marchandises" },
  { code: "602100", label: "Achats de matières premières" },
  { code: "603100", label: "Variations des stocks de marchandises" },
  { code: "604000", label: "Achats stockés de matières et fournitures consommables" },
  { code: "605100", label: "Eau" },
  { code: "605200", label: "Électricité" },
  { code: "605300", label: "Carburants et lubrifiants" },
  { code: "605400", label: "Fournitures d'entretien" },
  { code: "605500", label: "Fournitures de bureau" },
  { code: "605600", label: "Petit matériel et outillage" },
  { code: "608000", label: "Emballages et achats divers" },
  { code: "611000", label: "Transports sur achats" },
  { code: "614000", label: "Transports du personnel" },
  { code: "618000", label: "Autres frais de transport (déplacements, taxis)" },
  { code: "622100", label: "Locations de bâtiments (loyers)" },
  { code: "622400", label: "Locations de matériel" },
  { code: "624100", label: "Entretien et réparations des biens" },
  { code: "625000", label: "Primes d'assurance" },
  { code: "626000", label: "Études, recherches et documentation" },
  { code: "627000", label: "Publicité, publications, relations publiques" },
  { code: "628100", label: "Frais de téléphone" },
  { code: "628300", label: "Frais d'internet et d'hébergement" },
  { code: "631000", label: "Frais bancaires" },
  { code: "632400", label: "Honoraires" },
  { code: "632500", label: "Frais d'actes et de contentieux" },
  { code: "633000", label: "Frais de formation du personnel" },
  { code: "634000", label: "Redevances de logiciels et abonnements" },
  { code: "637000", label: "Rémunérations de personnel extérieur (intérim)" },
  { code: "638100", label: "Frais de recrutement" },
  { code: "638200", label: "Frais de réception et missions" },
  { code: "641000", label: "Impôts et taxes directs" },
  { code: "646000", label: "Droits d'enregistrement et timbres" },
  { code: "658000", label: "Charges diverses" },
  { code: "661000", label: "Rémunérations directes du personnel" },
  { code: "663800", label: "Indemnités de stage" },
  { code: "664000", label: "Charges sociales (CNSS patronale)" },
  { code: "668000", label: "Autres charges sociales" },
  { code: "671000", label: "Intérêts des emprunts" },
  { code: "651000", label: "Pertes sur créances clients" },
  { code: "659400", label: "Charges provisionnées sur créances (dotations)" },
  { code: "676000", label: "Pertes de change" },
  { code: "681000", label: "Dotations aux amortissements" },
  // Classe 7 — Produits
  { code: "701100", label: "Ventes de marchandises" },
  { code: "702000", label: "Ventes de produits finis (production)" },
  { code: "705000", label: "Travaux facturés" },
  { code: "706000", label: "Services vendus (prestations)" },
  { code: "706100", label: "Prestations de communication" },
  { code: "706200", label: "Développement logiciel" },
  { code: "706300", label: "Restauration (The Spot)" },
  { code: "706400", label: "Cartes ISIC / Easypay" },
  { code: "706500", label: "Billetterie et inscriptions" },
  { code: "707000", label: "Ventes de marchandises (négoce)" },
  { code: "754000", label: "Produits des cessions d'immobilisations" },
  { code: "756000", label: "Cotisations des membres" },
  { code: "758000", label: "Produits divers" },
  { code: "758100", label: "Dons et libéralités reçus" },
  { code: "759400", label: "Reprises de charges provisionnées sur créances" },
  { code: "771000", label: "Intérêts de prêts" },
  { code: "776000", label: "Gains de change" },
  // Classe 8 — Hors activités ordinaires
  { code: "812000", label: "Valeurs comptables des cessions d'immobilisations" },
  { code: "822000", label: "Produits des cessions d'immobilisations" },
];

export const ACCOUNT_CLASS_LABEL: Record<string, string> = {
  "1": "Capitaux", "2": "Immobilisations", "3": "Stocks", "4": "Tiers",
  "5": "Trésorerie", "6": "Charges", "7": "Produits", "8": "Autres charges et produits",
};

/** Comptes proposés pour une dépense : charges (6) et immobilisations (2). */
export const EXPENSE_ACCOUNTS = SYSCOHADA_ACCOUNTS.filter(a => /^[26]/.test(a.code) && !/^28/.test(a.code));

export function defaultAccountLabel(code: string): string | undefined {
  return SYSCOHADA_ACCOUNTS.find(a => a.code === code)?.label;
}
