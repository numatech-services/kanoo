"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { MOVEMENT_OPTIONS } from "@/components/stock/MovementDialog";
import { useWarehouses } from "@/components/stock/useWarehouses";

import { buttonClass } from "@/components/ui/button-class";
import { StockTabs } from "@/components/stock/StockTabs";
interface Movement {
  _id: string; type: string; quantity: number; quantityBefore: number; quantityAfter: number; unitCost?: number;
  reason: string; linkedDocNumber?: string; createdAt: string; reversedBy?: string; reverses?: string;
  productId?: { _id: string; code: string; label: string; unit?: string } | null;
  createdBy?: { firstName?: string; lastName?: string } | null;
  warehouseId?: { name: string } | null; lots?: Array<{ lotNumber: string; qty: number }>;
}
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const TYPE_LABEL: Record<string, string> = { entry: "Entrée", exit: "Sortie", return: "Retour", loss: "Perte", adjustment: "Ajustement", transfer: "Transfert" };

/** Journal de tous les mouvements de stock, filtrable et exportable. */
export default function StockMovementsPage() {
  const [items, setItems] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ type: "", from: "", to: "", q: "", warehouseId: "", lot: "" });
  const { warehouses } = useWarehouses();
  const [q, setQ] = useState("");
  const LIMIT = 50;
  const params = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return p;
  }, [f]);
  useEffect(() => {
    fetch(`/api/stock/movements?${params({ page: String(page), limit: String(LIMIT) })}`, { credentials: "include" })
      .then(r => r.json()).then(d => { setItems(d.data?.items ?? []); setTotal(d.data?.pagination?.total ?? 0); }).catch(() => {});
  }, [page, params]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); setF(x => ({ ...x, q: q.trim() })); }, 300); return () => clearTimeout(t); }, [q]);

  return (
    <div className="space-y-5">
      <StockTabs />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title mt-1">Journal des mouvements</h1>
          <p className="text-sm text-ink2">{total} mouvement{total > 1 ? "s" : ""}</p>
        </div>
        <a href={`/api/stock/movements?${params({ format: "csv" })}`} className={buttonClass("secondary", "md")}><Download size={16} /> Exporter (CSV)</a>
      </div>
      <div className="flex gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="Motif ou n° de document" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select className={`${selectCls} w-auto`} value={f.type} onChange={e => { setPage(1); setF(x => ({ ...x, type: e.target.value })); }} aria-label="Type">
          <option value="">Tous types</option>{MOVEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{TYPE_LABEL[o.value]}</option>)}
          <option value="transfer">Transfert</option>
        </select>
        <select className={`${selectCls} w-auto`} value={f.warehouseId} onChange={e => { setPage(1); setF(x => ({ ...x, warehouseId: e.target.value })); }} aria-label="Entrepôt">
          <option value="">Tous entrepôts</option>{warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
        <input className={`${inputCls} w-36`} placeholder="N° de lot / série" value={f.lot} onChange={e => { setPage(1); setF(x => ({ ...x, lot: e.target.value.trim() })); }} aria-label="Lot" />
        <input type="date" className={`${inputCls} w-auto`} value={f.from} onChange={e => { setPage(1); setF(x => ({ ...x, from: e.target.value })); }} aria-label="Du" />
        <input type="date" className={`${inputCls} w-auto`} value={f.to} onChange={e => { setPage(1); setF(x => ({ ...x, to: e.target.value })); }} aria-label="Au" />
      </div>
      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th>Date</th><th>Article</th><th>Entrepôt</th><th>Type</th><th className="text-right">Qté</th><th className="text-right">Stock après</th><th className="text-right">Coût unit.</th><th>Motif / document</th><th>Par</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={9} className="text-center text-ink3 py-6">Aucun mouvement</td></tr>}
            {items.map(m => (
              <tr key={m._id} className={`border-t border-line ${m.reversedBy ? "opacity-50" : ""}`}>
                <td className="text-xs text-ink2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{m.productId ? <Link href={`/stock/${m.productId._id}`} className="hover:underline">{m.productId.label}<span className="block text-[11px] text-ink3 font-mono">{m.productId.code}</span></Link> : "—"}</td>
                <td className="text-xs">{m.warehouseId?.name ?? "—"}</td>
                <td>{TYPE_LABEL[m.type] ?? m.type}{m.reverses ? " (annulation)" : m.reversedBy ? " (annulé)" : ""}</td>
                <td className={`text-right font-mono font-semibold ${m.quantity > 0 ? "text-pos" : m.quantity < 0 ? "text-neg" : ""}`}>{m.quantity > 0 ? "+" : ""}{fmt(m.quantity)}</td>
                <td className="text-right font-mono">{fmt(m.quantityAfter)}</td>
                <td className="text-right font-mono text-xs">{m.unitCost ? fmt(m.unitCost) : "—"}</td>
                <td className="text-xs">{m.reason}{m.linkedDocNumber && <span className="text-section"> · {m.linkedDocNumber}</span>}
                  {m.lots && m.lots.length > 0 && <span className="block text-ink3 font-mono">{m.lots.map(l => `${l.lotNumber}:${l.qty > 0 ? "+" : ""}${l.qty}`).join(" ")}</span>}</td>
                <td className="text-xs text-ink2">{m.createdBy ? `${m.createdBy.firstName ?? ""} ${m.createdBy.lastName ?? ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
