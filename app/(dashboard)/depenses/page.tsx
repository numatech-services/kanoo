"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Receipt } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { useMe, meCanDo } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
import { useUrlReady } from "@/lib/url-param";
interface Purchase {
  _id: string; number: string; kind: "invoice" | "cash"; date: string; dueDate?: string; payee?: string; supplierRef?: string;
  supplierId?: { name: string } | null; totalTTC: number; paidAmount: number; status: string;
  lines: Array<{ description: string }>;
}
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const STATUS: Record<string, string> = { draft: "Brouillon", validated: "À payer", partial: "Payé en partie", paid: "Payé", cancelled: "Annulé" };

export default function PurchasesPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "purchases", "create");
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ status: "", kind: "", from: "", to: "", q: "", due: "" });
  const [q, setQ] = useState("");
  const LIMIT = 25;

  // Filtres repris de l'adresse (liens du brief du jour, des pastilles…).
  const ready = useUrlReady(p => setF(x => ({ ...x, status: p.get("status") ?? "", due: p.get("due") ?? "", kind: p.get("kind") ?? "" })));
  const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const { data: { items, total, totals }, loading } = useApi(ready ? `/api/achats?${p}` : null, d => ({
    items: (d?.data?.items ?? []) as Purchase[],
    total: (d?.data?.pagination?.total ?? 0) as number,
    totals: (d?.data?.totals ?? { totalTTC: 0, paid: 0, remaining: 0 }) as { totalTTC: number; paid: number; remaining: number },
  }), { items: [], total: 0, totals: { totalTTC: 0, paid: 0, remaining: 0 } });
  useEffect(() => { const t = setTimeout(() => { setPage(1); setF(x => ({ ...x, q: q.trim() })); }, 300); return () => clearTimeout(t); }, [q]);
  const setFilter = (patch: Partial<typeof f>) => { setPage(1); setF(x => ({ ...x, ...patch })); };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><Receipt size={22} className="text-section" /> Factures & dépenses</h1>
          <p className="text-sm text-ink2">Factures fournisseurs, dépenses au comptant, imputées aux projets, secteurs et services.</p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link href="/depenses/nouvelle?kind=cash" className={buttonClass("secondary", "md")}>Dépense au comptant</Link>
            <Link href="/depenses/nouvelle" className={buttonClass("primary", "md")}><Plus size={16} /> Facture fournisseur</Link>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {[["Total (sélection)", totals.totalTTC, "text-ink"], ["Payé", totals.paid, "text-pos"], ["Reste à payer", totals.remaining, "text-neg"]].map(([k, v, c]) => (
          <div key={String(k)} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className={`text-xl font-bold mt-1 ${c}`}>{fmt(v)} FCFA</p></div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="N°, fournisseur, référence, libellé" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <select className={`${selectCls} w-auto`} value={f.status} onChange={e => setFilter({ status: e.target.value })} aria-label="Statut">
          <option value="">Tous statuts</option><option value="unpaid">À payer (tous)</option>
          {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={`${selectCls} w-auto`} value={f.kind} onChange={e => setFilter({ kind: e.target.value })} aria-label="Type">
          <option value="">Factures et dépenses</option><option value="invoice">Factures fournisseurs</option><option value="cash">Dépenses au comptant</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink2 px-2">
          <input type="checkbox" className="accent-section" checked={f.due === "overdue"} onChange={e => setFilter({ due: e.target.checked ? "overdue" : "" })} /> En retard
        </label>
        <input type="date" className={`${inputCls} w-auto`} value={f.from} onChange={e => setFilter({ from: e.target.value })} aria-label="Du" />
        <input type="date" className={`${inputCls} w-auto`} value={f.to} onChange={e => setFilter({ to: e.target.value })} aria-label="Au" />
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th>N°</th><th>Date</th><th>Fournisseur / bénéficiaire</th><th>Objet</th><th className="text-right">TTC</th><th className="text-right">Reste</th><th>Échéance</th><th>Statut</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} className="text-center text-ink3 py-8">{loading ? "Chargement…" : "Aucun achat"}</td></tr>}
            {items.map(p => {
              const overdue = p.dueDate && ["validated", "partial"].includes(p.status) && new Date(p.dueDate) < new Date();
              return (
                <tr key={p._id} className="border-t border-line hover:bg-surface2/30">
                  <td><Link href={`/depenses/${p._id}`} className="font-mono text-section hover:underline">{p.number}</Link><span className="block text-[11px] text-ink3">{p.kind === "cash" ? "comptant" : "facture"}</span></td>
                  <td className="text-xs">{new Date(p.date).toLocaleDateString("fr-FR")}</td>
                  <td>{p.supplierId?.name ?? p.payee ?? "—"}{p.supplierRef && <span className="block text-[11px] text-ink3">réf. {p.supplierRef}</span>}</td>
                  <td className="text-xs text-ink2 max-w-[16rem] truncate">{p.lines?.[0]?.description}{p.lines?.length > 1 ? ` (+${p.lines.length - 1})` : ""}</td>
                  <td className="text-right font-mono">{fmt(p.totalTTC)}</td>
                  <td className="text-right font-mono">{p.status === "cancelled" ? "—" : fmt(p.totalTTC - p.paidAmount)}</td>
                  <td className={`text-xs ${overdue ? "text-neg font-semibold" : ""}`}>{p.dueDate ? new Date(p.dueDate).toLocaleDateString("fr-FR") : "—"}</td>
                  <td><StatusBadge status={p.status} label={STATUS[p.status]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
