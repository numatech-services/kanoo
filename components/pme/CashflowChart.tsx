"use client";

import { useEffect, useState } from "react";

interface MonthData {
  mois: string;
  encaissements: number;
  decaissements: number;
  solde: number;
}

export function CashflowChart() {
  const [data, setData] = useState<MonthData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reports/cashflow?months=6", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d.data?.months || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  const maxVal = Math.max(...data.map((d) => Math.max(d.encaissements, d.decaissements)), 1);

  return (
    <div className="bg-white rounded-xl border border-clay/20 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-ink">Flux de trésorerie (6 mois)</h2>
        <div className="flex items-center gap-4 text-xs text-moss">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-green-400 inline-block" />
            Encaissements
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-300 inline-block" />
            Décaissements
          </span>
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-moss text-sm">
          Chargement…
        </div>
      ) : data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-moss text-sm">
          Aucune donnée disponible
        </div>
      ) : (
        <div className="flex items-end gap-3 h-40">
          {data.map((d) => (
            <div key={d.mois} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-end gap-0.5 w-full" style={{ height: "120px" }}>
                <div
                  className="flex-1 bg-green-400 rounded-t transition-all"
                  style={{ height: `${(d.encaissements / maxVal) * 100}%`, minHeight: "2px" }}
                  title={`Encaissements: ${d.encaissements.toLocaleString("fr")} XOF`}
                />
                <div
                  className="flex-1 bg-red-300 rounded-t transition-all"
                  style={{ height: `${(d.decaissements / maxVal) * 100}%`, minHeight: "2px" }}
                  title={`Décaissements: ${d.decaissements.toLocaleString("fr")} XOF`}
                />
              </div>
              <span className="text-xs text-moss">{d.mois}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
