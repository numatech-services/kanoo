import { Types } from "mongoose";
import { AutomationSettingsModel } from "@/models/AutomationSettings";
import { AutomationLogModel } from "@/models/AutomationLog";
import { normalizeAutomationSettings, type AutomationSettings } from "@/lib/automations";

/** Réglages d'une organisation, valeurs par défaut comprises (document absent = défauts). */
export async function loadAutomationSettings(tenantId: unknown): Promise<AutomationSettings> {
  const doc = await AutomationSettingsModel.findOne({ tenantId }).lean<Record<string, unknown> | null>();
  return normalizeAutomationSettings(doc ? JSON.parse(JSON.stringify(doc)) : {});
}

/** Pour la sauvegarde de la plateforme, qui n'appartient à aucune organisation. */
export const PLATFORM_TENANT = new Types.ObjectId("000000000000000000000000");

function isDuplicate(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/**
 * Inscrit un fait signalé une fois pour toutes (seuil budgétaire franchi,
 * dossier du mois envoyé…). `true` si c'est la première fois — l'appelant
 * envoie alors ; `false` s'il était déjà inscrit.
 *
 * Insertion conditionnelle ($setOnInsert) : correcte même si l'index unique
 * n'est pas (encore) créé ; l'index, lui, ferme la course entre deux
 * exécutions simultanées.
 */
export async function claimOnce(tenantId: unknown, key: string, note?: string): Promise<boolean> {
  try {
    const r = await AutomationLogModel.updateOne(
      { tenantId, key },
      { $setOnInsert: { tenantId, key, at: new Date(), ...(note ? { note } : {}) } },
      { upsert: true },
    );
    return r.upsertedCount === 1;
  } catch (err) {
    if (isDuplicate(err)) return false;
    throw err;
  }
}

/**
 * Comme claimOnce, mais renouvelable : `true` si le fait n'a jamais été
 * signalé ou l'a été il y a plus de `intervalMs` (relance tous les N jours).
 */
export async function claimEvery(tenantId: unknown, key: string, intervalMs: number, now = new Date()): Promise<boolean> {
  const renewed = await AutomationLogModel.updateOne(
    { tenantId, key, at: { $lt: new Date(now.getTime() - intervalMs) } },
    { $set: { at: now } },
  );
  if (renewed.modifiedCount === 1) return true;
  return claimOnce(tenantId, key);
}

/** Annule une inscription (l'envoi a échoué : on retentera au prochain passage). */
export async function releaseClaim(tenantId: unknown, key: string): Promise<void> {
  await AutomationLogModel.deleteOne({ tenantId, key }).catch(() => undefined);
}
