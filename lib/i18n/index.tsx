/**
 * i18n léger — Kanoo (FR + EN)
 * Pas de dépendance externe — fonctionne avec le système de cookies Next.js
 * 
 * Usage dans un composant client :
 *   const { t, locale, setLocale } = useTranslation();
 *   <p>{t("nav.dashboard")}</p>
 * 
 * Usage dans une API route :
 *   const locale = getLocaleFromRequest(req);
 *   const t = createTranslator(locale);
 */

"use client";

import { useState, useCallback, createContext, useContext, ReactNode } from "react";

export type Locale = "fr" | "en";
export const SUPPORTED_LOCALES: Locale[] = ["fr", "en"];
export const DEFAULT_LOCALE: Locale = "fr";

// Chargement dynamique des traductions (lazy)
const translations: Record<Locale, Record<string, unknown>> = {
  fr: {},
  en: {},
};

let frLoaded = false;
let enLoaded = false;

async function loadTranslations(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === "fr" && !frLoaded) {
    try {
      const mod = await import("../../messages/fr.json");
      translations.fr = mod.default;
      frLoaded = true;
    } catch { translations.fr = {}; }
  }
  if (locale === "en" && !enLoaded) {
    try {
      const mod = await import("../../messages/en.json");
      translations.en = mod.default;
      enLoaded = true;
    } catch { translations.en = {}; }
  }
  return translations[locale];
}

/**
 * Récupère une valeur dans un objet imbriqué via chemin pointé
 * Ex : get(obj, "nav.dashboard") → obj.nav.dashboard
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return path;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : path;
}

/**
 * Crée une fonction de traduction synchrone (après chargement)
 */
export function createTranslator(locale: Locale) {
  const msgs = translations[locale] || translations[DEFAULT_LOCALE];
  return (key: string, fallback?: string): string => {
    const val = getNestedValue(msgs, key);
    if (val !== key) return val;
    // Fallback sur FR si clé absente en EN
    if (locale !== DEFAULT_LOCALE) {
      const frVal = getNestedValue(translations[DEFAULT_LOCALE], key);
      if (frVal !== key) return frVal;
    }
    return fallback || key;
  };
}

// ─── Contexte React ───────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [msgs, setMsgs] = useState<Record<string, unknown>>(translations[initialLocale] || {});

  // Charger les traductions initiales
  if (Object.keys(translations[initialLocale]).length === 0) {
    loadTranslations(initialLocale).then(setMsgs);
  }

  const setLocale = useCallback(async (newLocale: Locale) => {
    const loaded = await loadTranslations(newLocale);
    setMsgs(loaded);
    setLocaleState(newLocale);
    // Persister dans cookie (lu par le middleware)
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${365 * 86400}; SameSite=Lax`;
  }, []);

  const t = useCallback((key: string, fallback?: string): string => {
    const val = getNestedValue(msgs, key);
    if (val !== key) return val;
    if (locale !== DEFAULT_LOCALE) {
      const frVal = getNestedValue(translations[DEFAULT_LOCALE], key);
      if (frVal !== key) return frVal;
    }
    return fallback || key;
  }, [msgs, locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  return useContext(I18nContext);
}

/**
 * Pour les APIs : lit le cookie NEXT_LOCALE depuis les headers
 */
export function getLocaleFromRequest(req: { headers: { get: (k: string) => string | null } }): Locale {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/NEXT_LOCALE=([a-z]{2})/);
  const lang = match?.[1] as Locale;
  return SUPPORTED_LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}
