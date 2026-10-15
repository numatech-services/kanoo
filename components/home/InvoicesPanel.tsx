"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, ClientAvatar } from "@/components/home/primitives";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { api, apiErrorMessage } from "@/lib/api-client";
import type { HomeData, HomeInvoice } from "@/lib/dashboard-home";

type Filter = "all" | "overdue" | "draft" | "sent" | "paid";
const FILTERS: Array<[Filter, string]> = [["all", "Toutes"], ["overdue", "En retard"], ["draft", "Brouillons"], ["sent", "Envoyées"], ["paid", "Payées"]];
const STATUS: Record<string, [string, string]> = {
  draft: ["Brouillon", "bg-surface2 text-ink2"], sent: ["Envoyée", "bg-info-50 text-info"], partial: ["Part. payée", "bg-warn-50 text-warn"],
  overdue: ["En retard", "bg-neg-50 text-neg"], paid: ["Payée", "bg-pos-50 text-pos"], cancelled: ["Annulée", "bg-surface2 text-ink3"],
  written_off: ["Irrécouvrable", "bg-neg-50 text-neg"],
};
const match = (f: Filter, i: HomeInvoice) => f === "all" ? i.status !== "cancelled" : f === "sent" ? ["sent", "partial"].includes(i.status) : i.status === f;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—");

/** Dernières factures, filtrables, avec le geste suivant de chacune. */
export function InvoicesPanel({ inv }: { inv: NonNullable<HomeData["invoices"]> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const rows = inv.items.filter(i => match(filter, i)).slice(0, 8);

  async function send(i: HomeInvoice) {
    if (!(await confirmDialog({ title: `Émettre la facture ${i.number} ?`, message: "Elle devient opposable et entre en comptabilité.", confirmLabel: "Émettre" }))) return;
    setBusy(i._id);
    try { await api.post(`/api/invoices/${i._id}/send`); showToast(`Facture ${i.number} émise.`, "success"); router.refresh(); }
    catch (e) { showToast(apiErrorMessage(e, "Émission impossible."), "error"); }
    finally { setBusy(null); }
  }

  return (
    <Card className="min-w-0 !px-0 !pb-2">
      <div className="px-[22px] sm:px-6 flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">Factures</h2>
        <Link href="/invoices" className="text-[13px] font-semibold text-accent hover:underline">Toutes les factures →</Link>
      </div>
      <div className="px-[22px] sm:px-6 flex gap-2 flex-wrap mb-3" role="group" aria-label="Filtrer les factures">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border inline-flex items-center gap-1.5 ${filter === k ? "grad-brand border-transparent" : "bg-surface border-line text-ink2 hover:bg-surface2"}`}>
            {l} <span className={`num ${filter === k ? "opacity-80" : "text-ink3"}`}>{inv.counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[11.5px] text-ink3 border-y border-line bg-surface2/50">
            <th className="font-semibold py-2 pl-6 pr-2">Client</th><th className="font-semibold px-2 hidden sm:table-cell">N°</th><th className="font-semibold px-2 hidden sm:table-cell">Échéance</th>
            <th className="font-semibold px-2 text-right">Reste dû</th><th className="font-semibold px-2 hidden md:table-cell">Statut</th><th className="pr-6" />
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="text-center text-ink3 py-8">Aucune facture dans ce filtre.</td></tr>}
            {rows.map(i => {
              const [label, cls] = STATUS[i.status] ?? STATUS.sent;
              return (
                <tr key={i._id} className="border-b border-line last:border-0 hover:bg-surface2/50">
                  <td className="py-2.5 pl-6 pr-2"><span className="flex items-center gap-2.5 min-w-0"><ClientAvatar name={i.client} size={30} /><span className="min-w-0"><span className="block truncate max-w-[150px] lg:max-w-[170px] 2xl:max-w-[240px] font-medium text-ink" title={i.client}>{i.client}</span><span className="sm:hidden block text-[11px] text-ink3 font-mono">{i.number} · {day(i.dueDate)}</span></span></span></td>
                  <td className="px-2 whitespace-nowrap hidden sm:table-cell"><Link href={`/invoices/${i._id}`} className="font-mono text-[12px] text-ink3 hover:text-accent">{i.number}</Link></td>
                  <td className={`px-2 whitespace-nowrap hidden sm:table-cell ${i.status === "overdue" ? "text-neg font-semibold" : "text-ink3"}`}>{day(i.dueDate)}</td>
                  <td className={`px-2 text-right num font-bold whitespace-nowrap ${i.status === "cancelled" ? "line-through text-ink3 font-medium" : i.status === "overdue" ? "text-neg" : "text-ink"}`}>{i.remaining.toLocaleString("fr-FR")}</td>
                  <td className="px-2 hidden md:table-cell"><span className={`pill pill-dot ${cls}`}>{label}</span></td>
                  <td className="pr-6 pl-2 text-right whitespace-nowrap">
                    {i.status === "draft" && <button type="button" disabled={busy === i._id} onClick={() => send(i)} className="h-8 px-3.5 rounded-full border border-accent/40 text-accent text-[12.5px] font-semibold hover:bg-accent-50 disabled:opacity-60">Envoyer</button>}
                    {["sent", "partial"].includes(i.status) && <Link href={`/invoices/${i._id}`} className="h-8 px-3.5 rounded-full border border-line2 text-ink text-[12.5px] font-semibold hover:bg-surface2 inline-flex items-center">Encaisser</Link>}
                    {i.status === "overdue" && <Link href={`/invoices/${i._id}`} className="h-8 px-3.5 rounded-full grad-brand text-[12.5px] font-semibold inline-flex items-center hover:brightness-105">Relancer</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
