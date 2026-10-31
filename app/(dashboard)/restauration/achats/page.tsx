"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBasket, TrendingUp, TrendingDown, FileCheck2 } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${(Math.round(n * 100) / 100).toLocaleString("fr-FR")} FCFA`);
const DATE = (d: string) => new Date(d).toLocaleDateString("fr-FR");

interface Data {
  prices: Array<{ itemId: string; name: string; unit: string; last: { unitCost: number; date: string; supplier: string | null }; avg: number; min: number; max: number; purchases: number; changePct: number | null; best: string | null; savings: number;
    suppliers: Array<{ name: string; avg: number; last: number; lastDate: string; purchases: number }> }>;
  receptions: Array<{ _id: string; item: string; unit: string; supplier: string | null; quantity: number; unitCost: number; amount: number; date: string; reference: string | null }>;
  orders: Array<{ _id: string; number: string; supplier: string | null; totalTTC: number; status: string; date: string }>;
}

/**
 * Achats du restaurant : évolution et comparaison des prix d'achat (90 jours),
 * meilleur fournisseur et économie possible ; réceptions et commandes reçues
 * qui attendent leur facture, à rapprocher par le comptable.
 */
export default function AchatsPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [invoice, setInvoice] = useState("");
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const { data, loading, error, reload } = useApi<Data | null>(deskId ? `/api/restauration/achats?deskId=${deskId}` : null, d => (d?.data as Data) ?? null, null, { quiet: true });
  const totalPicked = (data?.receptions ?? []).filter(r => picked.includes(r._id)).reduce((t, r) => t + r.amount, 0);

  async function reconcile() {
    const r = await apiSend<{ error?: string; data?: { matched: number } }>("POST", "/api/restauration/achats", { deskId, ids: picked, invoiceRef: invoice });
    if (!r.ok) return showToast(r.data.error || "Rapprochement refusé", "error");
    showToast(`${r.data.data?.matched ?? 0} réception(s) rapprochée(s) de la facture ${invoice}`, "success");
    setPicked([]); setInvoice(""); reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><ShoppingBasket size={22} /> Achats</h1>
          <p className="text-sm text-ink2">Ce que coûtent vos achats, chez qui ils sont le moins chers, et ce qui attend encore sa facture.</p>
        </div>
        <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => { setPicked([]); setDeskId(e.target.value); }}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-48 surface-card animate-pulse" /> : !data ? null : <>
        <section className="surface-card p-4 space-y-2">
          <h2 className="font-semibold text-ink">Prix d&apos;achat des 90 derniers jours</h2>
          {!data.prices.length ? <p className="text-sm text-ink3">Aucun achat valorisé : les prix apparaissent à la réception en réserve ou à la réception d&apos;une commande.</p> : (
            <div className="overflow-x-auto"><table className="table-dense w-full">
              <thead><tr><th>Article</th><th className="text-right">Dernier prix</th><th className="text-right">Évolution</th><th className="text-right">Moyenne</th><th className="text-right">Plus bas / plus haut</th><th>Fournisseurs (moyenne)</th><th className="text-right">Économie possible</th></tr></thead>
              <tbody>{data.prices.map(p => (
                <tr key={p.itemId} className="border-t border-line">
                  <td>{p.name}<span className="block text-[11px] text-ink3">{p.purchases} achat(s), par {p.unit}</span></td>
                  <td className="text-right font-mono">{MONEY(p.last.unitCost)}<span className="block text-[11px] text-ink3">{DATE(p.last.date)}{p.last.supplier ? ` · ${p.last.supplier}` : ""}</span></td>
                  <td className={`text-right font-mono ${(p.changePct ?? 0) > 0 ? "text-neg" : (p.changePct ?? 0) < 0 ? "text-pos" : ""}`}>{p.changePct === null ? "—" : <>{p.changePct > 0 ? <TrendingUp size={12} className="inline" /> : p.changePct < 0 ? <TrendingDown size={12} className="inline" /> : null} {p.changePct > 0 ? "+" : ""}{p.changePct} %</>}</td>
                  <td className="text-right font-mono">{MONEY(p.avg)}</td>
                  <td className="text-right font-mono text-ink2">{MONEY(p.min)} / {MONEY(p.max)}</td>
                  <td className="text-sm">{p.suppliers.map((s, i) => <span key={s.name} className="block">{i === 0 && p.suppliers.length > 1 ? <Pill tone="pos">moins cher</Pill> : null} {s.name} : {MONEY(s.avg)} <span className="text-ink3 text-[11px]">({s.purchases})</span></span>)}</td>
                  <td className="text-right font-mono">{p.savings ? MONEY(p.savings) : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="text-[11px] text-ink3">Économie possible : ce qu&apos;auraient coûté les mêmes quantités au prix moyen du fournisseur le moins cher.</p>
        </section>

        <section className="surface-card p-4 space-y-3">
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><FileCheck2 size={16} /> Réceptions en attente de facture</h2>
          {!data.receptions.length ? <p className="text-sm text-ink3">Aucune : toutes les réceptions non payées en caisse sont rapprochées d&apos;une facture.</p> : <>
            <div className="overflow-x-auto"><table className="table-dense w-full">
              <thead><tr><th></th><th>Date</th><th>Article</th><th>Fournisseur</th><th className="text-right">Quantité</th><th className="text-right">Montant</th><th>Référence</th></tr></thead>
              <tbody>{data.receptions.map(r => (
                <tr key={r._id} className="border-t border-line">
                  <td><input type="checkbox" checked={picked.includes(r._id)} onChange={e => setPicked(x => e.target.checked ? [...x, r._id] : x.filter(y => y !== r._id))} aria-label="Choisir" /></td>
                  <td className="text-ink2">{DATE(r.date)}</td><td>{r.item}</td><td>{r.supplier ?? "—"}</td>
                  <td className="text-right font-mono">{r.quantity.toLocaleString("fr-FR")} {r.unit}</td>
                  <td className="text-right font-mono">{r.unitCost ? MONEY(r.amount) : <span className="text-warn text-xs">à valoriser</span>}</td>
                  <td className="text-ink2">{r.reference ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="flex flex-wrap gap-2 items-end">
              <FormField label="Numéro de la facture du fournisseur"><input className={inputCls} value={invoice} onChange={e => setInvoice(e.target.value)} /></FormField>
              <button disabled={!picked.length || !invoice.trim()} onClick={reconcile} className={buttonClass("primary", "md")}>Rapprocher {picked.length ? `(${picked.length}, ${MONEY(totalPicked)})` : ""}</button>
            </div>
            <p className="text-[11px] text-ink3">La facture elle-même se saisit dans Achats & stock → Factures et dépenses ; le rapprochement relie la réception à son numéro pour le comptable.</p>
          </>}
          {data.orders.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink mt-2">Commandes reçues sans facture d&apos;achat</p>
              <ul className="text-sm space-y-1">{data.orders.map(o => <li key={o._id}><Link href={`/commandes/${o._id}`} className="hover:text-section">{o.number}</Link> · {o.supplier ?? "—"} · {MONEY(o.totalTTC)} · {o.status === "received" ? "reçue" : "reçue en partie"}</li>)}</ul>
            </div>
          )}
        </section>
      </>}
    </div>
  );
}
