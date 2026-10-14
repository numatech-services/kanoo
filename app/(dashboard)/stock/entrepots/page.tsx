"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Star, Power, Trash2, Warehouse } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { KIND_LABEL, type WarehouseLite } from "@/components/stock/useWarehouses";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { StockTabs } from "@/components/stock/StockTabs";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Opération refusée");
  return d.data;
}

/** Entrepôts : magasin principal, dépôts, boutiques, véhicules, réserves des comptoirs. */
export default function WarehousesPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "products", "create");
  const canEdit = meCanDo(me, "products", "update");
  const canDelete = meCanDo(me, "products", "delete");
  const [items, setItems] = useState<WarehouseLite[]>([]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const d = await fetch(`/api/warehouses?all=${all}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    setItems(d?.data ?? []);
  }, [all]);
  useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<unknown>) { setError(""); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); } }

  return (
    <div className="space-y-5 max-w-5xl">
      <StockTabs />
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title mt-1 flex items-center gap-2"><Warehouse size={22} className="text-section" /> Entrepôts</h1>
          <p className="text-sm text-ink2">Le stock de chaque article est tenu par entrepôt. Chaque comptoir The Spot a sa réserve.</p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" className="accent-section" checked={all} onChange={e => setAll(e.target.checked)} /> Désactivés</label>
          {canCreate && <button onClick={() => setOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold"><Plus size={16} /> Nouvel entrepôt</button>}
        </div>
      </div>
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(w => (
          <div key={w._id} className={`bg-surface rounded-xl border border-line p-4 space-y-2 ${w.isActive === false ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{w.name} {w.isDefault && <span className="pill pill-pos ml-1">par défaut</span>}</p>
                <p className="text-xs text-ink3 font-mono">{w.code} · {KIND_LABEL[w.kind] ?? w.kind}</p>
              </div>
            </div>
            {w.address && <p className="text-xs text-ink2">{w.address}</p>}
            <p className="text-sm">{w.articles ?? 0} article(s) · {fmt(w.units ?? 0)} unité(s) · <b>{fmt(w.value ?? 0)} FCFA</b></p>
            <div className="flex gap-2 pt-1 flex-wrap">
              <Link href={`/stock?warehouseId=${w._id}`} className={buttonClass("secondary", "sm")}>Voir le stock</Link>
              {canEdit && !w.isDefault && w.kind !== "comptoir" && w.isActive !== false && <button onClick={() => run(() => send(`/api/warehouses/${w._id}`, "PATCH", { isDefault: true }))} className="px-2 h-8 inline-flex items-center gap-1 rounded-md border border-line2 text-xs hover:bg-surface2"><Star size={12} /> Par défaut</button>}
              {canEdit && !w.isDefault && <button onClick={() => run(() => send(`/api/warehouses/${w._id}`, "PATCH", { isActive: w.isActive === false }))} className="px-2 h-8 inline-flex items-center gap-1 rounded-md border border-line2 text-xs hover:bg-surface2"><Power size={12} /> {w.isActive === false ? "Réactiver" : "Désactiver"}</button>}
              {canEdit && <button onClick={async () => { const name = await promptDialog({ title: "Renommer l'entrepôt", label: "Nom", defaultValue: w.name, required: true }); if (!name) return; const address = await promptDialog({ title: "Adresse de l'entrepôt", label: "Adresse", defaultValue: w.address ?? "" }); run(() => send(`/api/warehouses/${w._id}`, "PATCH", { name, address: address ?? w.address })); }} className="px-2 h-8 inline-flex items-center rounded-md border border-line2 text-xs hover:bg-surface2">Renommer</button>}
              {canDelete && !w.isDefault && w.kind !== "comptoir" && !(w.articles) && <button onClick={async () => { if (await confirmDialog({ title: `Supprimer ${w.name} ?`, danger: true })) run(() => send(`/api/warehouses/${w._id}`, "DELETE")); }} className="p-1.5 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>}
            </div>
          </div>
        ))}
      </div>
      {open && <NewWarehouse onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    </div>
  );
}

function NewWarehouse({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: "", name: "", kind: "depot", address: "" });
  const [error, setError] = useState("");
  return (
    <Modal open onClose={onClose} title="Nouvel entrepôt">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Code" required><input className={inputCls} value={f.code} onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="DEP-1" /></FormField>
          <FormField label="Nom" required className="col-span-2"><input className={inputCls} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Dépôt de Maradi" /></FormField>
        </div>
        <FormField label="Type">
          <select className={selectCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value }))}>
            {Object.entries(KIND_LABEL).filter(([k]) => k !== "comptoir").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FormField>
        <FormField label="Adresse"><input className={inputCls} value={f.address} onChange={e => setF(p => ({ ...p, address: e.target.value }))} /></FormField>
        <button onClick={async () => { try { await send("/api/warehouses", "POST", f); onDone(); } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); } }} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold">Créer</button>
      </div>
    </Modal>
  );
}
