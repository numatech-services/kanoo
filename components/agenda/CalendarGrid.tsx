"use client";

import { AgendaItem, itemColor } from "./types";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

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
  return weeks;
}

const isToday = (d: Date) => localDayKey(d) === localDayKey(new Date());

/**
 * Grille d'un mois. `compact` (mini-mois pour trimestre/semestre/année) affiche
 * des pastilles ; sinon, des puces d'événements avec l'heure.
 */
export function MonthGrid({
  year, month, byDay, compact = false, onDay, onEvent,
}: {
  year: number; month: number;
  byDay: Record<string, AgendaItem[]>;
  compact?: boolean;
  onDay: (d: Date) => void;
  onEvent: (it: AgendaItem) => void;
}) {
  const weeks = monthMatrix(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="min-w-0">
      {compact && <p className="text-xs font-bold uppercase tracking-wide text-ink2 mb-1 capitalize">{monthLabel}</p>}
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className={`text-ink3 font-semibold ${compact ? "text-[9px] py-0.5" : "text-[11px] py-1"}`}>{compact ? w[0] : w}</div>
        ))}
        {weeks.flat().map((d, i) => {
          const inMonth = d.getMonth() === month;
          const evs = byDay[localDayKey(d)] || [];
          const today = isToday(d);
          return (
            <button key={i} onClick={() => onDay(d)}
              className={`text-left border border-line/60 -mt-px -ml-px overflow-hidden ${compact ? "h-9 p-0.5" : "min-h-[86px] p-1"} ${inMonth ? "bg-surface hover:bg-surface2/50" : "bg-surface2/30 text-ink3"}`}>
              <div className="flex items-center justify-between">
                <span className={`${compact ? "text-[10px]" : "text-xs"} ${today ? "bg-section text-white rounded-full w-5 h-5 grid place-items-center font-bold" : inMonth ? "text-ink2" : "text-ink3"}`}>{d.getDate()}</span>
                {compact && evs.length > 0 && (
                  <span className="flex gap-0.5">
                    {evs.slice(0, 3).map((e) => <span key={e._id} className="w-1.5 h-1.5 rounded-full" style={{ background: itemColor(e) }} />)}
                  </span>
                )}
              </div>
              {!compact && (
                <div className="mt-0.5 space-y-0.5">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e._id} onClick={(ev) => { ev.stopPropagation(); onEvent(e); }}
                      className="block text-[10px] leading-tight px-1 py-0.5 rounded text-white truncate cursor-pointer" style={{ background: itemColor(e) }}
                      title={e.title}>
                      {!e.allDay && <b className="font-semibold">{hhmm(e.startAt)} </b>}{e.title}
                    </span>
                  ))}
                  {evs.length > 3 && <span className="block text-[10px] text-ink3 px-1">+{evs.length - 3}</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
