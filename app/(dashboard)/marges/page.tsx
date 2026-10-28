"use client";
import { useState } from "react";
import { Percent, Download, AlertTriangle, TrendingUp, TrendingDown, HelpCircle } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { EmptyState, Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
import { csvCell } from "@/lib/csv";

const MONEY = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("fr-FR")} FCFA`;
const PCT = (n: number | null) => (n === null || n === undefined ? "—" : `${n.toLocaleString("fr-FR")} %`);
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Row { key: string; label: string; category?: string; quantity: number; revenueHT: number; costTotal: number; marginHT: number; unvaluedRevenueHT: number; marginRate: number | null; markupRate: number | null; belowCost: boolean }
interface Report {
  rows: Row[]; trend: Row[]; top: Row[]; flop: Row[]; belowCost: Row[];
  unvalued: Array<{ key: string; label: string; revenueHT: number }>; estimatedLines: number;
  totals: { revenueHT: number; costTotal: number; marginHT: number; unvaluedRevenueHT: number; marginRate: number | null; markupRate: number | null };
}

const GROUPS: Record<string, string> = { product: "Produit", category: "Catégorie", month: "Mois", desk: "Comptoir", cashier: "Vendeur", source: "Canal" };
const SOURCES: Record<string, string> = { all: "Comptoirs et factures", comptoir: "Comptoirs seulement", invoices: "Factures seulement" };

/**
 * Marges par produit : coût FIGÉ à la vente (tickets du comptoir) ou coût
 * réel des sorties de stock (factures livrées). Taux de marge (sur coût) et
 * taux de marque (sur prix de vente HT) ; un article sans coût est signalé,
 * jamais compté à 100 % de marge.
 */
export default function MargesPage() {
  const now = new Date();
  const [from, setFrom] = useState(localDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localDay(now));
  const [groupBy, setGroupBy] = useState("product");
  const [source, setSource] = useState("all");
  const { data, loading, error } = useApi<Report | null>(`/api/reports/margins?from=${from}&to=${to}&groupBy=${groupBy}&source=${source}`, d => d?.data ?? null, null, { quiet: true });

  function exportCsv() {
    if (!data) return;
    const head = [GROUPS[groupBy], "Quantité", "CA HT", "Coût", "Marge HT", "Taux de marge", "Taux de marque", "CA non valorisé"];
    const rows = data.rows.map(r => [r.label, r.quantity, r.revenueHT, r.costTotal, r.marginHT, r.marginRate ?? "", r.markupRate ?? "", r.unvaluedRevenueHT]);
    const csv = "﻿" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `marges-${groupBy}-${from}-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const t = data?.totals;
  const maxTrend = Math.max(1, ...(data?.trend ?? []).map(r => Math.abs(r.marginHT)));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Percent size={22} /> Marges</h1>
          <p className="text-sm text-ink2">Ce que rapporte chaque produit : prix de vente HT moins coût d&apos;achat réel au moment de la vente.</p>
        </div>
        {data && data.rows.length > 0 && <button onClick={exportCsv} className={buttonClass("secondary", "md")}><Download size={15} /> Export CSV</button>}
      </div>

      <div className="surface-card p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FormField label="Du"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></FormField>
        <FormField label="Au"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></FormField>
        <FormField label="Regrouper par"><select className={selectCls} value={groupBy} onChange={e => setGroupBy(e.target.value)}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        <FormField label="Ventes"><select className={selectCls} value={source} onChange={e => setSource(e.target.value)}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
      </div>

      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="Chiffre d'affaires HT" value={MONEY(t.revenueHT)} />
          <Kpi label="Coût des ventes" value={MONEY(t.costTotal)} />
          <Kpi label="Marge brute HT" value={MONEY(t.marginHT)} tone={t.marginHT < 0 ? "neg" : "pos"} />
          <Kpi label="Taux de marque" value={PCT(t.markupRate)} hint="Marge ÷ prix de vente HT" />
          <Kpi label="Taux de marge" value={PCT(t.marginRate)} hint="Marge ÷ coût d'achat" />
        </div>
      )}

      {data && data.belowCost.length > 0 && (
        <div className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
          <span className="font-semibold inline-flex items-center gap-1"><AlertTriangle size={15} /> Vendus sous leur coût : </span>
          {data.belowCost.map(r => `${r.label} (${MONEY(r.marginHT)})`).join(", ")}
        </div>
      )}
      {data && (data.unvalued.length > 0 || data.estimatedLines > 0) && (
        <div className="px-4 py-3 bg-warn-50 border border-warn/25 rounded-xl text-sm text-warn space-y-1">
          {data.unvalued.length > 0 && <p><span className="font-semibold inline-flex items-center gap-1"><HelpCircle size={15} /> Sans coût d&apos;achat ({MONEY(t?.unvaluedRevenueHT ?? 0)} de CA HT exclu des marges) : </span>{data.unvalued.slice(0, 12).map(u => u.label).join(", ")}{data.unvalued.length > 12 ? "…" : ""}. Renseignez leur coût dans le catalogue.</p>}
          {data.estimatedLines > 0 && <p>{data.estimatedLines} ligne(s) de facture sans bon de livraison : coût estimé au coût d&apos;achat actuel.</p>}
        </div>
      )}

      {data && data.trend.length > 1 && (
        <div className="surface-card p-4">
          <h2 className="text-sm font-bold text-ink mb-3">Marge brute HT par mois</h2>
          <div className="flex items-end gap-2 h-36">
            {data.trend.map(r => (
              <div key={r.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10px] text-ink2 font-mono">{Math.round(r.marginHT / 1000).toLocaleString("fr-FR")}k</span>
                <div className={`w-full rounded-t ${r.marginHT < 0 ? "bg-neg" : "bg-section"}`} style={{ height: `${Math.max(2, (Math.abs(r.marginHT) / maxTrend) * 100)}px` }} title={`${r.label} : ${MONEY(r.marginHT)} (${PCT(r.markupRate)})`} />
                <span className="text-[10px] text-ink3">{r.label.slice(5)}/{r.label.slice(2, 4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && groupBy === "product" && data.top.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-3">
          <MiniList title="Ce qui rapporte le plus" icon={<TrendingUp size={15} />} rows={data.top} value={r => MONEY(r.marginHT)} />
          <MiniList title="Taux de marque les plus faibles" icon={<TrendingDown size={15} />} rows={data.flop} value={r => PCT(r.markupRate)} />
        </div>
      )}

      {!loading && data && data.rows.length === 0 ? (
        <EmptyState icon={<Percent size={20} />} title="Aucune vente valorisée sur la période" hint="Les tickets du comptoir et les factures d'articles du catalogue apparaissent ici." />
      ) : data && (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>{GROUPS[groupBy]}</th><th className="text-right">Qté</th><th className="text-right">CA HT</th><th className="text-right">Coût</th><th className="text-right">Marge HT</th><th className="text-right">Marque</th><th className="text-right">Marge / coût</th></tr></thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.key}>
                  <td className="text-ink font-medium">{r.label}{r.category && groupBy === "product" && <span className="block text-[11px] text-ink3 font-normal">{r.category}</span>}
                    {r.belowCost && <span className="ml-2"><Pill tone="neg">sous le coût</Pill></span>}
                    {r.unvaluedRevenueHT > 0 && <span className="ml-2"><Pill tone="warn">sans coût</Pill></span>}</td>
                  <td className="text-right font-mono">{r.quantity.toLocaleString("fr-FR")}</td>
                  <td className="text-right font-mono">{MONEY(r.revenueHT + r.unvaluedRevenueHT)}</td>
                  <td className="text-right font-mono text-ink2">{MONEY(r.costTotal)}</td>
                  <td className={`text-right font-mono font-semibold ${r.marginHT < 0 ? "text-neg" : "text-ink"}`}>{MONEY(r.marginHT)}</td>
                  <td className="text-right font-mono">{PCT(r.markupRate)}</td>
                  <td className="text-right font-mono text-ink2">{PCT(r.marginRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: "pos" | "neg"; hint?: string }) {
  return (
    <div className="surface-card p-4" title={hint}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function MiniList({ title, icon, rows, value }: { title: string; icon: React.ReactNode; rows: Row[]; value: (r: Row) => string }) {
  return (
    <div className="surface-card p-4">
      <h2 className="text-sm font-bold text-ink mb-2 inline-flex items-center gap-1.5">{icon} {title}</h2>
      <ul className="divide-y divide-line text-sm">
        {rows.map(r => <li key={r.key} className="flex justify-between py-1.5"><span className="text-ink truncate pr-2">{r.label}</span><span className="font-mono text-ink2">{value(r)}</span></li>)}
      </ul>
    </div>
  );
}
