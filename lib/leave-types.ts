/** Types de congé et acquisition (sans dépendance serveur : utilisable à l'écran). */
export const LEAVE_TYPES: Record<string, string> = {
  annual: "Congé annuel", sick: "Maladie", unpaid: "Sans solde", maternity: "Maternité", paternity: "Paternité",
  exceptional: "Permission exceptionnelle", training: "Formation", other: "Autre absence",
};
/** Acquisition légale : 2,5 jours ouvrables par mois de service effectif (30 jours / an). */
export const MONTHLY_ACCRUAL = 2.5;

