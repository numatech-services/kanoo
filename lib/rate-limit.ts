import { connectDB } from "@/lib/db";
import { RateLimitBucketModel } from "@/models/RateLimitBucket";

/**
 * Limitation de débit à fenêtre fixe.
 *
 * Deux implémentations, même contrat :
 *  • `consumeRateLimit` / `clearRateLimit` (celles qu'emploient les routes) :
 *    compteur en base (RateLimitBucket), partagé entre toutes les instances
 *    et conservé à travers les redémarrages — un redéploiement ou un second
 *    processus ne remet plus le compteur d'un attaquant à zéro ;
 *  • `rateLimit` / `resetRateLimit` : la même chose en mémoire du processus,
 *    utilisée en secours si la base ne répond pas (une panne de base ne doit
 *    pas ouvrir les vannes : on limite quand même, localement).
 * Toute route sensible verrouille en plus le compte visé (connexion).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

/** Une table par usage, pour qu'une limite n'épuise pas le quota d'une autre. */
const buckets = new Map<string, Map<string, Bucket>>();

/** Purge paresseuse : les fenêtres expirées sont retirées au fil des appels. */
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [scope, table] of buckets) {
    for (const [key, bucket] of table) {
      if (now > bucket.resetAt) table.delete(key);
    }
    if (table.size === 0) buckets.delete(scope);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Secondes avant la réouverture de la fenêtre — pour l'en-tête Retry-After. */
  retryAfter: number;
}

/**
 * Consomme une unité de quota.
 *
 * @param scope  Famille de limite ("login", "portal-auth", …)
 * @param key    Identité limitée (IP, email, couple des deux)
 * @param max    Nombre d'appels autorisés dans la fenêtre
 * @param windowMs Durée de la fenêtre
 */
export function rateLimit(scope: string, key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let table = buckets.get(scope);
  if (!table) {
    table = new Map();
    buckets.set(scope, table);
  }

  const bucket = table.get(key);
  if (!bucket || now > bucket.resetAt) {
    table.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfter: 0 };
  }

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true, remaining: max - bucket.count, retryAfter: 0 };
}

/** Efface le quota d'une clé — à appeler après une authentification réussie. */
export function resetRateLimit(scope: string, key: string): void {
  buckets.get(scope)?.delete(key);
}

/**
 * Consomme une unité de quota, dans le compteur partagé en base.
 *
 * Une seule mise à jour atomique (pipeline) : ouvre une nouvelle fenêtre si
 * la précédente est échue, sinon incrémente. Deux requêtes simultanées ne
 * peuvent pas lire le même compte.
 */
export async function consumeRateLimit(scope: string, key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date();
  const fresh = new Date(now.getTime() + windowMs);
  try {
    await connectDB();
    const expired = { $or: [{ $eq: [{ $type: "$resetAt" }, "missing"] }, { $lte: ["$resetAt", now] }] };
    const doc = await RateLimitBucketModel.findOneAndUpdate(
      { _id: `${scope}:${key}` },
      [{ $set: {
        count: { $cond: [expired, 1, { $add: ["$count", 1] }] },
        resetAt: { $cond: [expired, fresh, "$resetAt"] },
        expireAt: { $cond: [expired, fresh, "$resetAt"] },
      } }],
      { upsert: true, new: true, lean: true },
    ) as { count: number; resetAt: Date } | null;
    if (!doc) throw new Error("compteur introuvable");
    const retryAfter = Math.max(1, Math.ceil((new Date(doc.resetAt).getTime() - now.getTime()) / 1000));
    return doc.count > max
      ? { allowed: false, remaining: 0, retryAfter }
      : { allowed: true, remaining: max - doc.count, retryAfter: 0 };
  } catch (err) {
    console.error("[rate-limit] compteur partagé indisponible, repli en mémoire :", err instanceof Error ? err.message : err);
    return rateLimit(scope, key, max, windowMs);
  }
}

/** Efface le quota d'une clé (après une authentification réussie). */
export async function clearRateLimit(scope: string, key: string): Promise<void> {
  resetRateLimit(scope, key);
  try {
    await connectDB();
    await RateLimitBucketModel.deleteOne({ _id: `${scope}:${key}` });
  } catch { /* le compteur expirera de lui-même */ }
}

/**
 * Adresse de l'appelant. `x-forwarded-for` n'est fiable que si le reverse proxy
 * la réécrit ; la configuration nginx fournie le fait (voir deploy/nginx.conf).
 * On ne retient que le premier maillon, le reste étant sous contrôle du client.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
