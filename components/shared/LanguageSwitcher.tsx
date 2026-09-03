"use client";

import { useTranslation } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center gap-1 border border-line rounded-lg overflow-hidden">
      {(["fr", "en"] as const).map((lang) => (
        <button
          key={lang}
          onClick={() => setLocale(lang)}
          className={`px-2.5 py-1.5 text-xs font-medium transition-colors uppercase ${
            locale === lang
              ? "bg-section text-white"
              : "text-ink2 hover:bg-surface2"
          }`}
          title={lang === "fr" ? "Français" : "English"}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
