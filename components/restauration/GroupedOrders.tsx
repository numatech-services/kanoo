"use client";
import { useState } from "react";
import { CalendarRange, Plus, Trash2, ArrowLeftRight } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";

const MONEY = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
interface Line { key: string; name: string; unit: string; packSize: number | null; total: number; centralTotal: number | null; sites: Array<{ deskId: string; name: string; itemId: string; quantity: number }>; transfers: Array<{ from: string; to: string; quantity: number }> }
interface Data { desks: Array<{ _id: string; name: string }>; suppliers: Array<{ supplier: string; supplierId: string | null; value: number; lines: Line[] }>; value: number; events: Array<{ _id: string; label: string; from: string; to: string; factor: number; deskIds: string[] }> }

/**
 * Préparer la semaine : les besoins de tous les sites par fournisseur, arrondis
 * au carton, les transferts possibles avant d'acheter, et les événements qui
 * changent la demande d'un site. Les quantités restent modifiables.
 */
export function GroupedOrders() {
  const { data, reload } = useApi<Data | null>("/api/restauration/groupes", d => (d?.data as Data) ?? null, null, { quiet: true });
  const op = useOpKey();
  const [over, setOver] = useState<Record<string, string>>({});
  const [ev, setEv] = useState({ label: "", from: "", to: "", pct: "", deskId: "" });
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const qty = (s: { itemId: string; quantity: number }) => over[s.itemId] !== undefined ? Number(over[s.itemId].replace(",", ".")) || 0 : s.quantity;
  async function order() {
    setBusy(true);
    const lines = data!.suppliers.filter(s => s.supplierId).flatMap(s => s.lines.flatMap(l => l.sites.map(x => ({ deskId: x.deskId, itemId: x.itemId, quantity: qty(x) }))));
    const r = await apiSend<{ error?: string; data?: { orders: number; noSupplier: number } }>("POST", "/api/restauration/groupes", { action: "orders", lines }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast(`${r.data.data?.orders ?? 0} bon(s) de commande brouillon créé(s)`, "success"); setOver({}); reload();
  }
  async function addEvent() {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/groupes", { action: "event", label: ev.label, from: ev.from, to: ev.to || ev.from, factor: 1 + (Number(ev.pct.replace(",", ".")) || 0) / 100, deskIds: ev.deskId ? [ev.deskId] : [] });
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    showToast("Événement enregistré", "success"); setEv({ label: "", from: "", to: "", pct: "", deskId: "" }); reload();
  }
  async function delEvent(id: string) {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/groupes", { action: "deleteEvent", id });
    if (r.ok) reload();
  }
  return (
    <section className="surface-card p-4 space-y-3" id="semaine">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><CalendarRange size={16} /> Préparer la semaine : tous les sites</h2>
        <span className="text-sm text-ink2">Estimation : <b className="font-mono">{MONEY(data.value)}</b></span>
      </div>
      {!data.suppliers.length ? <p className="text-sm text-ink3">Aucun besoin pour l&apos;instant : les seuils et les ventes n&apos;appellent pas de commande.</p> : data.suppliers.map(s => (
        <div key={s.supplier} className="rounded-lg border border-line p-3 space-y-2">
          <p className="font-semibold text-sm">{s.supplier} <span className="text-ink3 font-normal">· {MONEY(s.value)}</span></p>
          {s.lines.map(l => (
            <div key={l.key} className="text-sm space-y-1">
              <p>{l.name} : <b className="font-mono">{l.total} {l.unit}</b>{l.packSize ? <span className="text-ink3"> ({Math.ceil(l.total / l.packSize)} carton(s) de {l.packSize})</span> : null}{l.centralTotal !== null ? <span className="text-ink3"> · livré à un seul site puis transféré : {l.centralTotal} suffiraient</span> : null}</p>
              <div className="flex gap-3 flex-wrap">{l.sites.map(x => <label key={x.itemId} className="inline-flex items-center gap-1.5 text-[12px] text-ink2">{x.name}<input className={`${inputCls} w-20`} inputMode="decimal" value={over[x.itemId] ?? String(x.quantity)} onChange={e => setOver(o => ({ ...o, [x.itemId]: e.target.value }))} aria-label={`Quantité pour ${x.name}`} /></label>)}</div>
              {l.transfers.map((t, i) => <p key={i} className="text-[12px] text-ink2 inline-flex items-center gap-1"><ArrowLeftRight size={12} /> Avant d&apos;acheter : {t.from} peut céder {t.quantity} {l.unit} à {t.to}.</p>)}
            </div>
          ))}
        </div>
      ))}
      {data.suppliers.some(s => !s.supplierId) && <p className="text-[12px] text-warn">Les articles sans fournisseur habituel restent à commander à la main : renseignez leur fournisseur dans le catalogue.</p>}
      {data.suppliers.some(s => s.supplierId) && <button disabled={busy} onClick={order} className={buttonClass("primary", "sm")}>Créer les bons de commande</button>}
      <div className="border-t border-line pt-3 space-y-2">
        <p className="text-sm font-semibold">Événements qui changent la demande</p>
        {data.events.map(e => <p key={e._id} className="text-sm flex items-center justify-between gap-2"><span>{e.label} · {e.from} → {e.to} · {e.factor >= 1 ? "+" : ""}{Math.round((e.factor - 1) * 100)} % · {e.deskIds.length ? data.desks.filter(d => e.deskIds.includes(d._id)).map(d => d.name).join(", ") : "tous les sites"}</span><button onClick={() => delEvent(e._id)} className={buttonClass("ghost", "sm")} aria-label={`Retirer ${e.label}`}><Trash2 size={14} /></button></p>)}
        <div className="grid gap-2 sm:grid-cols-5 items-end">
          <FormField label="Événement"><input className={inputCls} value={ev.label} onChange={e => setEv({ ...ev, label: e.target.value })} placeholder="Vacances, Tabaski…" /></FormField>
          <FormField label="Du"><input type="date" className={inputCls} value={ev.from} onChange={e => setEv({ ...ev, from: e.target.value })} /></FormField>
          <FormField label="Au"><input type="date" className={inputCls} value={ev.to} onChange={e => setEv({ ...ev, to: e.target.value })} /></FormField>
          <FormField label="Variation (%)"><input className={inputCls} inputMode="numeric" value={ev.pct} onChange={e => setEv({ ...ev, pct: e.target.value })} placeholder="-80" /></FormField>
          <FormField label="Site"><select className={selectCls} value={ev.deskId} onChange={e => setEv({ ...ev, deskId: e.target.value })}><option value="">Tous</option>{data.desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
        </div>
        <button onClick={addEvent} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter l&apos;événement</button>
      </div>
    </section>
  );
}
