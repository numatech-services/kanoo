"use client";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Compteur optionnel, affiché en pastille. */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}

/**
 * Sélecteur segmenté — période d'un graphique, onglet d'une liste.
 *
 * Rendu comme un groupe de boutons radio plutôt qu'une suite de `<button>` :
 * les flèches du clavier parcourent le groupe, et un lecteur d'écran annonce
 * « 2 sur 4 sélectionné » au lieu de quatre boutons sans lien entre eux.
 */
export function SegmentedControl<T extends string>({
  segments, value, onChange, size = "md", ariaLabel,
}: SegmentedControlProps<T>) {
  const pad = size === "sm" ? "px-2.5 h-7 text-xs" : "px-3.5 h-9 text-sm";

  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 bg-surface2 rounded-lg p-0.5 border border-line">
      {segments.map(segment => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(segment.value)}
            className={`${pad} rounded-md font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
              active
                ? "bg-surface text-ink shadow-sm"
                : "text-ink2 hover:text-ink"
            }`}
          >
            {segment.label}
            {typeof segment.count === "number" && (
              <span className={`num text-[10px] rounded-full px-1.5 py-0.5 leading-none ${
                active ? "bg-section-soft text-section" : "bg-line text-ink3"
              }`}>
                {segment.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
