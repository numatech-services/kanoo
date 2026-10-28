"use client";
import { useState } from "react";
import { Tag, Plus, Trash2, Power } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";

const MONEY = (n: number | undefined) => (n === undefined ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
interface Promo {
  _id: string; name: string; kind: "percent" | "price"; value: number; itemIds?: string[]; category?: string; days?: number[];
  from?: string; to?: string; minQty?: number; startDate?: string; endDate?: string; active: boolean;
  effect: { quantity: number; revenueTTC: number; discount: number; margin?: number; tickets: number } | null;
}

/** Résumé lisible d'une promotion. */
function describe(p: Promo, names: Map<string, string>) {
  const what = p.itemIds?.length ? p.itemIds.map(i => names.get(i) ?? "?").join(", ") : `famille « ${p.category} »`;
  const how = p.kind === "percent" ? `−${p.value} %` : `à ${MONEY(p.value)}`;
  const when = [p.days?.length ? p.days.map(d => DAYS[d]).join(" ") : "", p.from && p.to ? `${p.from}–${p.to}` : "", p.minQty ? `dès ${p.minQty} unités` : "",
    p.endDate ? `jusqu'au ${new Date(p.endDate).toLocaleDateString("fr-FR")}` : ""].filter(Boolean).join(" · ");
  return `${what} ${how}${when ? ` — ${when}` : ""}`;
}

/**
 * Promotions du comptoir : happy hour, prix de gros, promo d'un jour. Le prix
 * s'applique seul au ticket ; l'effet se lit ici (quantités, remise accordée,
 * marge restante).
 */
export function PromosTab({ deskId }: { deskId: string }) {
  const { data, reload } = useApi<Promo[]>(`/api/comptoir/promos?deskId=${deskId}`, d => d?.data?.items ?? [], []);
  const { data: items } = useApi<Array<{ _id: string; name: string; category?: string; salePrice?: number }>>(`/api/comptoir/items?deskId=${deskId}`, d => d?.data ?? [], []);
  const [open, setOpen] = useState(false);
  const names = new Map(items.map(i => [i._id, i.name]));

  async function toggle(p: Promo) {
    const res = await apiSend("PATCH", `/api/comptoir/promos/${p._id}`, { active: !p.active });
    if (!res.ok) { showToast(res.data?.error || "Modification refusée.", "error"); return; }
    reload();
  }
  async function remove(p: Promo) {
    if (!(await confirmDialog({ title: `Supprimer « ${p.name} » ?`, danger: true }))) return;
    await apiSend("DELETE", `/api/comptoir/promos/${p._id}`); reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-sm text-ink2">Le meilleur prix applicable est pris automatiquement à l&apos;encaissement (sauf prix saisi à la main). Effet sur le mois en cours.</p>
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouvelle promotion</button>
      </div>
      {data.length === 0 ? <EmptyState icon={<Tag size={20} />} title="Aucune promotion" hint="Happy hour (17 h–19 h), prix de gros dès 6 bouteilles, promo du vendredi…" /> : (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Promotion</th><th className="text-right">Vendus</th><th className="text-right">CA</th><th className="text-right">Remise accordée</th><th className="text-right">Marge</th><th></th></tr></thead>
            <tbody>
              {data.map(p => (
                <tr key={p._id} className={p.active ? "" : "opacity-50"}>
                  <td className="text-ink font-medium">{p.name} {!p.active && <Pill tone="info">arrêtée</Pill>}<span className="block text-[11px] text-ink3 font-normal">{describe(p, names)}</span></td>
                  <td className="text-right font-mono">{p.effect?.quantity ?? 0}</td>
                  <td className="text-right font-mono">{MONEY(p.effect?.revenueTTC ?? 0)}</td>
                  <td className="text-right font-mono text-warn">{MONEY(p.effect?.discount ?? 0)}</td>
                  <td className={`text-right font-mono ${(p.effect?.margin ?? 0) < 0 ? "text-neg" : ""}`}>{MONEY(p.effect?.margin)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => toggle(p)} className="p-1.5 text-ink3 hover:text-section" title={p.active ? "Arrêter" : "Relancer"}><Power size={14} /></button>
                    <button onClick={() => remove(p)} className="p-1.5 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {open && <PromoDialog deskId={deskId} items={items} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function PromoDialog({ deskId, items, onClose, onDone }: { deskId: string; items: Array<{ _id: string; name: string; category?: string; salePrice?: number }>; onClose: () => void; onDone: () => void }) {
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))] as string[];
  const [f, setF] = useState({ name: "", target: "items", itemIds: [] as string[], category: cats[0] ?? "", kind: "percent", value: "", days: [] as number[], from: "", to: "", minQty: "", endDate: "" });
  async function save() {
    const res = await apiSend("POST", "/api/comptoir/promos", {
      deskId, name: f.name, kind: f.kind, value: Number(f.value),
      ...(f.target === "items" ? { itemIds: f.itemIds } : { category: f.category }),
      days: f.days, from: f.from || undefined, to: f.to || undefined, minQty: Number(f.minQty) || undefined, endDate: f.endDate || undefined,
    });
    if (!res.ok) { showToast(res.data?.error || "Promotion refusée.", "error"); return; }
    showToast("Promotion créée.", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Nouvelle promotion" size="md">
      <div className="space-y-4">
        <FormField label="Nom" required><input className={inputCls} maxLength={80} placeholder="Happy hour bières" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="S'applique à"><select className={selectCls} value={f.target} onChange={e => setF(p => ({ ...p, target: e.target.value }))}><option value="items">Des articles</option>{cats.length > 0 && <option value="category">Une famille</option>}</select></FormField>
          {f.target === "category" && <FormField label="Famille"><select className={selectCls} value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))}>{cats.map(c => <option key={c}>{c}</option>)}</select></FormField>}
        </div>
        {f.target === "items" && (
          <div className="max-h-40 overflow-y-auto border border-line rounded-lg p-2 grid grid-cols-2 gap-1 text-sm">
            {items.map(i => <label key={i._id} className="inline-flex items-center gap-2"><input type="checkbox" className="accent-section" checked={f.itemIds.includes(i._id)} onChange={e => setF(p => ({ ...p, itemIds: e.target.checked ? [...p.itemIds, i._id] : p.itemIds.filter(x => x !== i._id) }))} />{i.name}</label>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type"><select className={selectCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value }))}><option value="percent">Remise en %</option><option value="price">Prix imposé (TTC)</option></select></FormField>
          <FormField label={f.kind === "percent" ? "Remise (%)" : "Prix unitaire (FCFA)"} required><input type="number" min={0} className={inputCls} value={f.value} onChange={e => setF(p => ({ ...p, value: e.target.value }))} /></FormField>
        </div>
        <FormField label="Jours (aucun : tous les jours)">
          <div className="flex gap-1 flex-wrap">{DAYS.map((d, i) => <button type="button" key={d} onClick={() => setF(p => ({ ...p, days: p.days.includes(i) ? p.days.filter(x => x !== i) : [...p.days, i] }))} className={`px-2 h-8 rounded-md border text-xs ${f.days.includes(i) ? "border-section bg-section/10 text-section" : "border-line2 text-ink2"}`}>{d}</button>)}</div>
        </FormField>
        <div className="grid grid-cols-3 gap-2">
          <FormField label="De"><input type="time" className={inputCls} value={f.from} onChange={e => setF(p => ({ ...p, from: e.target.value }))} /></FormField>
          <FormField label="À"><input type="time" className={inputCls} value={f.to} onChange={e => setF(p => ({ ...p, to: e.target.value }))} /></FormField>
          <FormField label="Dès (quantité)" hint="Prix de gros"><input type="number" min={0} className={inputCls} value={f.minQty} onChange={e => setF(p => ({ ...p, minQty: e.target.value }))} /></FormField>
        </div>
        <FormField label="Jusqu'au (facultatif)"><input type="date" className={inputCls} value={f.endDate} onChange={e => setF(p => ({ ...p, endDate: e.target.value }))} /></FormField>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button onClick={save} disabled={!f.name || f.value === ""} className={buttonClass("primary", "md")}>Créer</button></div>
      </div>
    </Modal>
  );
}
