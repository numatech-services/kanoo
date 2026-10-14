"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";
import { formatMoney, formatDate } from "@/lib/format";

interface Data { year: number; total: number; items: Array<{ _id: string; date: string; net: number; withheld: number; invoiceNumber?: string; client?: string }> }

/** Retenues subies sur nos encaissements (marchés publics) : créance sur l'État, imputable sur l'IS/BIC. */
export function SufferedWithholdings() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { apiJson(`/api/fiscal/retenues-subies?annee=${new Date().getFullYear()}`).then(r => r?.success !== false && setD(r.data)); }, []);
  if (!d) return null;
  return (
    <section className="surface-card p-5 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Retenues subies sur vos encaissements — {d.year}</h2>
          <p className="text-xs text-ink2 mt-0.5">Prélevées par vos clients (marchés publics) et versées à l&apos;État pour votre compte : à imputer sur l&apos;IS/BIC (compte 449200).</p>
        </div>
        <p className="text-right"><span className="block text-xs text-ink3">Total imputable</span><span className="num text-xl font-bold text-ink">{formatMoney(d.total)}</span></p>
      </div>
      {d.items.length === 0 ? <p className="text-sm text-ink3">Aucune retenue subie cette année. Elle se saisit avec l&apos;encaissement (champ « Retenue à la source subie »).</p> : (
        <div className="overflow-x-auto"><table className="table-dense">
          <thead><tr><th>Date</th><th>Facture</th><th>Client</th><th className="text-right">Net reçu</th><th className="text-right">Retenue</th></tr></thead>
          <tbody>{d.items.map(i => (
            <tr key={i._id}><td>{formatDate(i.date)}</td><td className="font-mono text-xs">{i.invoiceNumber ?? "—"}</td><td>{i.client ?? "—"}</td>
              <td className="text-right num">{formatMoney(i.net)}</td><td className="text-right num font-semibold">{formatMoney(i.withheld)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
