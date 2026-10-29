import { Types } from "mongoose";
import { UserModel } from "@/models/User";

/**
 * Dates clés d'un appel d'offres (en plus de la date limite de dépôt) et
 * responsable du dossier : saisies sur la fiche, elles alimentent les rappels
 * de la semaine, l'onglet Calendrier et l'agenda.
 */
export const KEY_DATES = ["questionsDeadline", "siteVisitDate", "openingDate"] as const;

export function parseKeyDates(body: Record<string, unknown>): { dates: Record<string, Date | null> } | { error: string } {
  const dates: Record<string, Date | null> = {};
  for (const k of KEY_DATES) {
    if (!(k in body)) continue;
    if (!body[k]) { dates[k] = null; continue; }
    const d = new Date(String(body[k]));
    if (isNaN(d.getTime())) return { error: "Date invalide." };
    dates[k] = d;
  }
  return { dates };
}

/** Responsable : un utilisateur actif de l'organisation. `null` : aucun ; `false` : refusé. */
export async function checkOwner(tenantId: string, raw: unknown): Promise<Types.ObjectId | null | false> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!Types.ObjectId.isValid(String(raw))) return false;
  const ok = await UserModel.exists({ _id: raw, tenantId, isActive: { $ne: false } });
  return ok ? new Types.ObjectId(String(raw)) : false;
}
