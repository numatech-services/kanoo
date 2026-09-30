"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { inputCls } from "@/components/ui/FormField";

export interface LotRow { lotNumber: string; expiryDate: string; qty: number }

/**
 * Saisie des lots (numéro, péremption, quantité) ou des numéros de série
 * (un par ligne) pour une entrée de stock.
 */
export function LotsEditor({ mode, quantity, value, onChange }: {
  mode: "lot" | "serial"; quantity: number; value: LotRow[]; onChange: (v: LotRow[]) => void;
}) {
  const [serials, setSerials] = useState(value.map(v => v.lotNumber).join("\n"));
  useEffect(() => {
    if (mode !== "serial") return;
    const list = serials.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    onChange(list.map(s => ({ lotNumber: s, expiryDate: "", qty: 1 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serials, mode]);

  if (mode === "serial") {
    const n = serials.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).length;
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold text-ink2">Numéros de série (un par ligne)</p>
        <textarea className={`${inputCls} font-mono`} rows={Math.min(8, Math.max(3, quantity))} value={serials} onChange={e => setSerials(e.target.value)} />
        <p className={`text-[11px] ${n === quantity ? "text-pos" : "text-warn"}`}>{n} numéro(s) saisi(s) pour {quantity} unité(s).</p>
      </div>
    );
  }
  const total = value.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const set = (i: number, patch: Partial<LotRow>) => onChange(value.map((l, j) => j === i ? { ...l, ...patch } : l));
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-ink2">Lots</p>
      {value.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <input className={`${inputCls} col-span-5`} placeholder="N° de lot" value={l.lotNumber} onChange={e => set(i, { lotNumber: e.target.value })} aria-label="Numéro de lot" />
          <input type="date" className={`${inputCls} col-span-4`} value={l.expiryDate} onChange={e => set(i, { expiryDate: e.target.value })} aria-label="Péremption" />
          <input type="number" min={0} step="any" className={`${inputCls} col-span-2`} value={l.qty || ""} onChange={e => set(i, { qty: Number(e.target.value) })} aria-label="Quantité du lot" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="col-span-1 text-ink3 hover:text-neg" aria-label="Retirer"><X size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { lotNumber: "", expiryDate: "", qty: Math.max(0, quantity - total) }])} className="text-xs text-section font-semibold hover:underline">+ Ajouter un lot</button>
      <p className={`text-[11px] ${total === quantity ? "text-pos" : "text-warn"}`}>Total des lots : {total} / {quantity}</p>
    </div>
  );
}

export const lotsPayload = (rows: LotRow[]) => rows.filter(r => r.lotNumber.trim() && r.qty > 0).map(r => ({ lotNumber: r.lotNumber.trim(), expiryDate: r.expiryDate || undefined, qty: r.qty }));
