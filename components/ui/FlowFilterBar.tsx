"use client";
import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type FlowValue = "" | "in" | "out";
export interface FlowTotals { in: number; out: number; balance: number }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} XOF`;

/**
 * État du filtre commun (sens + période) et sa chaîne de requête.
 * `initial` : période de départ ; par défaut, aucune borne (tout l'historique).
 */
export function useFlowFilter(initial: { from?: string; to?: string } = {}) {
  const [flow, setFlow] = useState<FlowValue>("");
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (flow) q.set("flow", flow);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return q.toString();
  }, [flow, from, to]);
  return { flow, setFlow, from, setFrom, to, setTo, query };
}

export type FlowFilterState = ReturnType<typeof useFlowFilter>;

/** Premier jour du mois courant, au format des champs date. */
export const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
export const today = () => iso(new Date());

/**
 * Barre de filtre « Tout / Recettes / Dépenses » + période + totaux.
 * Les totaux portent sur la période, tous sens confondus ; un clic sur
 * Recettes ou Dépenses filtre la liste.
 */
export function FlowFilterBar({ state, totals, labels, size = "md" }: {
  state: FlowFilterState;
  totals?: FlowTotals | null;
  /** Libellés propres au module (ex. « Produits / Charges » en comptabilité). */
  labels?: { in: string; out: string };
  size?: "sm" | "md";
}) {
  const L = labels ?? { in: "Recettes", out: "Dépenses" };
  const { flow, setFlow, from, setFrom, to, setTo } = state;
  const dateCls = `${size === "sm" ? "h-8" : "h-9"} px-2 rounded-lg border border-line2 bg-surface text-sm text-ink`;
  const tile = (value: FlowValue, label: string, amount: number, tone: string) => (
    <button type="button" onClick={() => setFlow(flow === value ? "" : value)} aria-pressed={flow === value}
      className={`text-left rounded-lg border px-3 py-2 transition-colors ${flow === value ? "border-section bg-section-soft" : "border-line bg-surface hover:bg-surface2"}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink2">{label}</span>
      <span className={`block font-mono font-bold ${tone}`}>{money(amount)}</span>
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size={size} ariaLabel="Sens des mouvements" value={flow} onChange={setFlow}
          segments={[{ value: "", label: "Tout" }, { value: "in", label: L.in }, { value: "out", label: L.out }]} />
        <label className="inline-flex items-center gap-1 text-xs text-ink2">Du
          <input type="date" className={dateCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} aria-label="Date de début" />
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-ink2">au
          <input type="date" className={dateCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} aria-label="Date de fin" />
        </label>
        <button type="button" onClick={() => { setFrom(monthStart()); setTo(today()); }} className="text-xs text-section font-semibold hover:underline">Ce mois</button>
        {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="text-xs text-ink3 hover:text-ink">Toute la période</button>}
      </div>
      {totals && (
        <div className="grid grid-cols-3 gap-2 max-w-xl">
          {tile("in", L.in, totals.in, "text-pos")}
          {tile("out", L.out, totals.out, "text-neg")}
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink2">Solde</span>
            <span className={`block font-mono font-bold ${totals.balance < 0 ? "text-neg" : "text-ink"}`}>{money(totals.balance)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
