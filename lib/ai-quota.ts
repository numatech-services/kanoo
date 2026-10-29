/**
 * Quota mensuel de l'assistant IA — un plafond par organisation.
 *
 * Une génération IA a un coût réel chez le fournisseur. Le quota borne la
 * dépense d'une organisation sur un mois, et réinitialise automatiquement au
 * changement de mois. La réservation est **atomique** : un seul aller-retour
 * MongoDB incrémente le compteur uniquement s'il reste sous le plafond, ce qui
 * empêche deux requêtes simultanées de dépasser le quota. On réserve AVANT
 * d'appeler l'IA, et on rembourse si l'appel échoue.
 */
import { TenantModel } from "@/models/Tenant";
import { Types } from "mongoose";

/** Plafond global par défaut, surchargé par organisation via `aiUsage.monthlyQuota`. */
export const AI_MONTHLY_QUOTA = Math.max(0, Number(process.env.AI_MONTHLY_QUOTA || "50"));

/** Mois courant au format « AAAA-MM » (UTC, pour rester stable au fuseau). */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface QuotaState {
  month: string;
  used: number;
  quota: number;
  remaining: number;
}

/** Plafond par défaut d'une organisation qui paie avec sa propre clé (lib/ai-client). */
export const OWN_KEY_DEFAULT_QUOTA = 500;

type QuotaFields = { aiUsage?: { monthlyQuota?: number | null }; ai?: { keyHint?: string; monthlyQuota?: number | null } };

/**
 * Plafond effectif d'une organisation. Avec sa propre clé : celui qu'elle a
 * fixé (sa dépense, son choix). Sinon : surcharge de la plateforme, ou global.
 */
export function effectiveQuota(t: QuotaFields | null | undefined): number {
  const valid = (q: unknown): q is number => typeof q === "number" && Number.isFinite(q) && q >= 0;
  if (t?.ai?.keyHint) return valid(t.ai.monthlyQuota) ? Math.floor(t.ai.monthlyQuota) : OWN_KEY_DEFAULT_QUOTA;
  const override = t?.aiUsage?.monthlyQuota;
  return valid(override) ? Math.floor(override) : AI_MONTHLY_QUOTA;
}

/**
 * Réserve un crédit IA pour l'organisation. Renvoie `{ ok: true, state }` si un
 * crédit a pu être décompté, `{ ok: false, state }` si le quota du mois est
 * épuisé. La réservation et l'éventuelle remise à zéro mensuelle sont faites en
 * une seule opération atomique.
 */
export async function reserveAiCredit(
  tenantId: string
): Promise<{ ok: boolean; state: QuotaState }> {
  const _id = new Types.ObjectId(tenantId);
  const month = currentMonth();

  // Plafond propre à l'organisation (rare), sinon global. Lu d'abord pour
  // borner la condition d'incrément ; la course éventuelle est tranchée par
  // l'update conditionnel ci-dessous, pas par cette lecture.
  const current = await TenantModel.findById(_id).select("aiUsage ai.keyHint ai.monthlyQuota").lean<QuotaFields | null>();
  const quota = effectiveQuota(current);

  if (quota <= 0) {
    return { ok: false, state: { month, used: 0, quota, remaining: 0 } };
  }

  // Incrément conditionnel atomique :
  //  - mois différent (ou jamais renseigné) → on repart de 1 ;
  //  - même mois et compteur < quota → on incrémente ;
  //  - même mois et compteur au plafond → aucun document ne matche → refus.
  const updated = await TenantModel.findOneAndUpdate(
    {
      _id,
      $or: [
        { "aiUsage.month": { $ne: month } },
        { "aiUsage.count": { $lt: quota } },
      ],
    },
    [
      {
        $set: {
          "aiUsage.month": month,
          "aiUsage.count": {
            $cond: [
              { $eq: ["$aiUsage.month", month] },
              { $add: [{ $ifNull: ["$aiUsage.count", 0] }, 1] },
              1,
            ],
          },
        },
      },
    ],
    { new: true, projection: { aiUsage: 1 } }
  ).lean<{ aiUsage?: { month?: string; count?: number } } | null>();

  if (!updated) {
    // Le document existe (réservation faite plus haut) mais la condition n'a
    // pas matché : quota du mois épuisé.
    return { ok: false, state: { month, used: quota, quota, remaining: 0 } };
  }

  const used = updated.aiUsage?.count ?? 0;
  return { ok: true, state: { month, used, quota, remaining: Math.max(0, quota - used) } };
}

/**
 * Rembourse un crédit réservé mais non consommé (échec de l'appel IA). Ne
 * rembourse que si le mois n'a pas changé entre-temps, et jamais sous zéro.
 */
export async function refundAiCredit(tenantId: string, month: string): Promise<void> {
  await TenantModel.updateOne(
    { _id: new Types.ObjectId(tenantId), "aiUsage.month": month, "aiUsage.count": { $gt: 0 } },
    { $inc: { "aiUsage.count": -1 } }
  );
}

/** État du quota sans rien réserver (pour l'affichage). */
export async function readAiQuota(tenantId: string): Promise<QuotaState> {
  const month = currentMonth();
  const current = await TenantModel.findById(new Types.ObjectId(tenantId)).select("aiUsage ai.keyHint ai.monthlyQuota").lean<QuotaFields & {
    aiUsage?: { month?: string; count?: number };
  } | null>();
  const quota = effectiveQuota(current);
  // Un compteur d'un mois révolu vaut zéro tant qu'aucune réservation ne l'a remis à jour.
  const used = current?.aiUsage?.month === month ? current?.aiUsage?.count ?? 0 : 0;
  return { month, used, quota, remaining: Math.max(0, quota - used) };
}
