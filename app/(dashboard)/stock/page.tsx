"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, ArrowLeftRight, Search, History, Warehouse, Truck, CalendarX } from "lucide-react";
import { TransferDialog } from "@/components/stock/TransferDialog";
import { useWarehouses } from "@/components/stock/useWarehouses";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { MovementDialog } from "@/components/stock/MovementDialog";
import { useMe, meCanDo } from "@/lib/useMe";
import { useUrlReady } from "@/lib/url-param";

import { buttonClass } from "@/components/ui/button-class";
import { StockTabs } from "@/components/stock/StockTabs";
interface StockItem {
  _id: string; code: string; label: string; unit?: string; category?: string; location?: string;
  stockQty: number; totalQty?: number; stockMinAlert: number; trackingMode?: string; stockMaxAlert?: number; purchaseCost?: number; unitPrice: number;
  isAlert: boolean; stockValue: number; suggestedOrder: number;
}
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");

export default function StockPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "products", "create");
  const canMove = meCanDo(me, "products", "update");
  const [items, setItems] = useState<StockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Filtres repris de l'adresse (« Voir le stock » d'un entrepôt, pastille
  // « sous le seuil ») dès le premier chargement : une seule requête, pas de
  // réponse non filtrée qui écraserait la filtrée.
  const [filters, setFilters] = useState({ search: "", category: "", location: "", alertOnly: false, warehouseId: "" });
  const ready = useUrlReady(p => setFilters(f => ({ ...f, alertOnly: p.get("alertOnly") === "true", warehouseId: p.get("warehouseId") ?? "" })));
  const { warehouses } = useWarehouses();
  const [transfer, setTransfer] = useState(false);
  const [lotAlerts, setLotAlerts] = useState({ expired: 0, soon: 0 });
  const [searchInput, setSearchInput] = useState("");
  const [meta, setMeta] = useState({ alertCount: 0, totalStockValue: 0, totalStockValueAtPrice: 0, uncostedCount: 0, categories: [] as string[], locations: [] as string[] });
  const [moving, setMoving] = useState<StockItem | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (filters.search) params.set("search", filters.search);
    if (filters.category) params.set("category", filters.category);
    if (filters.location) params.set("location", filters.location);
    if (filters.alertOnly) params.set("alertOnly", "true");
    if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
    const d = await fetch(`/api/stock?${params}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    if (d?.data) {
      setItems(d.data.items || []);
      setTotal(d.data.pagination?.total || 0);
      setMeta({ alertCount: d.data.alertCount, totalStockValue: d.data.totalStockValue, totalStockValueAtPrice: d.data.totalStockValueAtPrice,
        uncostedCount: d.data.uncostedCount, categories: d.data.categories || [], locations: d.data.locations || [] });
      setLotAlerts({ expired: d.data.expiredLots ?? 0, soon: d.data.expiringLots ?? 0 });
    }
    setLoading(false);
  }, [page, filters, ready]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => {
      // Pas de nouvel état (donc pas de requête) tant que la recherche ne change pas.
      setFilters(f => (f.search === searchInput.trim() ? f : (setPage(1), { ...f, search: searchInput.trim() })));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const columns: Column<StockItem>[] = [
    { key: "code", label: "Code", className: "font-mono text-xs w-24" },
    { key: "label", label: "Article", render: (_v, r) => (
      <Link href={`/stock/${r._id}`} className="hover:underline">
        <span className="font-medium text-ink">{r.label}</span>
        {(r.category || r.location) && <span className="block text-[11px] text-ink3">{[r.category, r.location].filter(Boolean).join(" · ")}</span>}
      </Link>
    ) },
    { key: "stockQty", label: filters.warehouseId ? "Dans l'entrepôt" : "En stock", className: "text-right", render: (v, r) => (
      <span className={`font-mono font-semibold ${r.isAlert ? "text-neg" : "text-ink"}`}>{fmt(v)} <span className="text-[11px] text-ink3">{r.unit}</span>
        {filters.warehouseId && r.totalQty !== undefined && <span className="block text-[11px] text-ink3 font-normal">total {fmt(r.totalQty)}</span>}
        {r.trackingMode && r.trackingMode !== "none" && <span className="block text-[10px] text-section font-normal">{r.trackingMode === "serial" ? "n° de série" : "par lot"}</span>}</span>
    ) },
    { key: "stockMinAlert", label: "Seuil", className: "text-right font-mono text-ink2", render: v => fmt(v) },
    { key: "purchaseCost", label: "Coût moyen", className: "text-right font-mono text-ink2", render: v => Number(v) > 0 ? fmt(v) : <span className="text-warn text-xs">à valoriser</span> },
    { key: "stockValue", label: "Valeur (coût)", className: "text-right font-mono", render: v => fmt(v) },
    { key: "suggestedOrder", label: "À commander", className: "text-right font-mono", render: v => Number(v) > 0 ? <span className="text-warn font-semibold">{fmt(v)}</span> : "—" },
    ...(canMove ? [{ key: "_id", label: "", render: (_v: unknown, r: StockItem) => (
      <button onClick={() => setMoving(r)} className="px-2 h-8 inline-flex items-center gap-1 rounded-md border border-line2 text-xs text-ink2 hover:bg-surface2"><ArrowLeftRight size={13} /> Mouvement</button>
    ) } as Column<StockItem>] : []),
  ];

  return (
    <div className="space-y-5">
      <StockTabs />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Stock</h1>
          <p className="text-sm text-ink2">{total} article{total > 1 ? "s" : ""} stocké{total > 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/stock/entrepots" className={buttonClass("secondary", "md")}><Warehouse size={16} /> Entrepôts</Link>
          <Link href="/stock/mouvements" className={buttonClass("secondary", "md")}><History size={16} /> Mouvements</Link>
          {canMove && warehouses.length > 1 && <button onClick={() => setTransfer(true)} className="px-3 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink hover:bg-surface2"><Truck size={16} /> Transfert</button>}
          {canCreate && <Link href="/stock/new" className={buttonClass("primary", "md")}><Plus size={16} /> Nouvel article</Link>}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-line p-4">
          <p className="text-[11px] font-semibold text-ink2 uppercase">Valeur du stock (coût moyen)</p>
          <p className="text-xl font-bold text-ink mt-1">{fmt(meta.totalStockValue)} FCFA</p>
          {meta.uncostedCount > 0 && <p className="text-[11px] text-warn mt-1">{meta.uncostedCount} article(s) sans coût d&apos;achat</p>}
        </div>
        <div className="bg-surface rounded-xl border border-line p-4">
          <p className="text-[11px] font-semibold text-ink2 uppercase">Valeur au prix de vente</p>
          <p className="text-xl font-bold text-ink mt-1">{fmt(meta.totalStockValueAtPrice)} FCFA</p>
        </div>
        <button onClick={() => { setPage(1); setFilters(f => ({ ...f, alertOnly: !f.alertOnly })); }}
          className={`text-left rounded-xl border p-4 ${filters.alertOnly ? "border-neg/40 bg-neg-50" : "border-line bg-surface hover:bg-surface2"}`}>
          <p className="text-[11px] font-semibold text-ink2 uppercase flex items-center gap-1"><AlertTriangle size={13} className="text-neg" /> Sous le seuil d&apos;alerte</p>
          <p className="text-xl font-bold text-neg mt-1">{meta.alertCount}</p>
          <p className="text-[11px] text-ink3">{filters.alertOnly ? "Filtre actif — cliquer pour tout voir" : "Cliquer pour filtrer"}</p>
        </button>
      </div>

      {(lotAlerts.expired > 0 || lotAlerts.soon > 0) && (
        <Link href="/stock/lots" className={`flex items-center gap-2 p-3 rounded-lg text-sm border ${lotAlerts.expired ? "bg-neg-50 border-neg/25 text-neg" : "bg-warn-50 border-warn/30 text-warn"}`}>
          <CalendarX size={16} /> {lotAlerts.expired} lot(s) périmé(s), {lotAlerts.soon} à péremption sous 30 jours — voir les lots
        </Link>
      )}

      <div className="flex gap-2 flex-wrap">
        <select className={`${selectCls} w-auto`} value={filters.warehouseId} onChange={e => { setPage(1); setFilters(f => ({ ...f, warehouseId: e.target.value })); }} aria-label="Entrepôt">
          <option value="">Tous les entrepôts</option>
          {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
        </select>
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="Rechercher : désignation, code, code-barres" value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        </label>
        <select className={`${selectCls} w-auto`} value={filters.category} onChange={e => { setPage(1); setFilters(f => ({ ...f, category: e.target.value })); }} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {meta.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={`${selectCls} w-auto`} value={filters.location} onChange={e => { setPage(1); setFilters(f => ({ ...f, location: e.target.value })); }} aria-label="Emplacement">
          <option value="">Tous emplacements</option>
          {meta.locations.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <DataTable columns={columns} data={items} loading={loading} keyExtractor={i => i._id} emptyMessage="Aucun article" />
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      {moving && <MovementDialog product={moving} defaultWarehouseId={filters.warehouseId || undefined} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load(); }} />}
      {transfer && <TransferDialog fromWarehouseId={filters.warehouseId || undefined} onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); load(); }} />}
    </div>
  );
}
