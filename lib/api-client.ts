/**
 * Client des routes /api, côté navigateur.
 *
 * Chaque écran réécrivait le même enchaînement — lire le jeton CSRF, poser les
 * en-têtes, `res.json()`, tester `success` — et beaucoup l'écrivaient sans
 * tester `res.ok` : une erreur 400 passait pour une réponse vide, et
 * l'utilisateur ne voyait rien. Ici, une réponse en échec lève toujours une
 * `ApiError` portant le message du serveur, prêt à être affiché tel quel.
 *
 *   const { items } = await api.get<{ items: Client[] }>("/api/clients");
 *   await api.post("/api/payments", body);
 *   try { … } catch (e) { showToast(apiErrorMessage(e), "error"); }
 */

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

const CSRF_COOKIE = "csrf_token";
let csrfPromise: Promise<string> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find(c => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/** Jeton CSRF de la session : lu dans le cookie, demandé au serveur s'il manque. */
export async function csrfToken(): Promise<string> {
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie) return fromCookie;
  csrfPromise ??= fetch("/api/auth/csrf", { credentials: "include" })
    .then(r => r.json())
    .then(d => String(d.csrfToken ?? ""))
    .finally(() => { csrfPromise = null; });
  return csrfPromise;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiOptions {
  /** Corps JSON, ou FormData pour un envoi de fichier. */
  body?: unknown;
  /** Paramètres de requête ; les valeurs vides sont ignorées. */
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

function withQuery(url: string, query?: ApiOptions["query"]): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

/**
 * Appel brut. Renvoie le champ `data` de la réponse (ou la réponse entière si
 * la route n'enveloppe pas), lève `ApiError` sur tout statut hors 2xx ou
 * `success: false`.
 */
export async function apiFetch<T = unknown>(method: Method, url: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET") headers["x-csrf-token"] = await csrfToken();

  let res: Response;
  try {
    res = await fetch(withQuery(url, opts.query), { method, credentials: "include", headers, body, signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Connexion impossible. Vérifiez le réseau et réessayez.", 0);
  }

  const payload = await res.json().catch(() => null) as
    { success?: boolean; data?: unknown; error?: string; message?: string; details?: unknown } | null;
  if (!res.ok || payload?.success === false) {
    const message = payload?.error || payload?.message
      || (res.status === 403 ? "Vous n'avez pas les droits pour cette action."
        : res.status === 404 ? "Élément introuvable."
        : res.status >= 500 ? "Erreur du serveur. Réessayez dans un instant."
        : `La requête a échoué (${res.status}).`);
    throw new ApiError(message, res.status, payload?.details);
  }
  return (payload && "data" in payload ? payload.data : payload) as T;
}

export const api = {
  get: <T = unknown>(url: string, opts?: Omit<ApiOptions, "body">) => apiFetch<T>("GET", url, opts),
  post: <T = unknown>(url: string, body?: unknown, opts?: Omit<ApiOptions, "body">) => apiFetch<T>("POST", url, { ...opts, body }),
  put: <T = unknown>(url: string, body?: unknown, opts?: Omit<ApiOptions, "body">) => apiFetch<T>("PUT", url, { ...opts, body }),
  patch: <T = unknown>(url: string, body?: unknown, opts?: Omit<ApiOptions, "body">) => apiFetch<T>("PATCH", url, { ...opts, body }),
  del: <T = unknown>(url: string, opts?: ApiOptions) => apiFetch<T>("DELETE", url, opts),
};

/** Message lisible d'une erreur quelconque, pour un toast ou un bandeau. */
export function apiErrorMessage(e: unknown, fallback = "Une erreur est survenue."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Lecture « enveloppe » : renvoie la réponse JSON telle quelle (`{ success,
 * data, error }`), comme `fetch(url).then(r => r.json())`, si bien qu'un
 * écran existant se branche sans changer sa lecture des données. La
 * différence : un échec n'est plus silencieux. Le message du serveur s'affiche
 * (sauf `quiet`), et la promesse se résout quand même avec
 * `{ success: false, error }` — un écran qui lisait `d.data?.items` affiche
 * alors une liste vide au lieu de planter, sans jamais rester bloqué.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- même type que `r.json()`, qu'il remplace
export async function apiJson<T = any>(url: string, opts: { quiet?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  try {
    const res = await fetch(url, { credentials: "include", signal: opts.signal });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.success === false) {
      const error = payload?.error || payload?.message
        || (res.status === 403 ? "Vous n'avez pas les droits pour afficher ces données." : `Lecture impossible (${res.status}).`);
      // Seules les vraies pannes s'affichent : requête refusée (400, 409, 422),
      // trop de requêtes, erreur serveur. Droits manquants (403) et élément
      // introuvable (404) sont des cas que l'écran présente lui-même — beaucoup
      // de listes sont lues « au cas où » ; 401 relève de la reconnexion.
      if (!opts.quiet && [400, 409, 422, 429].concat(res.status >= 500 ? [res.status] : []).includes(res.status)) notify(error);
      return { ...(payload ?? {}), success: false, error } as T;
    }
    return (payload ?? {}) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const error = "Connexion impossible. Vérifiez le réseau et réessayez.";
    if (!opts.quiet) notify(error);
    return { success: false, error } as T;
  }
}

// Le toast est chargé à la demande : ce module reste importable côté serveur.
function notify(message: string) {
  if (typeof window === "undefined") return;
  import("@/components/ui/Toast").then(m => m.showToast(message, "error")).catch(() => {});
}

/**
 * Envoi « à la Response » : `{ ok, status, data }`, où `data` est la réponse
 * JSON (enveloppe). Remplace l'enchaînement fetch + jeton CSRF + en-têtes +
 * `res.json()` des écrans existants sans changer leur logique : `res.ok` et
 * `res.status` gardent leur sens, `await res.json()` devient `res.data`.
 * Une coupure réseau donne `{ ok: false, status: 0 }` au lieu d'une exception.
 *
 * `extraHeaders` : par exemple `Idempotency-Key`, ou `X-Kanoo-Offline: page`
 * pour un écran qui garde lui-même ses envois en attente (le service worker
 * ne les met alors pas dans sa file).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- même type que `res.json()`, qu'il remplace
export async function apiSend<T = any>(method: Exclude<Method, "GET">, url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { ...extraHeaders, "x-csrf-token": await csrfToken() };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  try {
    const res = await fetch(url, { method, credentials: "include", headers, body: payload });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, data: { success: false, error: "Connexion impossible. Vérifiez le réseau et réessayez." } as T };
  }
}
