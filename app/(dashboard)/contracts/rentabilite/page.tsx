"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Row {
  _id: string; reference: string; title: string; status: string; client: string; hasProject: boolean;
  quoteHT: number | null; contractHT: number; workHT: number; depositsOutstandingHT: number; collectedTTC: number; dueTTC: number; toInvoiceHT: number;
  costActual: number; costCommitted: number; marginActual: number; marginActualRate: number | null; marginAtCompletion: number; marginAtCompletionRate: number | null;
}
const fmt = (n?: number | null) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("fr-FR"));
const pct = (n: number | null) => (n === null ? "" : ` (${n.toLocaleString("fr-FR")} %)`);

/** Rentabilité des marchés : devis, marché, facturé, dépenses et marges côte à côte. */
export default function MarketsProfitabilityPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/contracts/rentabilite", { credentials: "include" }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Accès refusé"); setRows([]); return; }
      setRows(d.data?.items ?? []); setTotals(d.data?.totals ?? {});
    }).catch(() => setError("Chargement impossible"));
  }, []);
  return (
    <div className="space-y-5">
      <div>
        <Link href="/contracts" className="text-xs text-ink2 hover:text-ink">← Contrats</Link>
        <h1 className="page-title mt-1">Rentabilité des marchés</h1>
        <p className="text-sm text-ink2">Montants HT, en FCFA. Marge réelle : travaux facturés − dépenses réalisées. À terminaison : marché − réalisé − engagé.</p>
      </div>
      {error && <p className="p-3 rounded-lg bg-neg-50 text-neg text-sm">{error}</p>}
      {rows && rows.length > 0 && (
        <div className="grid sm:grid-cols-4 gap-3">
          {[["Marchés", totals.contractHT], ["Travaux facturés", totals.workHT], ["Dépenses réalisées", totals.costActual], ["Marge à terminaison", totals.marginAtCompletion]].map(([k, v]) => (
            <div key={String(k)} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className={`text-xl font-bold mt-1 ${Number(v) < 0 ? "text-neg" : "text-ink"}`}>{fmt(Number(v))}</p></div>
          ))}
        </div>
      )}
      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left">
            <th>Marché</th><th className="text-right">Devis</th><th className="text-right">Marché</th><th className="text-right">Facturé</th><th className="text-right">Reste à facturer</th>
            <th className="text-right">À encaisser (TTC)</th><th className="text-right">Dépenses réalisées</th><th className="text-right">Engagées</th><th className="text-right">Marge réelle</th><th className="text-right">Marge à terminaison</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={10} className="text-center text-ink3 py-8">Chargement…</td></tr>}
            {rows?.length === 0 && !error && <tr><td colSpan={10} className="text-center text-ink3 py-8">Aucun marché actif. Créez-en un depuis un devis accepté (« → Marché »).</td></tr>}
            {rows?.map(r => (
              <tr key={r._id} className="border-t border-line">
                <td><Link href={`/contracts/${r._id}`} className="text-section hover:underline font-medium">{r.title}</Link>
                  <span className="block text-[11px] text-ink3">{r.reference}{r.client ? ` · ${r.client}` : ""}{!r.hasProject ? " · sans projet d'exécution" : ""}</span></td>
                <td className="text-right font-mono">{fmt(r.quoteHT)}</td>
                <td className="text-right font-mono">{fmt(r.contractHT)}</td>
                <td className="text-right font-mono">{fmt(r.workHT)}{r.depositsOutstandingHT > 0 && <span className="block text-[11px] text-ink3">+ {fmt(r.depositsOutstandingHT)} d&apos;acomptes</span>}</td>
                <td className="text-right font-mono">{fmt(r.toInvoiceHT)}</td>
                <td className="text-right font-mono">{fmt(r.dueTTC)}</td>
                <td className="text-right font-mono">{fmt(r.costActual)}</td>
                <td className="text-right font-mono text-ink2">{fmt(r.costCommitted)}</td>
                <td className={`text-right font-mono ${r.marginActual < 0 ? "text-neg" : ""}`}>{fmt(r.marginActual)}<span className="text-[11px] text-ink3">{pct(r.marginActualRate)}</span></td>
                <td className={`text-right font-mono font-semibold ${r.marginAtCompletion < 0 ? "text-neg" : "text-pos"}`}>{fmt(r.marginAtCompletion)}<span className="text-[11px] font-normal text-ink3">{pct(r.marginAtCompletionRate)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
