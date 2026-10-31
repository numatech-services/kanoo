"use client";
import { useEffect, useMemo, useState } from "react";
import { ChefHat, Plus, Trash2, Printer, Save } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { RestoNav } from "@/components/restauration/RestoNav";
import { ALLERGENS, perPortion } from "@/lib/restaurant";
import { priceCheck } from "@/lib/restaurant-pricing";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Item { _id: string; name: string; unit: string; category?: string; unitCost: number | null; salePrice?: number; recipe?: Array<{ itemId: string; quantity: number; yield?: number }>; portions?: number; servingWeight?: number; allergens?: string[]; procedure?: string }
interface Pricing { desk: { vatRate: number; target: number }; overhead: { rate: number; shrink: number; provisional: boolean } }
type Line = { itemId: string; quantity: string; yieldPct: string };

/**
 * Fiches techniques des plats et boissons préparés : ingrédients (quantité
 * nette et rendement), nombre de portions, grammage servi, allergènes,
 * procédé ; coût par portion, marge et prix minimum pour la marge nette
 * visée ; impression pour la cuisine.
 */
export default function FichesPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = (id: string) => {
    apiJson(`/api/comptoir/items?deskId=${id}`).then(d => setItems((d.data ?? []) as Item[])).catch(() => {});
    apiJson(`/api/restauration/pricing?deskId=${id}`).then(d => setPricing(d.data as Pricing)).catch(() => setPricing(null));
  };
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  useEffect(() => { if (deskId) load(deskId); }, [deskId]);
  const dishes = items.filter(i => i.recipe?.length);
  const others = items.filter(i => !i.recipe?.length);
  const current = items.find(i => i._id === sel) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><ChefHat size={22} /> Fiches techniques</h1>
          <p className="text-sm text-ink2">La recette de chaque plat : ingrédients nets et rendement, portions, grammage, allergènes, procédé ; son coût par portion et son prix minimum.</p>
        </div>
        <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => { setSel(null); setDeskId(e.target.value); }}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
      </div>
      <RestoNav />
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <aside className="surface-card p-3 space-y-2 h-fit">
          <p className="text-xs font-semibold text-ink2">Plats et boissons préparés ({dishes.length})</p>
          {dishes.map(d => <button key={d._id} onClick={() => setSel(d._id)} className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm ${sel === d._id ? "bg-ink text-white" : "hover:bg-surface2"}`}>{d.name}</button>)}
          <select className={selectCls} value="" onChange={e => e.target.value && setSel(e.target.value)}>
            <option value="">Créer la fiche d&apos;un article…</option>
            {others.filter(o => (o.salePrice ?? 0) > 0).map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
          </select>
          <p className="text-[11px] text-ink3">Un article vendu devient une préparation dès que sa fiche a un ingrédient : ce sont alors ses ingrédients qui sortent du stock à chaque vente.</p>
        </aside>
        {!current ? <EmptyState icon={<ChefHat size={20} />} title="Choisissez un plat" hint="Ou créez la fiche d'un article en vente." />
          : <Sheet key={current._id} item={current} ingredients={others} pricing={pricing} onSaved={() => load(deskId)} />}
      </div>
    </div>
  );
}

function Sheet({ item, ingredients, pricing, onSaved }: { item: Item; ingredients: Item[]; pricing: Pricing | null; onSaved: () => void }) {
  const [lines, setLines] = useState<Line[]>(() => (item.recipe ?? []).map(r => ({ itemId: String(r.itemId), quantity: String(r.quantity).replace(".", ","), yieldPct: r.yield ? String(Math.round(r.yield * 100)) : "100" })));
  const [portions, setPortions] = useState(String(item.portions ?? 1));
  const [weight, setWeight] = useState(item.servingWeight ? String(item.servingWeight) : "");
  const [allergens, setAllergens] = useState<string[]>(item.allergens ?? []);
  const [procedure, setProcedure] = useState(item.procedure ?? "");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(ingredients.map(i => [i._id, i])), [ingredients]);
  const nPortions = Math.max(1, Math.round(num(portions)) || 1);
  const rows = lines.map(l => {
    const ing = byId.get(l.itemId), q = num(l.quantity), y = num(l.yieldPct) / 100;
    const gross = q > 0 ? perPortion({ quantity: q, yield: y > 0 && y <= 1 ? y : 1 }, nPortions) : 0;
    return { ...l, ing, gross, cost: ing?.unitCost != null && ing.unitCost > 0 ? gross * ing.unitCost : null };
  });
  const costKnown = rows.length > 0 && rows.every(r => r.cost !== null);
  const cost = costKnown ? Math.round(rows.reduce((t, r) => t + (r.cost ?? 0), 0) * 100) / 100 : null;
  const check = pricing ? priceCheck({ priceTTC: item.salePrice ?? 0, vatRate: pricing.desk.vatRate, cost, overheadRate: pricing.overhead.rate / 100, shrinkRate: pricing.overhead.shrink / 100, target: pricing.desk.target }) : null;

  async function save() {
    const bad = lines.find(l => l.itemId && (!(num(l.quantity) > 0) || !(num(l.yieldPct) >= 5 && num(l.yieldPct) <= 100)));
    if (bad) return showToast(`${byId.get(bad.itemId)?.name ?? "Ingrédient"} : quantité ou rendement invalide (5 à 100 %).`, "error");
    setBusy(true);
    const r = await apiSend<{ error?: string }>("PATCH", `/api/comptoir/items/${item._id}`, {
      recipe: lines.filter(l => l.itemId && num(l.quantity) > 0).map(l => ({ itemId: l.itemId, quantity: num(l.quantity), yield: num(l.yieldPct) / 100 })),
      portions: nPortions, servingWeight: num(weight) > 0 ? num(weight) : 0, allergens, procedure,
    });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Enregistrement refusé", "error");
    showToast("Fiche technique enregistrée", "success"); onSaved();
  }

  function print() {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return showToast("Autorisez les fenêtres pour imprimer.", "error");
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche technique — ${esc(item.name)}</title>
      <style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#f2f2f2}.r{text-align:right}.muted{color:#555}</style></head><body>
      <h1>${esc(item.name)}</h1><p class="muted">${nPortions} portion(s)${num(weight) > 0 ? ` · ${esc(weight)} g par portion` : ""}${item.category ? ` · ${esc(item.category)}` : ""}</p>
      <table><thead><tr><th>Ingrédient</th><th class="r">Quantité nette</th><th class="r">Rendement</th><th class="r">À sortir (brut, toute la recette)</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.ing?.name ?? "—")}</td><td class="r">${esc(r.quantity)} ${esc(r.ing?.unit ?? "")}</td><td class="r">${esc(r.yieldPct)} %</td><td class="r">${Math.round((num(r.quantity) / ((num(r.yieldPct) || 100) / 100)) * 1000) / 1000} ${esc(r.ing?.unit ?? "")}</td></tr>`).join("")}
      </tbody></table>
      <p><b>Allergènes :</b> ${allergens.length ? allergens.map(esc).join(", ") : "aucun déclaré"}</p>
      <p><b>Procédé :</b></p><p style="white-space:pre-wrap">${esc(procedure) || "—"}</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <section className="surface-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-lg font-semibold text-ink">{item.name}</h2><p className="text-xs text-ink3">Prix de vente {MONEY(item.salePrice)} TTC</p></div>
        <div className="flex gap-2">
          <button onClick={print} className={buttonClass("secondary", "sm")}><Printer size={14} /> Imprimer</button>
          <button disabled={busy} onClick={save} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer</button>
        </div>
      </div>
      <div className="overflow-x-auto"><table className="table-dense w-full">
        <thead><tr><th>Ingrédient</th><th>Quantité nette (recette)</th><th>Rendement %</th><th className="text-right">Brut par portion</th><th className="text-right">Coût par portion</th><th></th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            <td><select className={selectCls} value={r.itemId} onChange={e => setLines(x => x.map((y, j) => j === i ? { ...y, itemId: e.target.value } : y))}>
              <option value="">Ingrédient…</option>{ingredients.map(o => <option key={o._id} value={o._id}>{o.name} ({o.unit})</option>)}</select></td>
            <td><input className={`${inputCls} w-28`} inputMode="decimal" value={r.quantity} onChange={e => setLines(x => x.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y))} /> <span className="text-xs text-ink3">{r.ing?.unit}</span></td>
            <td><input className={`${inputCls} w-20`} inputMode="numeric" value={r.yieldPct} onChange={e => setLines(x => x.map((y, j) => j === i ? { ...y, yieldPct: e.target.value } : y))} /></td>
            <td className="text-right font-mono text-sm">{r.gross ? r.gross.toLocaleString("fr-FR", { maximumFractionDigits: 4 }) : "—"} <span className="text-ink3 text-xs">{r.ing?.unit}</span></td>
            <td className="text-right font-mono">{r.cost === null ? <span className="text-warn text-xs">coût inconnu</span> : MONEY(r.cost)}</td>
            <td><button onClick={() => setLines(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <button onClick={() => setLines(x => [...x, { itemId: "", quantity: "", yieldPct: "100" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter un ingrédient</button>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Portions produites par la recette"><input className={inputCls} inputMode="numeric" value={portions} onChange={e => setPortions(e.target.value)} /></FormField>
        <FormField label="Grammage servi par portion (g)"><input className={inputCls} inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} /></FormField>
      </div>
      <div className="surface-card p-3 grid gap-2 sm:grid-cols-4 text-sm">
        <div><p className="text-xs text-ink2">Coût par portion</p><p className="font-mono font-semibold">{MONEY(cost)}</p></div>
        <div><p className="text-xs text-ink2">Marge nette</p><p className={`font-mono font-semibold ${(check?.netMargin ?? 0) < 0 ? "text-neg" : ""}`}>{MONEY(check?.netMargin)} {check?.netMarginPct != null ? <span className="text-xs text-ink3">({check.netMarginPct} %)</span> : null}</p></div>
        <div><p className="text-xs text-ink2">Prix minimum TTC</p><p className="font-mono font-semibold">{MONEY(check?.minPriceTTC)}</p></div>
        <div><p className="text-xs text-ink2">État</p>{check ? <Pill tone={check.status === "ok" ? "pos" : check.status === "below" || check.status === "impossible" ? "neg" : "warn"}>{check.status === "ok" ? "objectif atteint" : check.status === "below" ? "sous le prix minimum" : check.status === "impossible" ? "frais trop lourds" : check.status === "no_cost" ? "coût inconnu" : "sans prix"}</Pill> : "—"}</div>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink mb-1">Allergènes</p>
        <div className="flex flex-wrap gap-2">{ALLERGENS.map(a => (
          <label key={a} className={`px-2.5 h-8 rounded-full border text-[13px] inline-flex items-center gap-1.5 cursor-pointer ${allergens.includes(a) ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>
            <input type="checkbox" className="sr-only" checked={allergens.includes(a)} onChange={e => setAllergens(x => e.target.checked ? [...x, a] : x.filter(y => y !== a))} />{a}
          </label>
        ))}</div>
      </div>
      <FormField label="Procédé (étapes, cuisson, dressage)"><textarea className={inputCls} rows={5} value={procedure} onChange={e => setProcedure(e.target.value)} /></FormField>
      <p className="text-[11px] text-ink3">Rendement = poids net ÷ poids brut (80 % : 20 % perdu à l&apos;épluchage, à la découpe ou à la cuisson). Une portion vendue sort du stock : quantité nette ÷ rendement ÷ portions. Coût : le plus élevé du coût moyen et du dernier prix d&apos;achat n&apos;est pris en compte que dans l&apos;écran Prix et marges ; ici, le coût moyen de l&apos;ingrédient.</p>
    </section>
  );
}
