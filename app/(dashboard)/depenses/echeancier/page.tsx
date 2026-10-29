"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarClock, AlertTriangle, Wallet, ListOrdered, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard, PillTabs } from "@/components/ui/MetricCard";
import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
import { csvCell } from "@/lib/csv";
import { AGING_LABEL, type AgingBucket } from "@/lib/automations";

const BUCKETS: AgingBucket[] = ["overdue_90", "overdue_60", "overdue_30", "overdue", "due_7", "due_30", "later", "no_date"];
const MONEY = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const SHORT: Record<AgingBucket, string> = { overdue_90: "> 90 j", overdue_60: "61-90 j", overdue_30: "31-60 j", overdue: "1-30 j", due_7: "≤ 7 j", due_30: "8-30 j", later: "> 30 j", no_date: "Sans date" };
const TONE: Record<AgingBucket, string> = { overdue_90: "text-neg font-semibold", overdue_60: "text-neg", overdue_30: "text-neg", overdue: "text-warn", due_7: "text-warn", due_30: "text-ink", later: "text-ink2", no_date: "text-ink3" };

interface Row { _id: string; number: string; date: string; dueDate: string | null; effectiveDue: string; assumedDue: boolean; supplier: string; totalTTC: number; paid: number; remaining: number; bucket: AgingBucket }
interface Data {
  rows: Row[];
  bySupplier: Array<{ supplierId: string | null; supplier: string; buckets: Record<AgingBucket, number>; total: number; count: number }>;
  totals: Record<AgingBucket, number>; total: number; overdue: number; ledger: number;
}

/**
 * Échéancier des factures fournisseurs et balance âgée : ce qui est en
 * retard, ce qui tombe dans la semaine, et l'ancienneté de la dette par fournisseur.
 */
export default function SupplierSchedulePage() {
  const [tab, setTab] = useState<"schedule" | "aging">("schedule");
  const { data } = useApi<Data | null>("/api/achats/echeancier", d => d?.data ?? null, null);

  function exportCsv() {
    if (!data) return;
    const lines = tab === "schedule"
      ? [["Échéance", "Facture", "Fournisseur", "TTC", "Payé", "Reste à payer", "Situation"], ...data.rows.map(r => [new Date(r.effectiveDue).toLocaleDateString("fr-FR") + (r.assumedDue ? " (supposée)" : ""), r.number, r.supplier, r.totalTTC, r.paid, r.remaining, AGING_LABEL[r.bucket]])]
      : [["Fournisseur", ...BUCKETS.map(b => AGING_LABEL[b]), "Total"], ...data.bySupplier.map(s => [s.supplier, ...BUCKETS.map(b => s.buckets[b]), s.total])];
    const csv = "﻿" + lines.map(l => l.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = tab === "schedule" ? "echeancier-fournisseurs.csv" : "balance-agee-fournisseurs.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const due7 = data ? data.totals.due_7 : 0;
  return (
    <div className="space-y-5">
      <PageHeader title="Échéancier fournisseurs" subtitle="Factures fournisseurs non soldées : ce qui est en retard, ce qui tombe cette semaine, et l'ancienneté de la dette par fournisseur."
        back={{ href: "/depenses", label: "Factures & dépenses" }}
        actions={data && data.rows.length > 0 && <button onClick={exportCsv} className={buttonClass("secondary", "md")}>Export CSV</button>} />

      {!data ? <div className="h-48 surface-card animate-pulse" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricCard icon={<Wallet size={18} />} tone="blue" label="Reste à payer" value={MONEY(data.total)} sub={`${data.rows.length} facture(s)`} />
            <MetricCard icon={<AlertTriangle size={18} />} tone="red" label="En retard" value={MONEY(data.overdue)} sub={`${data.rows.filter(r => r.bucket.startsWith("overdue")).length} facture(s) échue(s)`} />
            <MetricCard icon={<CalendarClock size={18} />} tone="amber" label="À payer sous 7 jours" value={MONEY(due7)} sub={`${data.rows.filter(r => r.bucket === "due_7").length} facture(s)`} />
          </div>

          <PillTabs label="Vue" value={tab} onChange={setTab} tabs={[
            { key: "schedule", label: "Échéancier", icon: <ListOrdered size={15} />, count: data.rows.length || null },
            { key: "aging", label: "Balance âgée", icon: <Users size={15} />, count: data.bySupplier.length || null },
          ]} />

          {data.rows.length === 0 ? <p className="surface-card p-6 text-sm text-ink3">Aucune facture fournisseur à payer.</p> : tab === "schedule" ? (
            <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead><tr><th>Échéance</th><th>Facture</th><th>Fournisseur</th><th className="text-right">TTC</th><th className="text-right">Payé</th><th className="text-right">Reste à payer</th><th>Situation</th><th></th></tr></thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r._id} className="border-t border-line">
                      <td className="whitespace-nowrap">{new Date(r.effectiveDue).toLocaleDateString("fr-FR")}{r.assumedDue && <span className="block text-[11px] text-ink3">supposée (facture + 30 j)</span>}</td>
                      <td><Link href={`/depenses/${r._id}`} className="text-section hover:underline">{r.number}</Link></td>
                      <td className="text-ink">{r.supplier}</td>
                      <td className="text-right font-mono">{MONEY(r.totalTTC)}</td>
                      <td className="text-right font-mono text-ink2">{MONEY(r.paid)}</td>
                      <td className="text-right font-mono font-semibold">{MONEY(r.remaining)}</td>
                      <td className={`text-xs ${TONE[r.bucket]}`}>{AGING_LABEL[r.bucket]}</td>
                      <td><Link href={`/depenses/${r._id}`} className={buttonClass("secondary", "sm")}>Payer</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          ) : (
            <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead><tr><th>Fournisseur</th>{BUCKETS.map(b => <th key={b} className={`text-right ${TONE[b]}`} title={AGING_LABEL[b]}>{SHORT[b]}</th>)}<th className="text-right">Total</th></tr></thead>
                <tbody>
                  {data.bySupplier.map(s => (
                    <tr key={s.supplierId ?? s.supplier} className="border-t border-line">
                      <td className="text-ink">{s.supplierId ? <Link href={`/suppliers/${s.supplierId}`} className="hover:underline">{s.supplier}</Link> : s.supplier}</td>
                      {BUCKETS.map(b => <td key={b} className={`text-right font-mono ${s.buckets[b] ? TONE[b] : "text-ink3"}`}>{s.buckets[b] ? MONEY(s.buckets[b]) : "—"}</td>)}
                      <td className="text-right font-mono font-semibold">{MONEY(s.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold">
                    <td>Total</td>{BUCKETS.map(b => <td key={b} className="text-right font-mono">{data.totals[b] ? MONEY(data.totals[b]) : "—"}</td>)}<td className="text-right font-mono">{MONEY(data.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div></div>
          )}
          <p className={`text-xs ${Math.abs(data.ledger - data.total) >= 1 ? "text-warn" : "text-ink3"}`}>Solde des comptes fournisseurs en comptabilité (40) : {MONEY(data.ledger)}{Math.abs(data.ledger - data.total) >= 1 ? ` — écart de ${MONEY(data.ledger - data.total)} avec l'échéancier : retenues à la source, immobilisations achetées à crédit, à-nouveaux ou écritures diverses que l'échéancier ne voit pas (à justifier avec le cabinet).` : " : concorde avec l'échéancier."}</p>
          <p className="text-xs text-ink3">« En retard » : échéance dépassée. Une facture sans échéance est vieillie à partir de sa date plus 30 jours : renseignez sa vraie échéance.</p>
        </>
      )}
    </div>
  );
}
