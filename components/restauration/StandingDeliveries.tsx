"use client";
import { useEffect, useState } from "react";
import { Croissant, Check, Banknote, Flame, Plus, Trash2, Save } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const DAYS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];

interface Row { _id: string; name: string; unit: string; supplier: string | null; expected: number; received: number | null; paid: boolean; toDesk: boolean; amount?: number | null }

/**
 * Livraisons du jour (pain du matin…) : on confirme à l'arrivée (quantité
 * corrigée au besoin), on paie le soir depuis la caisse. Et la bouteille de
 * gaz entamée, d'un geste.
 */
export function TodayDeliveries({ deskId, onChange, big = false }: { deskId: string; onChange?: () => void; big?: boolean }) {
  const day = today();
  const { data, reload } = useApi<Row[]>(deskId ? `/api/restauration/livraisons?deskId=${deskId}&day=${day}` : null, d => (d?.data as Row[]) ?? [], [], { quiet: true });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const op = useOpKey();
  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/livraisons", { deskId, day, ...body }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Action refusée", "error");
    op.done(); showToast(done, "success"); reload(); onChange?.();
  }
  const h = big ? "h-12 text-base" : "";
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink inline-flex items-center gap-2"><Croissant size={16} /> Livraisons du jour</p>
        <button disabled={busy} onClick={async () => { if (await confirmDialog("Une nouvelle bouteille de gaz est mise en service (la précédente est vide) ?")) post({ action: "gas" }, "Bouteille de gaz notée"); }} className={buttonClass("secondary", "sm")}><Flame size={14} /> Bouteille de gaz entamée</button>
      </div>
      {!data.length ? <p className="text-sm text-ink3">Aucune livraison permanente réglée (Restauration → Achats).</p> : data.map(r => (
        <div key={r._id} className="rounded-lg border border-line p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{r.name}{r.supplier ? <span className="text-ink3 font-normal"> — {r.supplier}</span> : null}</p>
            {r.paid ? <Pill tone="pos">payé</Pill> : r.received !== null ? <Pill tone="warn">reçu, à payer ce soir</Pill> : <Pill tone="info">attendu</Pill>}
          </div>
          {r.received === null ? (
            <div className="flex gap-2 items-center flex-wrap">
              <input className={`${inputCls} w-28 ${h}`} inputMode="decimal" placeholder={String(r.expected)} value={qty[r._id] ?? ""} onChange={e => setQty(q => ({ ...q, [r._id]: e.target.value }))} aria-label={`Quantité reçue de ${r.name}`} />
              <span className="text-sm text-ink2">{r.unit} (attendu : {r.expected})</span>
              <button disabled={busy} onClick={() => post({ action: "confirm", id: r._id, quantity: qty[r._id]?.trim() ? Number(qty[r._id].replace(",", ".")) : undefined }, `${r.name} reçu${r.toDesk ? " et monté au comptoir" : " en réserve"}`)} className={`${buttonClass("primary", "sm")} ${h}`}><Check size={14} /> Reçu</button>
            </div>
          ) : (
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-sm text-ink2">Reçu : {r.received} {r.unit}{r.amount !== undefined ? ` · ${MONEY(r.amount)}` : ""}</span>
              {!r.paid && <button disabled={busy} onClick={async () => { if (await confirmDialog(`Payer ${r.supplier ?? "le fournisseur"}${r.amount ? ` : ${MONEY(r.amount)}` : ""} depuis la caisse du comptoir ?`)) post({ action: "pay", id: r._id }, "Paiement enregistré en caisse"); }} className={`${buttonClass("secondary", "sm")} ${h}`}><Banknote size={14} /> Payer depuis la caisse</button>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

interface Setup { _id?: string; itemId: string; supplierId?: string; supplierName?: string; unitCost: string; quantities: string[]; dailyFee: string; toDesk: boolean; active: boolean }

/** Réglage des livraisons permanentes : article, fournisseur, prix, quantités du dimanche au samedi, frais, montée directe. */
export function StandingSetup({ deskId }: { deskId: string }) {
  const [items, setItems] = useState<Array<{ _id: string; name: string; unit: string; recipe?: unknown[] }>>([]);
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string }>>([]);
  const [rows, setRows] = useState<Setup[] | null>(null);
  useEffect(() => {
    // Composant remonté à chaque changement de restaurant (clé) : pas de remise à zéro ici.
    if (!deskId) return;
    apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => setItems(((d.data ?? []) as typeof items).filter(i => !i.recipe?.length))).catch(() => {});
    apiJson("/api/suppliers?limit=500").then(d => setSuppliers(Array.isArray(d.data) ? d.data : d.data?.items ?? [])).catch(() => {});
    apiJson(`/api/restauration/livraisons?deskId=${deskId}&setup=1`).then(d => setRows(((d.data ?? []) as Array<{ _id: string; itemId: string; supplierId?: string; supplierName?: string; unitCost: number; quantities: number[]; dailyFee?: number; toDesk: boolean; active: boolean }>)
      .map(s => ({ ...s, itemId: String(s.itemId), supplierId: s.supplierId ? String(s.supplierId) : "", unitCost: String(s.unitCost), quantities: s.quantities.map(String), dailyFee: s.dailyFee ? String(s.dailyFee) : "" })))).catch(() => setRows([]));
  }, [deskId]);
  const set = (i: number, patch: Partial<Setup>) => setRows(r => (r ?? []).map((x, j) => j === i ? { ...x, ...patch } : x));
  async function save() {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/livraisons", { deskId, action: "setup", deliveries: (rows ?? []).map(x => ({ ...x, unitCost: Number(x.unitCost.replace(",", ".")), quantities: x.quantities.map(q => Number(q.replace(",", ".")) || 0), dailyFee: Number(x.dailyFee) || 0 })) });
    if (!r.ok) return showToast(r.data.error || "Réglage refusé", "error");
    showToast("Livraisons permanentes enregistrées", "success");
  }
  if (rows === null) return <div className="h-24 surface-card animate-pulse" />;
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Croissant size={16} /> Livraisons permanentes (pain du jour…)</p>
      <p className="text-[12px] text-ink3">Chaque matin la livraison attendue est proposée sur l&apos;écran Magasin : on confirme (ou corrige la quantité), elle entre en stock au prix convenu ; le soir, on la paie depuis la caisse du comptoir. Les frais de livraison du jour sont comptés en transport.</p>
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-line p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Article"><select className={selectCls} value={r.itemId} onChange={e => set(i, { itemId: e.target.value })}><option value="">Choisir…</option>{items.map(it => <option key={it._id} value={it._id}>{it.name} ({it.unit})</option>)}</select></FormField>
            <FormField label="Fournisseur"><select className={selectCls} value={r.supplierId ?? ""} onChange={e => set(i, { supplierId: e.target.value })}><option value="">Hors référentiel</option>{suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></FormField>
            {!r.supplierId && <FormField label="Nom du fournisseur"><input className={inputCls} value={r.supplierName ?? ""} onChange={e => set(i, { supplierName: e.target.value })} placeholder="Boulangerie…" /></FormField>}
            <FormField label="Prix unitaire (FCFA)"><input className={inputCls} inputMode="decimal" value={r.unitCost} onChange={e => set(i, { unitCost: e.target.value })} /></FormField>
            <FormField label="Frais de livraison par jour (FCFA)"><input className={inputCls} inputMode="numeric" value={r.dailyFee} onChange={e => set(i, { dailyFee: e.target.value })} placeholder="0" /></FormField>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS.map((d, k) => <FormField key={k} label={d}><input className={inputCls} inputMode="decimal" value={r.quantities[k]} onChange={e => set(i, { quantities: r.quantities.map((q, j) => j === k ? e.target.value : q) })} /></FormField>)}
          </div>
          <div className="flex gap-4 items-center flex-wrap text-sm text-ink2">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={r.toDesk} onChange={e => set(i, { toDesk: e.target.checked })} /> Monté directement au comptoir</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={r.active} onChange={e => set(i, { active: e.target.checked })} /> Active</label>
            <span className="flex-1" />
            <button onClick={() => setRows(x => (x ?? []).filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")}><Trash2 size={14} /> Retirer</button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => setRows(x => [...(x ?? []), { itemId: "", unitCost: "", quantities: Array(7).fill("0"), dailyFee: "", toDesk: true, active: true }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Livraison</button>
        <button onClick={save} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer</button>
      </div>
    </section>
  );
}
