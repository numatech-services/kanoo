"use client";
import { useEffect, useState } from "react";
import { FlowFilterBar, useFlowFilter, type FlowTotals } from "@/components/ui/FlowFilterBar";

interface Line { accountCode: string; accountLabel?: string; debit: number; credit: number; projectId?: string }
interface Entry { _id: string; entryDate: string; journalCode: string; reference: string; label: string; lines: Line[] }

const fmt = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} XOF`;

/**
 * Recettes et dépenses imputées à un projet (lignes de produits 7 / charges 6
 * portant ce projet), avec le filtre commun. Masqué sans accès au journal.
 */
export function ImputedFlows({ projectId }: { projectId: string }) {
  const filter = useFlowFilter();
  const [items, setItems] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<FlowTotals | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(filter.query);
    q.set("projectId", projectId);
    q.set("limit", "100");
    fetch(`/api/accounting-entries?${q}`, { credentials: "include" })
      .then(r => { if (!r.ok) { setDenied(true); return null; } return r.json(); })
      .then(d => { if (d) { setItems(d.data?.items ?? []); setTotals(d.data?.totals ?? null); } })
      .catch(() => setDenied(true));
  }, [projectId, filter.query]);
  if (denied) return null;

  // Part de chaque écriture qui concerne le projet : produits (+) et charges (−).
  const rows = items.flatMap(e => e.lines
    .filter(l => String(l.projectId ?? "") === projectId && /^[67]/.test(l.accountCode))
    .map((l, i) => ({ key: `${e._id}-${i}`, e, l, amount: l.accountCode.startsWith("7") ? l.credit - l.debit : -(l.debit - l.credit) })))
    .filter(r => (filter.flow === "in" ? r.amount > 0 && r.l.accountCode.startsWith("7") : filter.flow === "out" ? r.l.accountCode.startsWith("6") : true));

  return (
    <section className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-line space-y-3">
        <h2 className="font-semibold text-ink">Recettes et dépenses imputées</h2>
        <FlowFilterBar state={filter} totals={totals} size="sm" />
      </div>
      {rows.length === 0 ? <p className="px-5 py-6 text-sm text-ink3 text-center">Aucune écriture imputée pour ce filtre.</p> : (
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Compte</th><th className="text-right">Montant</th></tr></thead>
            <tbody>
              {rows.map(({ key, e, l, amount }) => (
                <tr key={key} className="border-t border-line">
                  <td className="text-xs whitespace-nowrap">{new Date(e.entryDate).toLocaleDateString("fr-FR")}</td>
                  <td className="text-xs font-mono">{e.journalCode}</td>
                  <td className="text-xs font-mono">{e.reference}</td>
                  <td className="text-xs">{e.label}</td>
                  <td className="text-xs text-ink2">{l.accountCode} {l.accountLabel ?? ""}</td>
                  <td className={`text-right font-mono text-xs ${amount >= 0 ? "text-pos" : "text-neg"}`}>{amount >= 0 ? "+" : "−"}{fmt(Math.abs(amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
