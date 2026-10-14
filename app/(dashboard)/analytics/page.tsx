"use client";
import { useState, useEffect, useRef } from "react";

import { BarChart3 } from "lucide-react";
import { apiJson } from "@/lib/api-client";
interface AnalyticsSeries {
  data: number[];
  label: string;
  color: string;
}
interface AnalyticsData {
  period: { months: number; labels: string[] };
  series: Record<string, AnalyticsSeries>;
  kpis: {
    totalCA: number; totalEncaisse: number; tauxRecouvrement: number;
    clientActifs: number; facInRetard: number; caVsMoisPrecedent: number;
  };
  topClients: Array<{ name: string; total: number; count: number }>;
}

const CHART_H = 180;
const CHART_W = 700;

function LineChart({ series, labels }: { series: AnalyticsSeries[]; labels: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const allVals = series.flatMap(s => s.data);
    const maxVal = Math.max(...allVals, 1);
    const padL = 48; const padB = 28; const padT = 16; const padR = 16;
    const w = c.width - padL - padR;
    const h = c.height - padB - padT;
    const n = labels.length;

    ctx.clearRect(0, 0, c.width, c.height);

    // Grilles horizontales
    ctx.strokeStyle = "rgba(150,150,150,0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + h - (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.fillStyle = "rgba(150,150,150,0.7)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round((maxVal * i) / 4)), padL - 4, y + 3);
    }

    // Labels x
    ctx.fillStyle = "rgba(150,150,150,0.8)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i < n; i++) {
      const x = padL + (i / (n - 1)) * w;
      if (i % Math.ceil(n / 8) === 0 || i === n - 1) {
        ctx.fillText(labels[i], x, c.height - 6);
      }
    }

    // Lignes des séries
    series.forEach(s => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      s.data.forEach((v, i) => {
        const x = padL + (i / (n - 1)) * w;
        const y = padT + h - (v / maxVal) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Points
      ctx.fillStyle = s.color;
      s.data.forEach((v, i) => {
        const x = padL + (i / (n - 1)) * w;
        const y = padT + h - (v / maxVal) * h;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }, [series, labels]);

  return <canvas ref={canvas} width={CHART_W} height={CHART_H} style={{ width: "100%", height: `${CHART_H}px` }} />;
}

function BarChart({ data, labels, color }: { data: number[]; labels: string[]; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const maxVal = Math.max(...data, 1);
    const padL = 8; const padB = 28; const padT = 8; const padR = 8;
    const w = c.width - padL - padR;
    const h = c.height - padB - padT;
    const n = data.length;
    const barW = Math.max(4, (w / n) * 0.65);
    const gap = w / n;

    ctx.clearRect(0, 0, c.width, c.height);

    data.forEach((v, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      const barH = (v / maxVal) * h;
      const y = padT + h - barH;

      ctx.fillStyle = color + "33";
      ctx.fillRect(x, padT, barW, h);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, barH);
    });

    ctx.fillStyle = "rgba(150,150,150,0.7)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    data.forEach((_, i) => {
      if (i % Math.ceil(n / 6) === 0 || i === n - 1) {
        ctx.fillText(labels[i], padL + i * gap + gap / 2, c.height - 6);
      }
    });
  }, [data, labels, color]);

  return <canvas ref={canvas} width={CHART_W} height={120} style={{ width: "100%", height: "120px" }} />;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);
  const [activeMetrics, setActiveMetrics] = useState<string[]>(["ca", "encaissements"]);

  useEffect(() => {
    setLoading(true);
    apiJson(`/api/reports/analytics?months=${months}`)
      .then(d => setData(d.data))
      .finally(() => setLoading(false));
  }, [months]);

  const toggleMetric = (key: string) => {
    setActiveMetrics(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const kpi = data?.kpis;
  const labels = data?.period.labels || [];

  const activeSeries = data
    ? Object.entries(data.series)
        .filter(([key]) => activeMetrics.includes(key))
        .map(([, s]) => s)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Évolution sur 12 mois</h1>
          <p className="text-sm text-ink2 mt-0.5">Analyse de performance sur {months} mois</p>
        </div>
        <div className="flex gap-2">
          {[3, 6, 12, 24].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${months === m ? "bg-section text-white" : "border border-line text-ink2 hover:bg-surface2"}`}>
              {m} mois
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-4">{[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-surface rounded-xl animate-pulse border border-line" />)}</div>
          <div className="h-64 bg-surface rounded-xl animate-pulse border border-line" />
        </div>
      ) : data && kpi ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-surface rounded-xl border border-line p-4">
              <p className="text-xs text-ink2 uppercase tracking-wide">CA {months} mois</p>
              <p className="text-xl font-bold text-ink mt-1 font-mono">{(kpi.totalCA / 1_000_000).toFixed(1)}M</p>
              <p className={`text-xs mt-1 font-medium ${kpi.caVsMoisPrecedent >= 0 ? "text-pos" : "text-neg"}`}>
                {kpi.caVsMoisPrecedent >= 0 ? "+" : ""}{kpi.caVsMoisPrecedent}% vs M-1
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-line p-4">
              <p className="text-xs text-ink2 uppercase tracking-wide">Encaissé</p>
              <p className="text-xl font-bold text-pos mt-1 font-mono">{(kpi.totalEncaisse / 1_000_000).toFixed(1)}M</p>
              <p className="text-xs text-ink2 mt-1">FCFA reçus</p>
            </div>
            <div className={`rounded-xl border p-4 ${kpi.tauxRecouvrement >= 80 ? "bg-surface border-line" : "bg-warn-50 border-warn/25"}`}>
              <p className="text-xs text-ink2 uppercase tracking-wide">Taux recouvrement</p>
              <p className={`text-xl font-bold mt-1 font-mono ${kpi.tauxRecouvrement >= 80 ? "text-pos" : kpi.tauxRecouvrement >= 60 ? "text-warn" : "text-neg"}`}>
                {kpi.tauxRecouvrement}%
              </p>
              <div className="mt-1.5 h-1.5 bg-surface2 rounded-full">
                <div className={`h-1.5 rounded-full ${kpi.tauxRecouvrement >= 80 ? "bg-pos" : kpi.tauxRecouvrement >= 60 ? "bg-warn" : "bg-neg"}`}
                  style={{ width: `${kpi.tauxRecouvrement}%` }} />
              </div>
            </div>
            <div className="bg-surface rounded-xl border border-line p-4">
              <p className="text-xs text-ink2 uppercase tracking-wide">Clients actifs</p>
              <p className="text-xl font-bold text-ink mt-1">{kpi.clientActifs}</p>
              <p className="text-xs text-ink2 mt-1">dans votre base</p>
            </div>
            <div className={`rounded-xl border p-4 ${kpi.facInRetard > 0 ? "bg-neg-50 border-neg/25" : "bg-surface border-line"}`}>
              <p className="text-xs text-ink2 uppercase tracking-wide">Factures en retard</p>
              <p className={`text-xl font-bold mt-1 ${kpi.facInRetard > 0 ? "text-neg" : "text-pos"}`}>{kpi.facInRetard}</p>
              <p className="text-xs text-ink2 mt-1">{kpi.facInRetard === 0 ? "Aucun retard" : "à relancer"}</p>
            </div>
          </div>

          {/* Graphique principal */}
          <div className="bg-surface rounded-xl border border-line p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-ink">Évolution {months} mois</h2>
              <div className="flex gap-2 flex-wrap">
                {data.series && Object.entries(data.series).map(([key, s]) => (
                  <button key={key} onClick={() => toggleMetric(key)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${activeMetrics.includes(key) ? "border-transparent text-white" : "border-line text-ink2"}`}
                    style={activeMetrics.includes(key) ? { background: s.color } : {}}>
                    <span className="w-2 h-2 rounded-full" style={{ background: activeMetrics.includes(key) ? "white" : s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {activeSeries.length > 0 ? (
              <LineChart series={activeSeries} labels={labels} />
            ) : (
              <div className="h-44 flex items-center justify-center text-ink2 text-sm">
                Sélectionnez au moins une métrique
              </div>
            )}
          </div>

          {/* CA mensuel en barres + top clients */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-surface rounded-xl border border-line p-5">
              <h2 className="font-semibold text-ink mb-3">CA mensuel (k FCFA)</h2>
              <BarChart data={data.series.ca.data} labels={labels} color="#2F3E46" />
            </div>

            <div className="bg-surface rounded-xl border border-line p-5">
              <h2 className="font-semibold text-ink mb-3">Top 5 clients — {months} mois</h2>
              {data.topClients.length === 0 ? (
                <p className="text-ink2 text-sm text-center py-8">Aucune donnée</p>
              ) : (
                <div className="space-y-3">
                  {data.topClients.map((c, i) => {
                    const maxTotal = data.topClients[0].total;
                    return (
                      <div key={c.name}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-ink font-medium truncate flex items-center gap-2">
                            <span className="text-xs text-ink2 w-4 text-center">{i + 1}</span>
                            {c.name}
                          </span>
                          <span className="font-mono text-ink2 flex-shrink-0 ml-2">
                            {(c.total / 1_000_000).toFixed(1)}M · {c.count} fac.
                          </span>
                        </div>
                        <div className="h-2 bg-surface2 rounded-full">
                          <div className="h-2 bg-section rounded-full" style={{ width: `${(c.total / maxTotal) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Marge brute */}
          <div className="bg-surface rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-3">Marge brute mensuelle (k FCFA)</h2>
            <div className="flex items-end gap-1" style={{ height: "80px" }}>
              {data.series.margeBrute.data.map((v, i) => {
                const maxV = Math.max(...data.series.margeBrute.data.map(Math.abs), 1);
                const h = Math.round((Math.abs(v) / maxV) * 70);
                const isNeg = v < 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${labels[i]}: ${v}k FCFA`}>
                    {!isNeg && <div className="rounded-sm w-full" style={{ height: `${h}px`, background: "#97C459", marginTop: `${70 - h}px` }} />}
                    {isNeg && <div className="rounded-sm w-full" style={{ height: `${h}px`, background: "#F09595", marginTop: `${70}px` }} />}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-ink2 mt-1">
              <span>{labels[0]}</span>
              <span>{labels[Math.floor(labels.length / 2)]}</span>
              <span>{labels[labels.length - 1]}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-surface rounded-xl border border-line p-12 text-center">
          <p className="mb-3 text-ink3 flex justify-center" aria-hidden><BarChart3 size={30} /></p>
          <p className="text-ink2">Aucune donnée disponible pour cette période.</p>
        </div>
      )}
    </div>
  );
}
