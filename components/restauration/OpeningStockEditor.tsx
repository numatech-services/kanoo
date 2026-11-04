"use client";
import { useRef, useState } from "react";
import { Plus, Trash2, ClipboardPaste, Copy } from "lucide-react";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson } from "@/lib/api-client";

export const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
export const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };

export interface StockLine { productId?: string; name: string; unit: string; category: string; level: "reserve" | "desk"; packSize: string; packs: string; quantity: string; cost: string; costPer: "unit" | "pack"; salePrice: string; rhythm: string; expiry: string }
export const emptyLine = (): StockLine => ({ name: "", unit: "unité", category: "", level: "desk", packSize: "", packs: "", quantity: "", cost: "", costPer: "unit", salePrice: "", rhythm: "", expiry: "" });

/** Quantité en unités, coût unitaire et valeur d'une ligne, tels que le serveur les calculera. */
export function lineValue(l: StockLine) {
  const size = num(l.packSize) > 0 ? num(l.packSize) : 0;
  const units = (num(l.packs) > 0 ? num(l.packs) * size : 0) + (num(l.quantity) > 0 ? num(l.quantity) : 0);
  const unitCost = l.costPer === "pack" && size ? (num(l.cost) || 0) / size : num(l.cost) || 0;
  return { units, unitCost, value: units * unitCost };
}

/** Lignes prêtes à envoyer : le carton reste un conditionnement, le stock est tenu à l'unité. */
export function linesToItems(lines: StockLine[]) {
  return lines.filter(l => l.name.trim()).map(l => {
    const v = lineValue(l), size = num(l.packSize) > 0 ? num(l.packSize) : undefined;
    return {
      ...(l.productId ? { productId: l.productId } : {}), name: l.name.trim(), unit: l.unit || "unité", ...(l.category ? { category: l.category } : {}), level: l.level,
      unitCost: Math.round(v.unitCost * 10000) / 10000, quantity: num(l.quantity) > 0 ? num(l.quantity) : 0, packs: num(l.packs) > 0 ? num(l.packs) : 0,
      ...(size ? { pack: { label: "carton", size } } : {}), ...(num(l.salePrice) > 0 ? { salePrice: num(l.salePrice) } : {}), ...(l.rhythm ? { rhythm: l.rhythm } : {}), ...(l.expiry ? { expiryDate: l.expiry } : {}),
    };
  });
}

/** Une ligne par ligne collée : Article, Unité, Carton de, Cartons, Unités, Coût unitaire, Prix de vente (tabulations, ou points-virgules). */
export function parsePasted(text: string): StockLine[] {
  return text.split(/\r?\n/).map(r => r.split(/\t|;/).map(c => c.trim())).filter(c => c[0] && !/^article$/i.test(c[0]))
    .map(c => ({ ...emptyLine(), name: c[0], unit: c[1] || "unité", packSize: c[2] ?? "", packs: c[3] ?? "", quantity: c[4] ?? "", cost: c[5] ?? "", salePrice: c[6] ?? "" }));
}

interface Hit { _id: string; label: string; unit?: string; category?: string; purchaseCost?: number }
interface Template { productId?: string; name: string; unit: string; category: string; salePrice: number | null; unitCost: number; packSize: number | null; rhythm: string }

/**
 * Saisie du stock de départ : on compte en cartons et en unités, on reprend les
 * articles d'un autre site ou du catalogue, ou on colle une liste depuis Excel.
 */
export function OpeningStockEditor({ lines, setLines, sources }: { lines: StockLine[]; setLines: (fn: (l: StockLine[]) => StockLine[]) => void; sources: Array<{ _id: string; name: string }> }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const [more, setMore] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (i: number, p: Partial<StockLine>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const total = lines.reduce((t, l) => t + lineValue(l).value, 0);

  function typeName(i: number, value: string) {
    const hit = hits.find(h => h.label.toLowerCase() === value.trim().toLowerCase());
    set(i, hit ? { name: hit.label, productId: hit._id, unit: hit.unit || "unité", category: hit.category ?? "", ...(lines[i].cost ? {} : { cost: hit.purchaseCost ? String(hit.purchaseCost) : "" }) } : { name: value, productId: undefined });
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length >= 2) timer.current = setTimeout(() => { apiJson(`/api/restauration/ouverture?q=${encodeURIComponent(value.trim())}`).then(d => setHits((d.data ?? []) as Hit[])).catch(() => {}); }, 250);
  }
  async function reuse(id: string) {
    if (!id) return;
    const d = await apiJson(`/api/restauration/ouverture?templates=${id}`).catch(() => null);
    const list = (d?.data ?? []) as Template[];
    if (!list.length) return showToast("Aucun article à reprendre sur ce site.", "error");
    setLines(ls => [...ls.filter(l => l.name.trim()), ...list.filter(t => !ls.some(l => l.name.toLowerCase() === t.name.toLowerCase())).map(t => ({ ...emptyLine(), productId: t.productId, name: t.name, unit: t.unit, category: t.category, packSize: t.packSize ? String(t.packSize) : "", cost: t.unitCost ? String(t.unitCost) : "", salePrice: t.salePrice ? String(t.salePrice) : "", rhythm: t.rhythm }))]);
    showToast(`${list.length} article(s) repris : indiquez les quantités comptées.`, "success");
  }

  return (
    <div className="space-y-3">
      <datalist id="catalog-hits">{hits.map(h => <option key={h._id} value={h.label} />)}</datalist>
      <div className="flex gap-2 flex-wrap items-center">
        {sources.length > 0 && <label className="inline-flex items-center gap-2 text-sm text-ink2"><Copy size={14} /> Reprendre les articles de <select className={`${selectCls} w-auto`} value="" onChange={e => reuse(e.target.value)} aria-label="Site dont reprendre les articles"><option value="">Choisir un site…</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>}
        <button type="button" onClick={() => setPaste(p => p === null ? "" : null)} className={buttonClass("secondary", "sm")}><ClipboardPaste size={14} /> Coller depuis Excel</button>
      </div>
      {paste !== null && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-[12px] text-ink3">Colonnes dans cet ordre : Article, Unité, Carton de, Cartons, Unités, Coût unitaire, Prix de vente.</p>
          <textarea className={`${inputCls} h-28`} value={paste} onChange={e => setPaste(e.target.value)} aria-label="Liste collée depuis Excel" placeholder={"Jus IRA\tbouteille\t24\t3\t5\t200\t300"} />
          <button type="button" className={buttonClass("primary", "sm")} onClick={() => { const add = parsePasted(paste); if (!add.length) return showToast("Rien à reprendre dans ce texte.", "error"); setLines(ls => [...ls.filter(l => l.name.trim()), ...add]); setPaste(null); }}>Ajouter ces lignes</button>
        </div>
      )}
      {lines.map((l, i) => { const v = lineValue(l), packed = num(l.packSize) > 0; return (
        <div key={i} className="rounded-lg border border-line p-3 space-y-2">
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-6">
            <label className="col-span-2 text-[12px] text-ink2">Article<input list="catalog-hits" className={inputCls} value={l.name} onChange={e => typeName(i, e.target.value)} placeholder="Jus IRA" /></label>
            <label className="text-[12px] text-ink2">Carton de (unités)<input className={inputCls} inputMode="decimal" value={l.packSize} onChange={e => set(i, { packSize: e.target.value })} placeholder="vide si à l'unité" /></label>
            {packed && <label className="text-[12px] text-ink2">Cartons comptés<input className={inputCls} inputMode="decimal" value={l.packs} onChange={e => set(i, { packs: e.target.value })} /></label>}
            <label className="text-[12px] text-ink2">{packed ? "+ unités" : "Quantité"}<input className={inputCls} inputMode="decimal" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} /></label>
            <label className="text-[12px] text-ink2">Coût (FCFA)<input className={inputCls} inputMode="decimal" value={l.cost} onChange={e => set(i, { cost: e.target.value })} /></label>
            {packed && <label className="text-[12px] text-ink2">Coût par<select className={selectCls} value={l.costPer} onChange={e => set(i, { costPer: e.target.value as StockLine["costPer"] })}><option value="unit">unité</option><option value="pack">carton</option></select></label>}
            <label className="text-[12px] text-ink2">Prix de vente<input className={inputCls} inputMode="numeric" value={l.salePrice} onChange={e => set(i, { salePrice: e.target.value })} /></label>
          </div>
          {more === i ? (
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
              <label className="text-[12px] text-ink2">Où<select className={selectCls} value={l.level} onChange={e => set(i, { level: e.target.value as StockLine["level"] })}><option value="desk">Comptoir (prêt à vendre)</option><option value="reserve">Réserve</option></select></label>
              <label className="text-[12px] text-ink2">Unité de stock<input className={inputCls} value={l.unit} onChange={e => set(i, { unit: e.target.value })} /></label>
              <label className="text-[12px] text-ink2">Famille<input className={inputCls} value={l.category} onChange={e => set(i, { category: e.target.value })} placeholder="Boissons" /></label>
              <label className="text-[12px] text-ink2">Compté<select className={selectCls} value={l.rhythm} onChange={e => set(i, { rhythm: e.target.value })}><option value="">Chaque semaine</option><option value="fortnight">Toutes les 2 semaines</option><option value="month">Chaque mois</option></select></label>
              <label className="text-[12px] text-ink2">Péremption<input type="date" className={inputCls} value={l.expiry} onChange={e => set(i, { expiry: e.target.value })} /></label>
            </div>
          ) : <button type="button" onClick={() => setMore(i)} className="text-[12px] text-ink3 underline">{l.level === "reserve" ? "En réserve · " : "Au comptoir · "}{l.unit} · plus de détails</button>}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-ink2">{v.units ? <>{v.units.toLocaleString("fr-FR")} {l.unit} · <b className="font-mono">{MONEY(v.value)}</b></> : "Aucune quantité : l'article sera créé sans stock."}{l.name.trim() && !(num(l.salePrice) > 0) ? <span className="text-warn"> · sans prix de vente, il n'apparaîtra pas à la caisse</span> : null}</span>
            <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label={`Retirer ${l.name || "la ligne"}`}><Trash2 size={14} /></button>
          </div>
        </div>
      ); })}
      <div className="flex items-center gap-3 flex-wrap sticky bottom-0 bg-surface py-2">
        <button type="button" onClick={() => setLines(ls => [...ls, emptyLine()])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Article</button>
        <span className="text-sm text-ink2">Stock de départ : <b className="font-mono">{MONEY(total)}</b> au coût</span>
      </div>
    </div>
  );
}
