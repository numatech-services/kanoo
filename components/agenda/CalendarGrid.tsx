"use client";

import { AgendaItem } from "./types";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** « 15h30 », « 09h » : l'heure courte des puces. */
export const shortTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}h${d.getMinutes() ? pad(d.getMinutes()) : ""}`;
};

/** 6 semaines (42 cellules), lundi en tête, débordant sur les mois adjacents. */
function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startDow);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const days: Date[] = [];
    for (let d = 0; d < 7; d++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    weeks.push(days);
  }
  // Dernière semaine entièrement hors du mois : retirée (5 rangées suffisent souvent).
  return weeks.filter((w, i) => i < 5 || w.some(d => d.getMonth() === month));
}

const isToday = (d: Date) => localDayKey(d) === localDayKey(new Date());

/** Puce d'événement : fond teinté de la couleur de son agenda, point de couleur, heure en gras. */
export function EventChip({ it, color, onClick, solid = false }: { it: AgendaItem; color: string; onClick: () => void; solid?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={it.title}
      className={`w-full flex items-center gap-1 text-[11px] leading-tight px-1.5 py-[3px] rounded-md truncate text-left ${solid ? "text-white" : "text-ink"} ${it.status === "cancelled" ? "opacity-50 line-through" : ""}`}
      style={{ background: solid ? color : `${color}24` }}>
      {!solid && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />}
      <span className="truncate">{!it.allDay && <b className="font-semibold">{shortTime(it.startAt)} </b>}{it.title}</span>
    </button>
  );
}

/**
 * Grille d'un mois. Une cellule de jour se sélectionne (son numéro est un
 * bouton) ; chaque événement est un bouton à part (atteignable au clavier).
 * `compact` (trimestre, semestre, année) affiche des pastilles.
 */
export function MonthGrid({
  year, month, byDay, compact = false, selected, colorOf, onSelect, onEvent,
}: {
  year: number; month: number;
  byDay: Record<string, AgendaItem[]>;
  compact?: boolean;
  selected?: string;
  colorOf: (it: AgendaItem) => string;
  onSelect: (d: Date) => void;
  onEvent: (it: AgendaItem) => void;
}) {
  const weeks = monthMatrix(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="min-w-0" aria-label={monthLabel}>
      {compact && <p className="text-xs font-bold uppercase tracking-wide text-ink2 mb-1 capitalize">{monthLabel}</p>}
      <div className={`grid grid-cols-7 ${compact ? "" : "rounded-[18px] overflow-hidden border border-line bg-surface"}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} aria-hidden className={`text-center text-ink3 font-semibold ${compact ? "text-[9px] py-0.5" : "text-[11px] tracking-[0.08em] uppercase py-2.5 bg-surface2/60 border-b border-line"}`}>{compact ? w[0] : w}</div>
        ))}
        {weeks.flat().map((d, i) => {
          const key = localDayKey(d);
          const inMonth = d.getMonth() === month;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const evs = byDay[key] || [];
          const today = isToday(d);
          const isSel = selected === key;
          const dayLabel = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
          if (compact) {
            return (
              <button key={i} type="button" onClick={() => onSelect(d)} aria-pressed={isSel} aria-current={today ? "date" : undefined} aria-label={`${dayLabel}${evs.length ? `, ${evs.length} événement${evs.length > 1 ? "s" : ""}` : ""}`}
                className={`h-9 p-0.5 text-left border border-line/60 -mt-px -ml-px ${inMonth ? "bg-surface hover:bg-surface2/50" : "bg-surface2/30 text-ink3"} ${isSel ? "ring-2 ring-section ring-inset" : ""}`}>
                <span className="flex items-center justify-between">
                  <span className={`text-[10px] ${today ? "bg-section text-onink rounded-full w-4 h-4 grid place-items-center font-bold" : inMonth ? "text-ink2" : "text-ink3"}`}>{d.getDate()}</span>
                  {evs.length > 0 && <span className="flex gap-0.5">{evs.slice(0, 3).map((e) => <span key={e._id} className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(e) }} />)}</span>}
                </span>
              </button>
            );
          }
          return (
            <div key={i}
              className={`min-h-[104px] p-1.5 border-line ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? (weekend ? "bg-surface2/30" : "bg-surface") : "bg-surface2/60"} ${isSel ? "ring-2 ring-section/50 ring-inset" : ""}`}>
              <button type="button" onClick={() => onSelect(d)} aria-label={dayLabel} aria-pressed={isSel} aria-current={today ? "date" : undefined}
                className={`text-[12.5px] font-semibold w-7 h-7 rounded-full grid place-items-center ${today ? "bg-section text-onink" : inMonth ? "text-ink hover:bg-surface2" : "text-ink3 hover:bg-surface2"}`}>
                {d.getDate()}
              </button>
              <div className="mt-1 space-y-1">
                {evs.slice(0, 3).map((e) => <EventChip key={e._id} it={e} color={colorOf(e)} onClick={() => onEvent(e)} />)}
                {evs.length > 3 && (
                  <button type="button" onClick={() => onSelect(d)} className="block text-[11px] font-semibold text-section px-1 hover:underline">
                    + {evs.length - 3} autre{evs.length - 3 > 1 ? "s" : ""}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
