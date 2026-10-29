/**
 * Carte d'indicateur (charte des écrans métier : suivi des marchés, comptoir,
 * documents) : pastille d'icône en dégradé, libellé, valeur, précision.
 */
export const KPI_TONES = {
  blue: "linear-gradient(135deg,rgb(0 130 235),rgb(47 89 223))",
  red: "linear-gradient(135deg,rgb(240 110 90),rgb(194 39 45))",
  green: "linear-gradient(135deg,rgb(40 170 110),rgb(0 120 64))",
  violet: "linear-gradient(135deg,rgb(140 100 230),rgb(110 68 188))",
  amber: "linear-gradient(135deg,rgb(240 170 60),rgb(214 134 40))",
  teal: "linear-gradient(135deg,rgb(30 170 180),rgb(0 120 140))",
} as const;
export type KpiTone = keyof typeof KPI_TONES;

export function MetricCard({ icon, tone = "blue", label, value, sub, valueCls = "" }: {
  icon: React.ReactNode; tone?: KpiTone; label: string; value: string; sub?: string; valueCls?: string;
}) {
  return (
    <div className="bg-surface rounded-[22px] border border-line shadow-card p-[18px] flex flex-col gap-2.5 min-w-0">
      <span className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{ background: KPI_TONES[tone] }} aria-hidden>{icon}</span>
        <span className="text-[13.5px] font-medium text-ink2">{label}</span>
      </span>
      <span className={`text-[22px] sm:text-[28px] font-extrabold tracking-tight leading-none num truncate ${valueCls || "text-ink"}`} title={value}>{value}</span>
      {sub !== undefined && <span className="text-[12px] text-ink3 truncate">{sub}</span>}
    </div>
  );
}

/** Onglets en pilule (actif en dégradé), avec compteur facultatif. */
export function PillTabs<K extends string>({ tabs, value, onChange, label }: {
  tabs: Array<{ key: K; label: string; icon?: React.ReactNode; count?: number | null }>; value: K; onChange: (k: K) => void; label: string;
}) {
  return (
    <div className="flex flex-nowrap sm:inline-flex sm:flex-wrap p-1 rounded-2xl bg-surface border border-line gap-1 overflow-x-auto max-w-full" role="group" aria-label={label}>
      {tabs.map(t => (
        <button key={t.key} aria-pressed={value === t.key} onClick={() => onChange(t.key)}
          className={`h-10 px-3.5 rounded-xl text-[13.5px] font-semibold inline-flex items-center gap-2 shrink-0 whitespace-nowrap ${value === t.key ? "grad-brand" : "text-ink2 hover:bg-surface2"}`}>
          {t.icon} {t.label}
          {t.count !== undefined && t.count !== null && <span className={`num text-[11px] px-1.5 rounded-full ${value === t.key ? "bg-white/25" : "bg-surface2 text-ink3"}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
