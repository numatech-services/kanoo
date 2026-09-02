/**
 * Client API Kanoo Mobile
 * Utilise le même backend que la webapp
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://kanoo.ne";

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const token = await AsyncStorage.getItem("auth_token");

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Session expirée → forcer la déconnexion
      if (res.status === 401) {
        await AsyncStorage.removeItem("auth_token");
      }
      return { ok: false, data: null, error: data?.error || `HTTP ${res.status}` };
    }

    return { ok: true, data: data?.data as T || null };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

export const api = {
  get:    <T>(path: string) => apiRequest<T>("GET", path),
  post:   <T>(path: string, body: unknown) => apiRequest<T>("POST", path, body),
  patch:  <T>(path: string, body: unknown) => apiRequest<T>("PATCH", path, body),
  delete: <T>(path: string) => apiRequest<T>("DELETE", path),
};
