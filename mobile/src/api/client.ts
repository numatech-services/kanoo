/**
 * Client de l'API Kanoo pour l'application mobile — le seul (il y en avait
 * deux, divergents).
 *
 * Authentification : le serveur rend un jeton à la connexion quand l'appel
 * porte `x-kanoo-client: mobile` ; il est rangé dans le trousseau du
 * téléphone (SecureStore, chiffré par le système — jamais AsyncStorage, lisible
 * en clair) et présenté en `Authorization: Bearer`. Un 401 efface le jeton et
 * renvoie à l'écran de connexion.
 */
import * as SecureStore from "expo-secure-store";

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://numapilot.numatechservices.net";
const TOKEN_KEY = "kanoo.session";

let token: string | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

/** Lit le jeton conservé (au démarrage de l'application). */
export async function restoreSession(): Promise<boolean> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return Boolean(token);
}

async function setToken(next: string | null) {
  token = next;
  if (next) await SecureStore.setItemAsync(TOKEN_KEY, next);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
  listeners.forEach(l => l(Boolean(next)));
}

/** Être prévenu de la connexion / déconnexion (expiration comprise). */
export function onSessionChange(l: (signedIn: boolean) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error?: string }

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-kanoo-client": "mobile",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null) as { data?: T; error?: string; message?: string } | null;
    if (res.status === 401 && token) await setToken(null);
    if (!res.ok) return { ok: false, status: res.status, data: null, error: json?.error || json?.message || `Erreur ${res.status}` };
    return { ok: true, status: res.status, data: (json?.data ?? null) as T | null };
  } catch {
    return { ok: false, status: 0, data: null, error: "Connexion impossible. Vérifiez le réseau." };
  }
}

export type LoginStep = { done: true } | { done: false; twoFactor: true; challenge: string } | { done: false; error: string };

/** Connexion : soit la session est ouverte, soit un code de double authentification est demandé. */
export async function signIn(email: string, password: string): Promise<LoginStep> {
  const r = await api<{ token?: string; twoFactorRequired?: boolean; challenge?: string }>("POST", "/api/auth/login", { email, password });
  if (!r.ok) return { done: false, error: r.error || "Identifiants incorrects." };
  if (r.data?.twoFactorRequired && r.data.challenge) return { done: false, twoFactor: true, challenge: r.data.challenge };
  if (!r.data?.token) return { done: false, error: "Réponse inattendue du serveur." };
  await setToken(r.data.token);
  return { done: true };
}

/** Second facteur : code de l'application d'authentification ou code de secours. */
export async function verifyTwoFactor(challenge: string, code: string): Promise<LoginStep> {
  const r = await api<{ token?: string }>("POST", "/api/auth/2fa/verify", { challenge, token: code });
  if (!r.ok || !r.data?.token) return { done: false, error: r.error || "Code incorrect." };
  await setToken(r.data.token);
  return { done: true };
}

/** Déconnexion : le serveur révoque le jeton (sinon valable jusqu'à son expiration), puis on l'oublie. */
export async function signOut(): Promise<void> {
  await api("POST", "/api/auth/logout").catch(() => undefined);
  await setToken(null);
}
