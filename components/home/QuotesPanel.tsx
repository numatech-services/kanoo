import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { HomeData } from "@/lib/dashboard-home";
import { formatMoney } from "@/lib/format";

/** Devis et proformas : des propositions, pas du chiffre d'affaires. Montants à part des factures. */
export function QuotesPanel({ q }: { q: NonNullable<HomeData["quotes"]> }) {
  const rows: Array<[string, { value: number; count: number }, string, string?]> = [
    ["Devis en attente de réponse", q.pending, "/devis?status=sent"],
    ["Proformas en attente", q.proformas, "/devis?status=sent"],
    ["Acceptés, à facturer", q.accepted, "/devis?status=accepted", "text-pos"],
    ["Refusés (12 mois)", q.rejected, "/devis?status=rejected", "text-ink3"],
  ];
  return (
    <section className="surface-card p-5" aria-label="Devis et proformas">
      <h2 className="text-[16px] font-bold tracking-tight text-ink inline-flex items-center gap-2"><ClipboardList size={17} /> Devis et proformas</h2>
      <p className="text-[11px] text-ink3 mb-2">Montants TTC proposés, non comptés dans les factures.</p>
      <div className="divide-y divide-line">
        {rows.map(([label, v, href, tone]) => (
          <Link key={label} href={href} className="flex justify-between gap-3 py-2 text-sm hover:bg-surface2 rounded">
            <span className="text-ink2">{label} <span className="text-ink3">· {v.count}</span></span>
            <span className={`font-mono whitespace-nowrap ${tone ?? "text-ink"}`}>{formatMoney(v.value)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
