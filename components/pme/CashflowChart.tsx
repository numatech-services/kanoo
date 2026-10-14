"use client";

import { useCallback, useEffect, useState } from "react";
import { AreaChart } from "@/components/ui/charts/AreaChart";
import { BarChart } from "@/components/ui/charts/BarChart";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fullXof } from "@/components/ui/charts/geometry";

import { apiJson } from "@/lib/api-client";
interface MonthData {
  mois: string;
  encaissements: number;
  decaissements: number;
  solde: number;
}

type Range = "6" | "12";
type View = "flux" | "solde";

/**
 * Flux de trésorerie.
 *
 * Deux lectures d'une même série : les mouvements bruts en aires superposées,
 * ou le solde net en barres — une barre sous zéro se repère au premier coup
 * d'œil, là où deux courbes qui se croisent demandent un effort.
 */
export function CashflowChart() {
  const [data, setData] = useState<MonthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState<Range>("6");
  const [view, setView] = useState<View>("flux");

  const load = useCallback(() => {
    setLoading(true);
    apiJson(`/api/reports/cashflow?months=${range}`)
      .then(d => { setData(d.data?.months || []); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const labels = data.map(d => d.mois);
  const net = data.reduce((sum, d) => sum + (d.solde ?? 0), 0);

  return (
    <div className="bg-surface rounded-xl border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-ink">Trésorerie</h2>
          {!loading && !error && data.length > 0 && (
            <p className="text-xs text-ink2 mt-0.5">
              Solde net sur la période&nbsp;:{" "}
              <span className={`num font-semibold ${net >= 0 ? "text-pos" : "text-neg"}`}>
                {fullXof(net)}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Vue"
            segments={[{ value: "flux", label: "Flux" }, { value: "solde", label: "Solde" }]}
            value={view} onChange={v => setView(v as View)} size="sm"
          />
          <SegmentedControl
            ariaLabel="Période"
            segments={[{ value: "6", label: "6 mois" }, { value: "12", label: "12 mois" }]}
            value={range} onChange={v => setRange(v as Range)} size="sm"
          />
        </div>
      </div>

      {loading && <div className="h-[260px] bg-surface2 rounded-lg animate-pulse" />}

      {!loading && error && (
        <p className="h-[260px] flex items-center justify-center text-sm text-ink3">
          Données de trésorerie indisponibles.
        </p>
      )}

      {!loading && !error && (
        view === "flux" ? (
          <AreaChart
            labels={labels}
            height={260}
            series={[
              { label: "Encaissements", values: data.map(d => d.encaissements), color: "rgb(var(--c-pos))" },
              { label: "Décaissements", values: data.map(d => d.decaissements), color: "rgb(var(--c-neg))" },
            ]}
          />
        ) : (
          <BarChart
            labels={labels}
            height={260}
            series={[{ label: "Solde", values: data.map(d => d.solde) }]}
          />
        )
      )}
    </div>
  );
}
