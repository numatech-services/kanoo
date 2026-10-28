"use client";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { formatMoney } from "@/lib/format";

interface Row { key: string; label: string; expense: number; revenue: number; payroll: number; purchases: number; result: number }

/** Charges et produits HT par service (centres de coût), sur la période du filtre. */
export function CostCenterReport({ from, to }: { from?: string; to?: string }) {
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data } = useApi<Row[]>(`/api/reports/cost-centers?${q}`, d => d?.data?.items ?? [], [], { quiet: true });
  return (
    <section className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Par service</h2>
        <Link href="/settings/rh" className="text-xs text-section hover:underline">Gérer les services</Link>
      </div>
      {data.length === 0 ? <p className="text-sm text-ink3 p-6 text-center">Aucune écriture imputée à un service sur la période.</p> : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr className="bg-surface2/50"><th>Service</th><th className="text-right">Charges</th><th className="text-right">dont paie</th><th className="text-right">dont achats</th><th className="text-right">Produits</th></tr></thead>
            <tbody>
              {data.map(r => (
                <tr key={r.key} className="border-t border-line">
                  <td className={`px-4 py-2.5 font-medium ${r.key === "_none" ? "text-ink3" : "text-ink"}`}>{r.label}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(r.expense)}</td>
                  <td className="px-4 py-2.5 text-right text-ink2">{formatMoney(r.payroll)}</td>
                  <td className="px-4 py-2.5 text-right text-ink2">{formatMoney(r.purchases)}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
