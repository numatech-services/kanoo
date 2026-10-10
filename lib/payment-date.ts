import { BusinessRuleError } from "@/lib/errors";

/**
 * Date réelle d'un paiement (virement reçu, chèque encaissé, salaire versé) :
 * celle saisie, sinon aujourd'hui. Jamais dans le futur — un règlement qui n'a
 * pas eu lieu se note « en attente » —, jamais invalide.
 */
export function paymentDate(v: unknown): Date {
  if (v === undefined || v === null || v === "") return new Date();
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  if (isNaN(d.getTime())) throw new BusinessRuleError("Date de paiement invalide.");
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  if (d > endOfToday) throw new BusinessRuleError("La date de paiement ne peut pas être dans le futur : enregistrez-le « en attente ».");
  return d;
}
