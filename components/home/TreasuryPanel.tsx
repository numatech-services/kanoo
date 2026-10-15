"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/home/primitives";
import { compactXof } from "@/components/ui/charts/geometry";
import type { HomeData } from "@/lib/dashboard-home";

/**
 * Évolution de la trésorerie : solde réel fin de mois, comparaison à l'année
 * précédente, et prévision à 90 jours (créances qui tombent moins achats à
 * régler) en pointillés.
 */
export function TreasuryPanel({ t }: { t: NonNullable<HomeData["treasury"]> }) {
  const [range, setRange] = useState<6 | 12>(12);
  const [compare, setCompare] = useState(false);
  const months = t.months.slice(-range);
  const prev = t.prevYear.slice(-range);
  // Le graphique prend la largeur réelle de sa carte : les graduations gardent
  // leur taille de texte au lieu d'être réduites avec le dessin.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 230, padL = 46, padB = 26, padT = 14;
  const all = [...months.map(m => m.balance), ...t.forecast.map(f => f.balance), ...(compare ? prev : []), 0];
  const max = Math.max(...all), min = Math.min(...all);
  const span = max - min || 1;
  const n = months.length + t.forecast.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - 8);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const path = (vals: number[], start = 0) => vals.map((v, i) => `${i ? "L" : "M"}${x(start + i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const real = months.map(m => m.balance);
  const forecastPath = path([real[real.length - 1], ...t.forecast.map(f => f.balance)], months.length - 1);
  const ticks = useMemo(() => [0, 1, 2, 3].map(k => min + (span * k) / 3), [min, span]);
  const last = months.length - 1;

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[16px] font-bold tracking-tight text-ink">Évolution de la trésorerie</h2>
          <p className="mt-1 flex items-baseline gap-2"><span className="text-[26px] font-extrabold tracking-tight num text-ink">{t.balance.toLocaleString("fr-FR")} FCFA</span><span className="text-xs font-semibold text-pos">solde actuel</span></p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setCompare(c => !c)} aria-pressed={compare}
            className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold ${compare ? "bg-accent-50 border-accent/30 text-accent" : "bg-surface border-line text-ink2 hover:bg-surface2"}`}>Comparer N-1</button>
          <span className="inline-flex p-1 rounded-full bg-surface2 border border-line">
            {([6, 12] as const).map(r => (
              <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
                className={`h-7 px-3 rounded-full text-[13px] font-semibold ${range === r ? "bg-surface text-ink shadow-sm" : "text-ink3"}`}>{r} mois</button>
            ))}
          </span>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-ink3 mb-1">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent" />Solde réel</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[rgb(110_68_188)]" />Prévision 90 j</span>
        {compare && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-ink3/50" />Année précédente</span>}
      </div>
      <div ref={box} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Solde de trésorerie sur ${range} mois, prévision à 90 jours`}>
        <defs>
          <linearGradient id="tre-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgb(47 89 223)" stopOpacity=".22" /><stop offset="1" stopColor="rgb(47 89 223)" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((v, k) => (
          <g key={k}>
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-line" strokeDasharray={k ? "3 4" : undefined} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="fill-ink3 text-[11px]">{compactXof(v)}</text>
          </g>
        ))}
        {compare && <path d={path(prev)} fill="none" stroke="currentColor" className="text-ink3/50" strokeWidth={1.6} />}
        <path d={`${path(real)} L${x(last)} ${H - padB} L${x(0)} ${H - padB} Z`} fill="url(#tre-area)" />
        <path d={path(real)} fill="none" stroke="rgb(47 89 223)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        <path d={forecastPath} fill="none" stroke="rgb(110 68 188)" strokeWidth={2.2} strokeDasharray="6 5" strokeLinecap="round" />
        <circle cx={x(last)} cy={y(real[last])} r={5} fill="rgb(47 89 223)" stroke="white" strokeWidth={2.5} />
        <g transform={`translate(${Math.min(x(last), W - 70)} ${Math.max(16, y(real[last]) - 16)})`}>
          <rect x={-34} y={-16} width={68} height={22} rx={7} className="fill-ink" />
          <text x={0} y={-1} textAnchor="middle" className="fill-onink text-[11px] font-bold">{compactXof(real[last])}</text>
        </g>
        {[...months.map(m => m.label), ...t.forecast.map(f => f.label)].map((l, i) => ((i < months.length && i % (range === 12 ? 2 : 1) === 0) || i === n - 1) && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className={`text-[11px] ${i >= months.length ? "fill-[rgb(110_68_188)]" : "fill-ink3"}`}>{l}</text>
        ))}
      </svg>
      </div>
      <p className="text-[11.5px] text-ink3 mt-1">Prévision : créances à échoir moins achats à régler. Le détail par semaine est dans <Link href="/treasury/prevision" className="text-accent font-semibold hover:underline">Prévision de trésorerie</Link>.</p>
    </Card>
  );
}
