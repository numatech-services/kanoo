"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";

interface Flow { label: string; amount: number; kind: "in" | "out"; source: string; date: string }
interface Week { start: string; end: string; in: number; out: number; balance: number; flows: Flow[] }
interface Forecast { opening: number; accounts: Array<{ label: string; balance: number }>; weeks: Week[]; lowest: { balance: number; weekStart: string } | null; totals: { in: number; out: number }; notes: string[] }
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const d = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

/** Prévision de trésorerie semaine par semaine. */
export default function TreasuryForecastPage() {
  const [weeks, setWeeks] = useState(13);
  const [data, setData] = useState<Forecast | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => {
    fetch(`/api/treasury-accounts/forecast?weeks=${weeks}`, { credentials: "include" }).then(r => r.json()).then(x => setData(x.data ?? null)).catch(() => {});
  }, [weeks]);
  if (!data) return <div className="h-64 bg-surface rounded-xl border border-line animate-pulse" />;
  const max = Math.max(1, ...data.weeks.map(w => Math.abs(w.balance)));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link href="/treasury" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Trésorerie</Link>
          <h1 className="text-2xl font-bold text-ink mt-1">Prévision de trésorerie</h1>
          <p className="text-sm text-ink2">Soldes d&apos;aujourd&apos;hui + ce qui doit rentrer − ce qui doit sortir.</p>
        </div>
        <select className={`${selectCls} w-auto`} value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Horizon">
          <option value={8}>8 semaines</option><option value={13}>13 semaines (trimestre)</option><option value={26}>26 semaines</option>
        </select>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        {[["Solde actuel", data.opening, "text-ink"], ["Encaissements attendus", data.totals.in, "text-pos"], ["Décaissements attendus", data.totals.out, "text-neg"], ["Solde final prévu", data.opening + data.totals.in - data.totals.out, data.opening + data.totals.in - data.totals.out >= 0 ? "text-pos" : "text-neg"]].map(([k, v, c]) => (
          <div key={String(k)} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className={`text-xl font-bold mt-1 ${c}`}>{fmt(Number(v))} XOF</p></div>
        ))}
      </div>
      {data.lowest && data.lowest.balance < 0 && (
        <p className="p-3 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg flex items-center gap-2"><AlertTriangle size={16} /> Trésorerie négative prévue la semaine du {d(data.lowest.weekStart)} ({fmt(data.lowest.balance)} XOF) : relancez les clients ou décalez des paiements.</p>
      )}

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th /><th>Semaine</th><th className="text-right">Entrées</th><th className="text-right">Sorties</th><th className="text-right">Solde fin de semaine</th><th className="w-1/4" /></tr></thead>
          <tbody>
            {data.weeks.map((w, i) => (
              <Fragment key={i}>
                <tr className="border-t border-line cursor-pointer hover:bg-surface2/30" onClick={() => setOpen(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                  <td className="w-6 text-ink3">{w.flows.length ? (open.has(i) ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                  <td className="text-xs whitespace-nowrap">{i === 0 ? "Cette semaine + retards" : `${d(w.start)} → ${d(w.end)}`}</td>
                  <td className="text-right font-mono text-pos">{w.in ? fmt(w.in) : ""}</td>
                  <td className="text-right font-mono text-neg">{w.out ? fmt(w.out) : ""}</td>
                  <td className={`text-right font-mono font-semibold ${w.balance < 0 ? "text-neg" : "text-ink"}`}>{fmt(w.balance)}</td>
                  <td><div className="h-2 bg-surface2 rounded-full overflow-hidden"><div className={`h-full ${w.balance < 0 ? "bg-neg" : "bg-section"}`} style={{ width: `${Math.min(100, (Math.abs(w.balance) / max) * 100)}%` }} /></div></td>
                </tr>
                {open.has(i) && w.flows.map((f, j) => (
                  <tr key={`${i}-${j}`} className="bg-surface2/20 text-xs">
                    <td /><td className="text-ink2">{f.source}</td>
                    <td colSpan={2}>{f.label} · {d(f.date)}</td>
                    <td className={`text-right font-mono ${f.kind === "in" ? "text-pos" : "text-neg"}`}>{f.kind === "in" ? "+" : "−"}{fmt(f.amount)}</td><td />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-[11px] text-ink3 list-disc pl-5">{data.notes.map(n => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
