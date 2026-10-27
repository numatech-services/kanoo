import { Types, type Model } from "mongoose";

/**
 * Vérifie que des références reçues d'un formulaire (client, utilisateurs,
 * factures…) appartiennent bien à l'organisation.
 *
 * Sans ce contrôle, un identifiant d'une autre organisation était accepté puis
 * « populé » à l'affichage : son nom, son code ou son NIF apparaissaient chez
 * un autre client de la plateforme.
 *
 * @returns un message d'erreur, ou null si tout est en ordre.
 */
export async function checkTenantRefs(
  tenantId: string | Types.ObjectId,
  refs: Array<{ model: Model<never> | Model<unknown>; ids: unknown; label: string }>,
): Promise<string | null> {
  const tid = new Types.ObjectId(String(tenantId));
  for (const { model, ids, label } of refs) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids])
      .filter(v => v !== undefined && v !== null && v !== "")
      .map(v => String(typeof v === "object" && v && "_id" in v ? (v as { _id: unknown })._id : v)))];
    if (list.length === 0) continue;
    if (list.some(id => !Types.ObjectId.isValid(id))) return `${label} invalide.`;
    const found = await (model as Model<unknown>).countDocuments({ _id: { $in: list.map(id => new Types.ObjectId(id)) }, tenantId: tid });
    if (found !== list.length) return `${label} introuvable dans votre organisation.`;
  }
  return null;
}

/** Valeurs d'un champ dans un tableau de sous-documents (tâches, membres…). */
export function pluck(items: unknown, key: string): unknown[] {
  return Array.isArray(items) ? items.map(i => (i && typeof i === "object" ? (i as Record<string, unknown>)[key] : undefined)) : [];
}
