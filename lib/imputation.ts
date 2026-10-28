import { Types } from "mongoose";
import { ProjectModel } from "@/models/Project";
import { ActivityModel } from "@/models/Activity";

/**
 * Imputation analytique : à quoi une dépense (ou une recette) se rattache.
 *
 *  - projet      → coût réel et marge du projet ;
 *  - secteur     → rentabilité par activité (communication, développement,
 *                  vente de matériel, appels d'offres, The Spot, production,
 *                  cartes ISIC / Easypay…) ;
 *  - service     → centre de coût interne (qui a engagé la dépense).
 *
 * Les trois sont facultatives et indépendantes. Elles voyagent jusqu'aux
 * lignes d'écriture comptable : c'est là que se calculent coûts et marges.
 */
export { COST_CENTERS, isCostCenter, type CostCenter } from "@/lib/cost-centers";
import { isCostCenterCode, type CostCenter } from "@/lib/cost-centers";
import { tenantCostCenters } from "@/lib/cost-centers-server";

export interface Imputation {
  projectId?: Types.ObjectId;
  activityId?: Types.ObjectId;
  costCenter?: CostCenter;
}

type Raw = { projectId?: unknown; activityId?: unknown; costCenter?: unknown };

/** Forme brute d'une imputation (sans contrôle d'appartenance) — pour recopier. */
export function pickImputation(src: Raw | null | undefined): Imputation {
  const out: Imputation = {};
  if (!src) return out;
  if (src.projectId && Types.ObjectId.isValid(String(src.projectId))) out.projectId = new Types.ObjectId(String(src.projectId));
  if (src.activityId && Types.ObjectId.isValid(String(src.activityId))) out.activityId = new Types.ObjectId(String(src.activityId));
  if (isCostCenterCode(src.costCenter)) out.costCenter = src.costCenter;
  return out;
}

/**
 * Valide une ou plusieurs imputations : projet et secteur doivent appartenir à
 * l'organisation. Renvoie un message d'erreur, ou null.
 */
export async function checkImputations(tenantId: string, items: Raw[]): Promise<string | null> {
  const projects = new Set<string>(), activities = new Set<string>();
  // Services de l'ORGANISATION (sa liste, ou la liste par défaut).
  const centers = items.some(i => i.costCenter) ? new Set((await tenantCostCenters(tenantId)).map(c => c.value)) : new Set<string>();
  for (const it of items) {
    if (it.projectId) {
      if (!Types.ObjectId.isValid(String(it.projectId))) return "Projet d'imputation invalide.";
      projects.add(String(it.projectId));
    }
    if (it.activityId) {
      if (!Types.ObjectId.isValid(String(it.activityId))) return "Secteur d'activité invalide.";
      activities.add(String(it.activityId));
    }
    if (it.costCenter && !centers.has(String(it.costCenter))) return "Service d'imputation inconnu.";
  }
  const [np, na] = await Promise.all([
    projects.size ? ProjectModel.countDocuments({ tenantId, _id: { $in: [...projects] } }) : 0,
    activities.size ? ActivityModel.countDocuments({ tenantId, _id: { $in: [...activities] } }) : 0,
  ]);
  if (np !== projects.size) return "Projet d'imputation introuvable.";
  if (na !== activities.size) return "Secteur d'activité introuvable.";
  return null;
}
