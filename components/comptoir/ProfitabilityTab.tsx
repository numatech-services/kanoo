"use client";
import { useMemo, useState } from "react";
import { TrendingUp, AlertTriangle, Calculator, Pencil, Trophy } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { csvCell } from "@/lib/csv";
import { itemEconomics, type Economics } from "@/lib/comptoir-economics";

const MONEY = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const UNIT = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} FCFA`;
const PCT = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Row {
  _id: string; name: string; unit: string; category: string; quantity: number; salePrice: number | null; linked: boolean;
  pack: { label?: string; size?: number; cost?: number } | null;
  economics: Economics; outlook: { expectedRevenue: number; expectedMargin: number | null; stockValue: number };
  sold: { quantity: number; revenueTTC: number; margin: number; tickets: number; rank: number } | null;
  recipe: Array<{ itemId: string; quantity: number; name: string }>; recipeMissing: number;
  losses: { quantity: number; value: number } | null;
}
interface Data {
  from: string; to: string; targetMarkup: number; vatRate: number; items: Row[];
  totals: { stockValue: number; expectedRevenue: number; expectedMargin: number; soldRevenue: number; soldMargin: number; losses: number; thin: number; unpriced: number; shrinkage: number };
  categories: Array<{ category: string; revenueTTC: number; margin: number; quantity: number }>;
  best: Array<{ itemId: string; label: string; revenueTTC: number; quantity: number; margin: number }>;
}

const STATUS: Record<Economics["status"], { tone: "neg" | "warn" | "pos" | "info"; label: string }> = {
  loss: { tone: "neg", label: "à perte" }, thin: { tone: "warn", label: "marge mince" }, ok: { tone: "pos", label: "rentable" }, unknown: { tone: "info", label: "coût ou prix manquant" },
};

/**
 * Rentabilité des articles du comptoir : marge prévue à l'unité et au paquet,
 * chiffre d'affaires et marge attendus sur le stock, ventes réelles de la
 * période et meilleures ventes. Un calculateur répond à « si j'achète un
 * paquet de 24 à 5 000 et que je revends 200, je gagne combien ? ».
 */
export function ProfitabilityTab({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const now = new Date();
  const [from, setFrom] = useState(localDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localDay(now));
  const [sort, setSort] = useState<"rank" | "margin" | "markup" | "name">("rank");
  const [edit, setEdit] = useState<Row | null>(null);
  const { data, reload } = useApi<Data | null>(`/api/comptoir/profitability?deskId=${deskId}&from=${from}&to=${to}`, d => d?.data ?? null, null);

  const rows = useMemo(() => {
    const r = [...(data?.items ?? [])];
    if (sort === "rank") r.sort((a, b) => (a.sold?.rank ?? 1e9) - (b.sold?.rank ?? 1e9) || a.name.localeCompare(b.name));
    if (sort === "margin") r.sort((a, b) => (b.sold?.margin ?? -1e12) - (a.sold?.margin ?? -1e12));
    if (sort === "markup") r.sort((a, b) => (a.economics.markupRate ?? 1e9) - (b.economics.markupRate ?? 1e9));
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }, [data, sort]);

  function exportCsv() {
    if (!data) return;
    const head = ["Article", "Famille", "Coût unitaire", "Prix de vente", "Marge unitaire", "Taux de marque %", "Marge par paquet", "Stock", "CA attendu", "Marge attendue", "Vendus", "CA réalisé", "Marge réalisée"];
    const lines = data.items.map(r => [r.name, r.category, r.economics.unitCost, r.salePrice ?? "", r.economics.marginUnit, r.economics.markupRate ?? "", r.economics.packMargin ?? "", r.quantity, r.outlook.expectedRevenue, r.outlook.expectedMargin ?? "", r.sold?.quantity ?? 0, r.sold?.revenueTTC ?? 0, r.sold?.margin ?? 0]);
    const csv = "﻿" + [head, ...lines].map(l => l.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `rentabilite-comptoir-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (!data) return <div className="h-48 surface-card animate-pulse" />;
  const t = data.totals;
  return (
    <div className="space-y-5">
      <MarginCalculator vatRate={data.vatRate} target={data.targetMarkup} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="CA attendu du stock" value={MONEY(t.expectedRevenue)} hint="Si tout le stock est vendu au prix affiché" />
        <Kpi label="Marge attendue du stock" value={MONEY(t.expectedMargin)} tone={t.expectedMargin < 0 ? "neg" : "pos"} />
        <Kpi label="CA réalisé (période)" value={MONEY(t.soldRevenue)} />
        <Kpi label="Marge réalisée (période)" value={MONEY(t.soldMargin)} tone={t.soldMargin < 0 ? "neg" : "pos"} hint={t.shrinkage ? `Pertes et casse : ${MONEY(t.shrinkage)}` : undefined} />
      </div>
      {t.shrinkage > 0 && <p className="text-sm text-neg">Pertes et casse de la période : {MONEY(t.shrinkage)} au coût — marge après pertes : <b>{MONEY(t.soldMargin - t.shrinkage)}</b>.</p>}

      {(t.losses > 0 || t.thin > 0 || t.unpriced > 0) && (
        <div className="px-4 py-3 rounded-xl bg-warn-50 border border-warn/25 text-sm text-warn inline-flex gap-2 items-start">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{[t.losses ? `${t.losses} article(s) vendu(s) à perte` : "", t.thin ? `${t.thin} à marge mince (moins de 15 %)` : "", t.unpriced ? `${t.unpriced} sans coût ou sans prix` : ""].filter(Boolean).join(" · ")}. Corrigez le prix ou le coût d&apos;achat (crayon).</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="surface-card p-4">
          <h3 className="text-sm font-bold text-ink mb-2 inline-flex items-center gap-1.5"><Trophy size={15} /> Meilleures ventes</h3>
          {data.best.length === 0 ? <p className="text-sm text-ink3">Aucune vente sur la période.</p> : (
            <ol className="text-sm divide-y divide-line">
              {data.best.map((b, i) => <li key={b.itemId} className="py-1.5 flex justify-between gap-2"><span className="text-ink truncate">{i + 1}. {b.label} <span className="text-ink3">× {b.quantity}</span></span><span className="font-mono text-ink2">{MONEY(b.revenueTTC)}</span></li>)}
            </ol>
          )}
        </section>
        <section className="surface-card p-4">
          <h3 className="text-sm font-bold text-ink mb-2 inline-flex items-center gap-1.5"><TrendingUp size={15} /> Par famille</h3>
          <ul className="text-sm divide-y divide-line">
            {data.categories.filter(c => c.revenueTTC > 0).map(c => <li key={c.category} className="py-1.5 flex justify-between gap-2"><span className="text-ink">{c.category}</span><span className="font-mono text-ink2">{MONEY(c.revenueTTC)} · marge {MONEY(c.margin)}</span></li>)}
            {data.categories.every(c => c.revenueTTC === 0) && <li className="py-1.5 text-ink3">Aucune vente sur la période.</li>}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2 items-end">
          <FormField label="Ventes du"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></FormField>
          <FormField label="au"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></FormField>
        </div>
        <div className="flex gap-2 items-center">
          <select className="h-10 px-3 rounded-lg border border-line2 bg-surface text-sm" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Trier">
            <option value="rank">Meilleures ventes d&apos;abord</option><option value="margin">Plus forte marge réalisée</option><option value="markup">Marge la plus faible d&apos;abord</option><option value="name">Ordre alphabétique</option>
          </select>
          <button onClick={exportCsv} className={buttonClass("secondary", "md")}>Export CSV</button>
        </div>
      </div>

      {rows.length === 0 ? <EmptyState icon={<TrendingUp size={20} />} title="Aucun article" hint="Ajoutez vos articles dans l'onglet Stock matière." /> : (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Article</th><th className="text-right">Coût unit.</th><th className="text-right">Prix</th><th className="text-right">Marge unit.</th><th className="text-right">Marque</th><th className="text-right">Par paquet</th><th className="text-right">Stock → CA / marge attendus</th><th className="text-right">Vendus (période)</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const e = r.economics, st = STATUS[e.status];
                return (
                  <tr key={r._id}>
                    <td className="text-ink font-medium">{r.sold?.rank && r.sold.rank <= 3 ? <span className="mr-1 text-warn">#{r.sold.rank}</span> : null}{r.name}
                      <span className="block text-[11px] text-ink3 font-normal">{[r.category, r.recipe.length ? `préparation : ${r.recipe.map(x => x.name).join(", ")}` : "", r.pack?.size ? `${r.pack.label || "paquet"} de ${r.pack.size}${r.pack.cost ? ` à ${MONEY(r.pack.cost)}` : ""}` : "", r.losses ? `pertes ${MONEY(r.losses.value)}` : ""].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="mt-0.5 inline-block"><Pill tone={st.tone}>{st.label}</Pill></span>
                    </td>
                    <td className="text-right font-mono text-ink2">{e.unitCost ? UNIT(e.unitCost) : "—"}</td>
                    <td className="text-right font-mono">{r.salePrice ? MONEY(r.salePrice) : "—"}{e.suggestedPrice && e.status !== "ok" ? <span className="block text-[11px] text-section">conseillé {MONEY(e.suggestedPrice)}</span> : null}</td>
                    <td className={`text-right font-mono font-semibold ${e.marginUnit < 0 ? "text-neg" : "text-ink"}`}>{e.status === "unknown" ? "—" : UNIT(e.marginUnit)}</td>
                    <td className="text-right font-mono">{PCT(e.markupRate)}</td>
                    <td className={`text-right font-mono ${(e.packMargin ?? 0) < 0 ? "text-neg" : "text-ink2"}`}>{e.packMargin === null ? "—" : MONEY(e.packMargin)}</td>
                    <td className="text-right font-mono text-ink2 whitespace-nowrap">{r.quantity} {r.unit}<span className="block text-[11px]">{MONEY(r.outlook.expectedRevenue)} / {MONEY(r.outlook.expectedMargin)}</span></td>
                    <td className="text-right font-mono whitespace-nowrap">{r.sold ? <>{r.sold.quantity} · {MONEY(r.sold.revenueTTC)}<span className={`block text-[11px] ${r.sold.margin < 0 ? "text-neg" : "text-pos"}`}>marge {MONEY(r.sold.margin)}</span></> : <span className="text-ink3">—</span>}</td>
                    <td className="text-right"><button onClick={() => setEdit(r)} className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title="Prix et conditionnement"><Pencil size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
      {edit && <PricingDialog row={edit} all={data.items} vatRate={data.vatRate} target={data.targetMarkup} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChange(); }} />}
    </div>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: "pos" | "neg"; hint?: string }) {
  return (
    <div className="surface-card p-4" title={hint}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-ink"}`}>{value}</p>
    </div>
  );
}

/** Lecture humaine d'un calcul de marge. */
function Verdict({ e, unit = "unité", packLabel }: { e: Economics; unit?: string; packLabel?: string }) {
  if (e.status === "unknown") return <p className="text-sm text-ink3">Renseignez le prix d&apos;achat et le prix de vente.</p>;
  return (
    <div className="text-sm space-y-1">
      <p>Coût de revient : <b>{UNIT(e.unitCost)}</b> par {unit}{e.fromPack ? " (prix du paquet ÷ unités)" : ""}.</p>
      <p className={e.marginUnit < 0 ? "text-neg font-semibold" : "text-pos font-semibold"}>
        {e.marginUnit < 0 ? `Perte de ${UNIT(-e.marginUnit)} par ${unit} vendu(e)` : `Marge de ${UNIT(e.marginUnit)} par ${unit} vendu(e)`}
        {e.markupRate !== null ? ` — ${PCT(e.markupRate)} du prix de vente` : ""}{e.marginRate !== null ? `, ${PCT(e.marginRate)} du coût` : ""}.
      </p>
      {e.packMargin !== null && <p>{packLabel || "Paquet"} vendu en entier : chiffre d&apos;affaires <b>{MONEY(e.packRevenue)}</b>, marge <b className={e.packMargin < 0 ? "text-neg" : "text-pos"}>{MONEY(e.packMargin)}</b>.</p>}
      <p className="text-ink2">Prix plancher : {MONEY(e.breakEvenPrice)}{e.suggestedPrice ? ` · prix conseillé : ${MONEY(e.suggestedPrice)}` : ""}.</p>
    </div>
  );
}

/** Calculateur libre : prix d'achat (à l'unité ou au paquet) et prix de vente. */
function MarginCalculator({ vatRate, target }: { vatRate: number; target: number }) {
  const [f, setF] = useState({ packCost: "5000", size: "24", unitCost: "", price: "200" });
  const e = itemEconomics({ unitCost: Number(f.unitCost) || undefined, pack: f.unitCost ? null : { size: Number(f.size) || 0, cost: Number(f.packCost) || 0 }, salePrice: Number(f.price) || 0, vatRate, targetMarkup: target });
  return (
    <section className="surface-card p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Calculator size={15} /> Calculer une marge</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FormField label="Prix du paquet"><input type="number" min={0} className={inputCls} value={f.packCost} disabled={!!f.unitCost} onChange={x => setF(p => ({ ...p, packCost: x.target.value }))} /></FormField>
        <FormField label="Unités par paquet"><input type="number" min={1} className={inputCls} value={f.size} disabled={!!f.unitCost} onChange={x => setF(p => ({ ...p, size: x.target.value }))} /></FormField>
        <FormField label="… ou coût à l'unité"><input type="number" min={0} className={inputCls} value={f.unitCost} placeholder="ex. 150" onChange={x => setF(p => ({ ...p, unitCost: x.target.value }))} /></FormField>
        <FormField label="Prix de vente (unité)"><input type="number" min={0} className={inputCls} value={f.price} onChange={x => setF(p => ({ ...p, price: x.target.value }))} /></FormField>
      </div>
      <Verdict e={e} />
      {vatRate > 0 && <p className="text-[11px] text-ink3">Comptoir assujetti à la TVA ({Math.round(vatRate * 100)} %) : la marge se calcule sur le prix hors taxe.</p>}
    </section>
  );
}

/** Prix de vente, famille et conditionnement d'un article, avec la marge en direct. */
function PricingDialog({ row, all, vatRate, target, onClose, onSaved }: { row: Row; all: Row[]; vatRate: number; target: number; onClose: () => void; onSaved: () => void }) {
  // Fiche recette : ingrédients parmi les articles simples du comptoir.
  const [recipe, setRecipe] = useState(row.recipe.map(r => ({ itemId: r.itemId, quantity: String(r.quantity) })));
  const ingredients = all.filter(x => x._id !== row._id && !x.recipe.length);
  const costOf = (id: string) => all.find(x => x._id === id)?.economics.unitCost ?? 0;
  const recipeCost = recipe.reduce((t, r) => t + (Number(r.quantity) || 0) * costOf(r.itemId), 0);
  const isPrepared = recipe.some(r => r.itemId && Number(r.quantity) > 0);
  const [f, setF] = useState({
    salePrice: String(row.salePrice ?? ""), category: row.category,
    packLabel: row.pack?.label ?? "", packSize: String(row.pack?.size ?? ""), packCost: String(row.pack?.cost ?? ""),
    unitCost: String(row.linked ? row.economics.unitCost : row.pack?.cost ? "" : row.economics.unitCost || ""),
  });
  const [busy, setBusy] = useState(false);
  const pack = Number(f.packSize) > 0 ? { label: f.packLabel || undefined, size: Number(f.packSize), cost: row.linked ? undefined : Number(f.packCost) || undefined } : null;
  const e = itemEconomics({ unitCost: isPrepared ? recipeCost : Number(f.unitCost) || 0, pack: isPrepared ? null : pack, salePrice: Number(f.salePrice) || 0, vatRate, targetMarkup: target });
  async function save() {
    setBusy(true);
    const res = await apiSend("PATCH", `/api/comptoir/items/${row._id}`, {
      salePrice: Number(f.salePrice) || 0, category: f.category, pack: isPrepared ? null : pack ?? null,
      recipe: recipe.filter(r => r.itemId && Number(r.quantity) > 0).map(r => ({ itemId: r.itemId, quantity: Number(r.quantity) })),
      ...(!row.linked && !pack?.cost && f.unitCost !== "" ? { unitCost: Number(f.unitCost) || 0 } : {}),
    });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
    showToast("Article mis à jour.", "success"); onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Prix et conditionnement — ${row.name}`} size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prix de vente à l'unité (TTC)"><input type="number" min={0} className={inputCls} value={f.salePrice} onChange={x => setF(p => ({ ...p, salePrice: x.target.value }))} /></FormField>
          <FormField label="Famille" hint="Boissons, biscuits, snacks…"><input className={inputCls} maxLength={60} value={f.category} onChange={x => setF(p => ({ ...p, category: x.target.value }))} /></FormField>
        </div>
        <fieldset className="rounded-xl border border-line p-3 space-y-3">
          <legend className="px-1 text-xs font-semibold text-ink2">Achat par conditionnement (facultatif)</legend>
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Nom"><input className={inputCls} maxLength={30} placeholder="paquet, carton…" value={f.packLabel} onChange={x => setF(p => ({ ...p, packLabel: x.target.value }))} /></FormField>
            <FormField label="Unités"><input type="number" min={1} className={inputCls} value={f.packSize} onChange={x => setF(p => ({ ...p, packSize: x.target.value }))} /></FormField>
            {!row.linked && <FormField label="Prix d'achat"><input type="number" min={0} className={inputCls} value={f.packCost} onChange={x => setF(p => ({ ...p, packCost: x.target.value }))} /></FormField>}
          </div>
          {row.linked && <p className="text-[11px] text-ink3">Article du catalogue : son coût est le coût moyen réel des achats.</p>}
        </fieldset>
        {!row.linked && !pack?.cost && <FormField label="Coût d'achat à l'unité"><input type="number" min={0} className={inputCls} value={f.unitCost} onChange={x => setF(p => ({ ...p, unitCost: x.target.value }))} /></FormField>}
        <fieldset className="rounded-xl border border-line p-3 space-y-2">
          <legend className="px-1 text-xs font-semibold text-ink2">Fiche recette (préparation maison : pastel, café, jus…)</legend>
          <p className="text-[11px] text-ink3">Quantité de chaque ingrédient pour UNE unité vendue (ex. 0,05 kg de farine). La vente sortira les ingrédients du stock.</p>
          {recipe.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <select className={`${inputCls} col-span-7`} value={r.itemId} onChange={x => setRecipe(rs => rs.map((y, j) => (j === i ? { ...y, itemId: x.target.value } : y)))} aria-label="Ingrédient">
                <option value="">— Ingrédient —</option>{ingredients.map(x => <option key={x._id} value={x._id}>{x.name} ({x.unit})</option>)}
              </select>
              <input type="number" min={0} step="any" className={`${inputCls} col-span-3`} value={r.quantity} onChange={x => setRecipe(rs => rs.map((y, j) => (j === i ? { ...y, quantity: x.target.value } : y)))} aria-label="Quantité" />
              <button type="button" onClick={() => setRecipe(rs => rs.filter((_, j) => j !== i))} className="col-span-2 text-xs text-ink3 hover:text-neg">retirer</button>
            </div>
          ))}
          <button type="button" onClick={() => setRecipe(rs => [...rs, { itemId: "", quantity: "" }])} className={buttonClass("ghost", "sm")}>+ Ingrédient</button>
          {isPrepared && <p className="text-xs text-ink2">Coût de la recette : <b>{UNIT(Math.round(recipeCost * 100) / 100)}</b> par {row.unit}.</p>}
        </fieldset>
        <div className="surface-card p-3"><Verdict e={e} unit={row.unit} packLabel={f.packLabel ? f.packLabel[0].toUpperCase() + f.packLabel.slice(1) : undefined} /></div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={busy} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
