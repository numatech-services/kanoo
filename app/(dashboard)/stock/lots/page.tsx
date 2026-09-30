"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";

interface Lot { _id: string; lotNumber: string; qty: number; expiryDate: string; productId?: { _id: string; code: string; label: string; unit?: string } | null; warehouseId?: { name: string } | null }

/** Lots périmés et à péremption : ce qu'il faut écouler ou sortir du stock. */
export default function LotsExpiryPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ expired: Lot[]; soon: Lot[] } | null>(null);
  useEffect(() => {
    fetch(`/api/stock/lots?days=${days}`, { credentials: "include" }).then(r => r.json()).then(d => setData(d.data ?? null)).catch(() => {});
  }, [days]);
  const table = (rows: Lot[], expired: boolean) => (
    <div className="bg-surface rounded-xl border border-line overflow-x-auto">
      <table className="table-dense w-full">
        <thead><tr className="bg-surface2/50 text-left"><th>Article</th><th>Lot</th><th>Entrepôt</th><th className="text-right">Quantité</th><th>Péremption</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-ink3 py-6">Aucun lot</td></tr>}
          {rows.map(l => {
            const d = Math.round((new Date(l.expiryDate).getTime() - Date.now()) / 86400000);
            return (
              <tr key={l._id} className="border-t border-line">
                <td>{l.productId ? <Link href={`/stock/${l.productId._id}`} className="hover:underline">{l.productId.label}<span className="block text-[11px] text-ink3 font-mono">{l.productId.code}</span></Link> : "—"}</td>
                <td className="font-mono text-xs">{l.lotNumber}</td>
                <td className="text-xs">{l.warehouseId?.name ?? "—"}</td>
                <td className="text-right font-mono">{l.qty} {l.productId?.unit}</td>
                <td className={`text-xs ${expired ? "text-neg font-semibold" : d <= 7 ? "text-warn font-semibold" : ""}`}>{new Date(l.expiryDate).toLocaleDateString("fr-FR")} ({expired ? `périmé depuis ${-d} j` : `dans ${d} j`})</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link href="/stock" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Stock</Link>
          <h1 className="text-2xl font-bold text-ink mt-1">Péremptions</h1>
          <p className="text-sm text-ink2">Les sorties prélèvent d&apos;office le lot qui périme le plus tôt. Un lot périmé se sort par une « perte ».</p>
        </div>
        <select className={`${selectCls} w-auto`} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Horizon">
          <option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option><option value={180}>6 mois</option>
        </select>
      </div>
      {data && <>
        <h2 className="font-semibold text-neg flex items-center gap-2"><AlertTriangle size={16} /> Périmés ({data.expired.length})</h2>
        {table(data.expired, true)}
        <h2 className="font-semibold text-ink">À péremption sous {days} jours ({data.soon.length})</h2>
        {table(data.soon, false)}
      </>}
    </div>
  );
}
