import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://kanoo.ne";

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ data?: T; error?: string; status: number }> {
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

    const json = await res.json();
    return { data: json.data, error: json.error, status: res.status };
  } catch (err) {
    return { error: "Erreur réseau — vérifiez votre connexion", status: 0 };
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>("GET", path),
  post: <T>(path: string, body: unknown) => apiRequest<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => apiRequest<T>("PATCH", path, body),
  delete: <T>(path: string) => apiRequest<T>("DELETE", path),
};
