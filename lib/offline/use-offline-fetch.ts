/**
 * Wrapper fetch offline-aware pour les formulaires
 * Dispatche un event si la création est bloquée hors-ligne
 */
"use client";

export async function offlineAwareFetch(
  url: string,
  options: RequestInit
): Promise<{ ok: boolean; data: unknown; offlineBlocked: boolean; offlineQueued: boolean }> {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  // La création a été bloquée par le SW (hors-ligne + document critique)
  if (!res.ok && (data as { blocked?: boolean }).blocked && (data as { offline?: boolean }).offline) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kanoo:blocked", { detail: data }));
    }
    return { ok: false, data, offlineBlocked: true, offlineQueued: false };
  }

  // La mutation a été mise en queue (hors-ligne + non critique)
  if (res.status === 202 && (data as { offline?: boolean }).offline) {
    return { ok: true, data, offlineBlocked: false, offlineQueued: true };
  }

  return { ok: res.ok, data, offlineBlocked: false, offlineQueued: false };
}
