/**
 * Limitation de débit à fenêtre glissante, en mémoire du processus.
 *
 * LIMITE CONNUE — cet état vit dans le processus Node : avec plusieurs
 * instances PM2 ou plusieurs conteneurs, chaque instance compte séparément et
 * le plafond effectif est multiplié par le nombre d'instances. Tant qu'il n'y a
 * pas de Redis dans la pile, c'est un garde-fou contre le bruteforce naïf, pas
 * une garantie. Toute route sensible doit en plus verrouiller le compte visé
 * (voir `consumeAttempt` dans les routes de connexion).
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
 * Adresse de l'appelant. `x-forwarded-for` n'est fiable que si le reverse proxy
 * la réécrit ; la configuration nginx fournie le fait (voir deploy/nginx.conf).
 * On ne retient que le premier maillon, le reste étant sous contrôle du client.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
