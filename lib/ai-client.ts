/**
 * Claude de l'organisation — quelle clé, quel modèle, quel plafond.
 *
 * Chaque organisation peut brancher SA clé d'API Anthropic (réglages →
 * Assistant Claude) : la dépense part alors sur son compte, avec le modèle et
 * le plafond mensuel qu'elle choisit. Sans clé propre, la clé de la
 * plateforme (ANTHROPIC_API_KEY) sert, avec le plafond de la plateforme.
 *
 * La clé est chiffrée au repos (lib/crypto-field) et n'est jamais renvoyée :
 * seuls ses quatre derniers caractères s'affichent.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { TenantModel } from "@/models/Tenant";
import { decryptField } from "@/lib/crypto-field";

/** Modèles proposés dans les réglages (le premier est le défaut). */
export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — le plus capable (recommandé)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — rapide et économique" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — le plus rapide, tâches simples" },
] as const;
export const PLATFORM_MODEL = process.env.AI_MODEL || AI_MODELS[0].id;
export const isKnownModel = (m: unknown): m is string => AI_MODELS.some(x => x.id === m);

/** Forme attendue d'une clé Anthropic (contrôle de saisie, pas d'authenticité). */
export const API_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;
export const keyHint = (key: string) => `sk-ant-…${key.slice(-4)}`;

export interface TenantAi {
  client: Anthropic;
  model: string;
  /** « tenant » : clé de l'organisation ; « platform » : clé de la plateforme. */
  source: "tenant" | "platform";
}

// Un client par clé (empreinte), réutilisé entre requêtes.
const clients = new Map<string, Anthropic>();
function clientFor(apiKey?: string): Anthropic {
  const id = apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 16) : "platform";
  let c = clients.get(id);
  if (!c) {
    c = apiKey ? new Anthropic({ apiKey }) : new Anthropic(); // la seconde lit ANTHROPIC_API_KEY
    if (clients.size > 200) clients.clear();
    clients.set(id, c);
  }
  return c;
}

/** Client Claude de l'organisation, ou null si aucune clé (ni la sienne, ni celle de la plateforme). */
export async function tenantAi(tenantId: string): Promise<TenantAi | null> {
  const t = await TenantModel.findById(tenantId).select("+ai.apiKeyEnc ai.model")
    .lean<{ ai?: { apiKeyEnc?: string; model?: string } } | null>();
  if (t?.ai?.apiKeyEnc) {
    // Clé de l'organisation illisible (clé de chiffrement changée) : assistant
    // coupé, jamais de repli silencieux sur la clé de la plateforme.
    let key = "";
    try { key = decryptField(t.ai.apiKeyEnc); } catch { key = ""; }
    if (!key || !API_KEY_RE.test(key)) {
      console.error(`[ai] clé d'API illisible pour l'organisation ${tenantId} : à ressaisir`);
      return null;
    }
    return { client: clientFor(key), model: isKnownModel(t.ai.model) ? t.ai.model : PLATFORM_MODEL, source: "tenant" };
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return { client: clientFor(), model: PLATFORM_MODEL, source: "platform" };
}

/** Client pour une clé donnée (test d'une clé avant de l'enregistrer). */
export function clientForKey(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 });
}

/** Message clair pour une erreur de l'API (jamais le détail brut). */
export function aiErrorMessage(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return "Clé d'API refusée par Anthropic : vérifiez-la dans les réglages de l'assistant.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Cette clé n'a pas accès au modèle choisi.";
  if (err instanceof Anthropic.NotFoundError) return "Modèle introuvable pour cette clé : choisissez-en un autre dans les réglages.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de débit du compte Anthropic atteinte : réessayez dans une minute.";
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)) return "Claude est momentanément surchargé : réessayez dans un instant.";
  return null;
}
