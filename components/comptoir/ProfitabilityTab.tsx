"use client";
import { useMemo, useState } from "react";
import { TrendingUp, AlertTriangle, Calculator, Pencil, Trophy, Target } from "lucide-react";
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

interface Gap {
  expected: number; realized: number; gap: number; priceEffect: number; promoEffect: number; discountEffect: number; manualEffect: number; otherPriceEffect: number;
  costEffect: number; lossEffect: number; markupRealized: number | null; targetPct: number; shortfall: number; belowTarget: boolean;
}
interface Row {
  _id: string; name: string; unit: string; category: string; quantity: number; salePrice: number | null; linked: boolean;
  pack: { label?: string; size?: number; cost?: number } | null;
  economics: Economics; outlook: { expectedRevenue: number; expectedMargin: number | null; stockValue: number };
  sold: { quantity: number; revenueTTC: number; revenueHT: number; margin: number; tickets: number; rank: number; unvaluedQty: number } | null;
  recipe: Array<{ itemId: string; quantity: number; yield?: number; name: string }>; portions?: number; recipeMissing: number;
  losses: { quantity: number; value: number } | null;
  target: number; targetOwn: boolean;
  gap: Gap | null;
}
interface Data {
  from: string; to: string; targetMarkup: number; vatRate: number; items: Row[];
  totals: { stockValue: number; expectedRevenue: number; expectedMargin: number; soldRevenue: number; soldMargin: number; losses: number; thin: number; unpriced: number; shrinkage: number;
    expectedOnSold: number; realizedOnSold: number; gap: number; priceEffect: number; promoEffect: number; discountEffect: number; manualEffect: number; otherPriceEffect: number;
    costEffect: number; lossEffect: number; otherLosses: number; shortfall: number; revenueHTOnSold: number; belowTarget: number; unvaluedItems: number };
  tolerancePts: number;
  shrinkageByReason: Array<{ reason: string; label: string; value: number }>;
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
  const [sort, setSort] = useState<"auto" | "rank" | "margin" | "markup" | "name" | "shortfall">("auto");
  const [edit, setEdit] = useState<Row | null>(null);
  const { data, reload } = useApi<Data | null>(`/api/comptoir/profitability?deskId=${deskId}&from=${from}&to=${to}`, d => d?.data ?? null, null);

  const rows = useMemo(() => {
    const r = [...(data?.items ?? [])];
    // Par défaut : les articles sous leur objectif d'abord, s'il y en a ; sinon les meilleures ventes.
    const mode = sort === "auto" ? ((data?.totals.belowTarget ?? 0) > 0 ? "shortfall" : "rank") : sort;
    if (mode === "rank") r.sort((a, b) => (a.sold?.rank ?? 1e9) - (b.sold?.rank ?? 1e9) || a.name.localeCompare(b.name));
    if (mode === "margin") r.sort((a, b) => (b.sold?.margin ?? -1e12) - (a.sold?.margin ?? -1e12));
    if (mode === "markup") r.sort((a, b) => (a.economics.markupRate ?? 1e9) - (b.economics.markupRate ?? 1e9));
    if (mode === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    if (mode === "shortfall") r.sort((a, b) => (b.gap?.shortfall ?? -1) - (a.gap?.shortfall ?? -1) || (a.gap?.gap ?? 0) - (b.gap?.gap ?? 0));
    return r;
  }, [data, sort]);

  function exportCsv() {
    if (!data) return;
    const head = ["Article", "Famille", "Coût unitaire", "Prix de vente", "Marge unitaire", "Marge en % du prix", "Objectif %", "Stock", "CA si tout le stock est vendu", "Marge si tout le stock est vendu", "Vendus", "CA réalisé TTC",
      "Marge attendue HT", "Marge réalisée HT (après pertes)", "Écart", "dont promotions", "dont remises", "dont prix saisis en caisse", "dont autres prix", "dont achats", "dont pertes", "Marge réalisée %", "Manque à gagner / objectif", "Ventes sans coût"];
    const lines = data.items.map(r => [r.name, r.category, r.economics.unitCost, r.salePrice ?? "", r.economics.marginUnit, r.economics.markupRate ?? "", Math.round(r.target * 1000) / 10, r.quantity, r.outlook.expectedRevenue, r.outlook.expectedMargin ?? "", r.sold?.quantity ?? 0, r.sold?.revenueTTC ?? 0,
      r.gap?.expected ?? "", r.gap?.realized ?? "", r.gap?.gap ?? "", r.gap?.promoEffect ?? "", r.gap?.discountEffect ?? "", r.gap?.manualEffect ?? "", r.gap?.otherPriceEffect ?? "", r.gap?.costEffect ?? "", r.gap?.lossEffect ?? "", r.gap?.markupRealized ?? "", r.gap?.shortfall ?? "", r.sold?.unvaluedQty ?? 0]);
    const csv = "\uFEFF" + [head, ...lines].map(l => l.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `marges-comptoir-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (!data) return <div className="h-48 surface-card animate-pulse" />;
  const t = data.totals;
  const unvalued = data.items.filter(r => (r.sold?.unvaluedQty ?? 0) > 0);
  const effects: Array<[string, number, string]> = [
    ["Promotions", t.promoEffect, "Prix des promotions en cours, plus bas que le prix affiché"],
    ["Remises", t.discountEffect, "Remises en % accordées à la caisse"],
    ["Prix saisis à la caisse", t.manualEffect, "Prix tapé par le caissier au lieu du prix affiché"],
    ["Autres écarts de prix", t.otherPriceEffect, "Prix affiché changé en cours de période, anciennes ventes"],
    ["Achats plus chers ou moins chers", t.costEffect, "Coût réel des ventes comparé au coût de la fiche"],
    ["Pertes et casse", t.lossEffect, "Pertes des articles vendus, au coût"],
    ["Pertes sur articles non vendus ou ingrédients", t.otherLosses, "Casse, péremption ou erreurs sur des articles sans vente sur la période"],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Ventes du"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></FormField>
        <FormField label="au"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></FormField>
      </div>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Target size={15} /> Marge des ventes de la période (hors taxes)</h3>
        {t.revenueHTOnSold > 0 ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-ink2">Marge attendue</p><p className="font-mono font-bold text-lg">{MONEY(t.expectedOnSold)}</p><p className="text-[11px] text-ink3">au prix affiché et au coût de la fiche</p></div>
              <div><p className="text-xs text-ink2">Marge réalisée</p><p className={`font-mono font-bold text-lg ${t.realizedOnSold < 0 ? "text-neg" : ""}`}>{MONEY(t.realizedOnSold)}</p><p className="text-[11px] text-ink3">pertes déduites</p></div>
              <div><p className="text-xs text-ink2">Écart</p><p className={`font-mono font-bold text-lg ${t.gap < 0 ? "text-neg" : "text-pos"}`}>{t.gap > 0 ? "+" : ""}{MONEY(t.gap)}</p></div>
              <div><p className="text-xs text-ink2">Manque à gagner par rapport à l&apos;objectif</p><p className={`font-mono font-bold text-lg ${t.shortfall > 0 ? "text-warn" : "text-pos"}`}>{MONEY(t.shortfall)}</p><p className="text-[11px] text-ink3">{t.belowTarget ? `${t.belowTarget} article(s) sous leur objectif` : "objectifs atteints"}</p></div>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink2 mb-1">D&apos;où vient l&apos;écart</p>
              <ul className="text-sm divide-y divide-line">
                {effects.filter(([, v]) => Math.round(v) !== 0).map(([l, v, hint]) => (
                  <li key={l} className="py-1.5 flex justify-between gap-3"><span><span className="text-ink">{l}</span> <span className="block sm:inline text-[11px] text-ink3">{hint}</span></span><span className={`font-mono shrink-0 ${v < 0 ? "text-neg" : "text-pos"}`}>{v > 0 ? "+" : ""}{MONEY(v)}</span></li>
                ))}
                {effects.every(([, v]) => Math.round(v) === 0) && <li className="py-1.5 text-ink3">Aucun écart : ventes au prix affiché et au coût de la fiche.</li>}
              </ul>
              {data.shrinkageByReason.length > 0 && (
                <p className="text-[11px] text-ink3 mt-1">Pertes de la période par motif : {data.shrinkageByReason.map(r => `${r.label} ${MONEY(r.value)}`).join(" · ")}</p>
              )}
            </div>
          </>
        ) : <p className="text-sm text-ink3">Aucune vente au coût connu sur la période.</p>}
        {unvalued.length > 0 && (
          <p className="text-xs text-warn flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{unvalued.length} article(s) vendu(s) sans coût d&apos;achat, exclus du calcul : {unvalued.slice(0, 5).map(r => r.name).join(", ")}{unvalued.length > 5 ? "…" : ""}. Renseignez leur coût (crayon), par exemple pour les articles créés depuis EasyPay.</span></p>
        )}
      </section>

      {(t.losses > 0 || t.thin > 0 || t.unpriced > 0) && (
        <div className="px-4 py-3 rounded-xl bg-warn-50 border border-warn/25 text-sm text-warn inline-flex gap-2 items-start">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{[t.losses ? `${t.losses} article(s) à prix affiché sous le coût` : "", t.thin ? `${t.thin} à marge mince (moins de 15 % du prix)` : "", t.unpriced ? `${t.unpriced} sans coût ou sans prix` : ""].filter(Boolean).join(" · ")}. Corrigez le prix ou le coût d&apos;achat (crayon).</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-bold text-ink">Par article</h3>
        <div className="flex gap-2 items-center">
          <select className="h-10 px-3 rounded-lg border border-line2 bg-surface text-sm" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Trier">
            <option value="auto">Ordre conseillé</option><option value="shortfall">Plus gros manque à gagner d&apos;abord</option><option value="rank">Meilleures ventes d&apos;abord</option><option value="margin">Plus forte marge réalisée</option><option value="markup">Marge la plus faible d&apos;abord</option><option value="name">Ordre alphabétique</option>
          </select>
          <button onClick={exportCsv} className={buttonClass("secondary", "md")}>Export CSV</button>
        </div>
      </div>

      {rows.length === 0 ? <EmptyState icon={<TrendingUp size={20} />} title="Aucun article" hint="Ajoutez vos articles dans l'onglet Stock matière." /> : (
        <>
          {/* Téléphone : une carte par article. */}
          <ul className="sm:hidden space-y-2">
            {rows.map(r => {
              const st = STATUS[r.economics.status];
              return (
                <li key={r._id} className="surface-card p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-ink">{r.name} <Pill tone={st.tone}>{st.label}</Pill></p>
                    <button onClick={() => setEdit(r)} className="p-1.5 rounded text-ink3 hover:text-section" aria-label={`Prix et objectif de ${r.name}`}><Pencil size={15} /></button>
                  </div>
                  <p className="text-xs text-ink2">Prix {r.salePrice ? MONEY(r.salePrice) : "—"} · coût {r.economics.unitCost ? UNIT(r.economics.unitCost) : "—"} · marge {PCT(r.economics.markupRate)} du prix · objectif {Math.round(r.target * 1000) / 10} %</p>
                  {r.gap ? (
                    <p className="text-sm">Attendue <b className="font-mono">{MONEY(r.gap.expected)}</b> · réalisée <b className="font-mono">{MONEY(r.gap.realized)}</b> · écart <b className={`font-mono ${r.gap.gap < 0 ? "text-neg" : "text-pos"}`}>{r.gap.gap > 0 ? "+" : ""}{MONEY(r.gap.gap)}</b>
                      {r.gap.belowTarget && <span className="block text-xs text-neg">Sous l&apos;objectif : {r.gap.markupRealized?.toLocaleString("fr-FR")} % pour {r.gap.targetPct} % (manque {MONEY(r.gap.shortfall)})</span>}</p>
                  ) : <p className="text-xs text-ink3">{r.sold ? "Vendu sans coût connu : marge non calculée." : "Pas de vente sur la période."}</p>}
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block surface-card overflow-hidden"><div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Article</th><th className="text-right">Coût unit.</th><th className="text-right">Prix</th><th className="text-right">Marge % du prix</th><th className="text-right">Objectif</th><th className="text-right">Vendus</th><th className="text-right">Marge attendue</th><th className="text-right">Marge réalisée</th><th className="text-right">Écart</th><th className="text-right">Stock</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const e = r.economics, st = STATUS[e.status], g = r.gap;
                  return (
                    <tr key={r._id}>
                      <td className="text-ink font-medium">{r.sold?.rank && r.sold.rank <= 3 ? <span className="mr-1 text-warn">#{r.sold.rank}</span> : null}{r.name}
                        <span className="block text-[11px] text-ink3">{r.category || "—"}{r.linked ? " · catalogue" : ""}{r.recipe.length ? " · préparation" : ""}{r.losses ? ` · pertes ${MONEY(r.losses.value)}` : ""} · <Pill tone={st.tone}>{st.label}</Pill></span>
                      </td>
                      <td className="text-right font-mono text-ink2">{e.unitCost ? UNIT(e.unitCost) : "—"}</td>
                      <td className="text-right font-mono">{r.salePrice ? MONEY(r.salePrice) : "—"}{e.suggestedPrice && e.status !== "ok" ? <span className="block text-[11px] text-section">conseillé {MONEY(e.suggestedPrice)}</span> : null}</td>
                      <td className="text-right font-mono">{PCT(e.markupRate)}</td>
                      <td className="text-right font-mono whitespace-nowrap">{Math.round(r.target * 1000) / 10} %{!r.targetOwn && <span className="block text-[11px] text-ink3">du comptoir</span>}{g?.markupRealized != null && <span className={`block text-[11px] ${g.belowTarget ? "text-neg font-semibold" : "text-pos"}`}>réalisé {g.markupRealized.toLocaleString("fr-FR")} %</span>}</td>
                      <td className="text-right font-mono whitespace-nowrap">{r.sold ? <>{r.sold.quantity}<span className="block text-[11px] text-ink3">{MONEY(r.sold.revenueTTC)} TTC</span></> : <span className="text-ink3">—</span>}</td>
                      <td className="text-right font-mono">{g ? MONEY(g.expected) : <span className="text-ink3">—</span>}</td>
                      <td className="text-right font-mono">{g ? MONEY(g.realized) : r.sold?.unvaluedQty ? <span className="text-[11px] text-warn">sans coût</span> : <span className="text-ink3">—</span>}</td>
                      <td className="text-right font-mono whitespace-nowrap">{g ? <><span className={g.gap < 0 ? "text-neg" : "text-pos"}>{g.gap > 0 ? "+" : ""}{MONEY(g.gap)}</span>{g.shortfall > 0 && g.belowTarget && <span className="block text-[11px] text-warn">manque {MONEY(g.shortfall)}</span>}</> : <span className="text-ink3">—</span>}</td>
                      <td className="text-right font-mono text-ink2 whitespace-nowrap">{r.quantity} {r.unit}</td>
                      <td className="text-right"><button onClick={() => setEdit(r)} className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title="Prix, objectif et conditionnement" aria-label={`Prix et objectif de ${r.name}`}><Pencil size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div></div>
        </>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Si tout le stock est vendu : CA" value={MONEY(t.expectedRevenue)} />
        <Kpi label="Si tout le stock est vendu : marge" value={MONEY(t.expectedMargin)} tone={t.expectedMargin < 0 ? "neg" : "pos"} />
        <Kpi label="CA de la période (TTC)" value={MONEY(t.soldRevenue)} />
        <Kpi label="Valeur du stock (au coût)" value={MONEY(t.stockValue)} />
      </div>

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

      <details className="surface-card p-4">
        <summary className="text-sm font-bold text-ink cursor-pointer inline-flex items-center gap-1.5"><Calculator size={15} /> Calculer une marge (paquet, prix de vente)</summary>
        <div className="mt-3"><MarginCalculator vatRate={data.vatRate} target={data.targetMarkup} /></div>
      </details>

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
    <section className="space-y-3">
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
  // Les rendements et le nombre de portions se règlent dans la fiche technique ; ils sont conservés ici.
  const yields = new Map(row.recipe.map(r => [r.itemId, r.yield]));
  const portions = row.portions && row.portions > 1 ? row.portions : 1;
  const [recipe, setRecipe] = useState(row.recipe.map(r => ({ itemId: r.itemId, quantity: String(r.quantity) })));
  const ingredients = all.filter(x => x._id !== row._id && !x.recipe.length);
  const costOf = (id: string) => all.find(x => x._id === id)?.economics.unitCost ?? 0;
  const recipeCost = recipe.reduce((t, r) => t + ((Number(r.quantity) || 0) / (yields.get(r.itemId) || 1) / portions) * costOf(r.itemId), 0);
  const isPrepared = recipe.some(r => r.itemId && Number(r.quantity) > 0);
  const [f, setF] = useState({
    salePrice: String(row.salePrice ?? ""), category: row.category,
    packLabel: row.pack?.label ?? "", packSize: String(row.pack?.size ?? ""), packCost: String(row.pack?.cost ?? ""),
    unitCost: String(row.linked ? row.economics.unitCost : row.pack?.cost ? "" : row.economics.unitCost || ""),
    target: row.targetOwn ? String(Math.round(row.target * 1000) / 10) : "",
  });
  const [busy, setBusy] = useState(false);
  const pack = Number(f.packSize) > 0 ? { label: f.packLabel || undefined, size: Number(f.packSize), cost: row.linked ? undefined : Number(f.packCost) || undefined } : null;
  const itemTarget = f.target !== "" && Number(f.target) >= 0 ? Number(f.target) / 100 : target;
  const e = itemEconomics({ unitCost: isPrepared ? recipeCost : Number(f.unitCost) || 0, pack: isPrepared ? null : pack, salePrice: Number(f.salePrice) || 0, vatRate, targetMarkup: itemTarget });
  async function save() {
    setBusy(true);
    const res = await apiSend("PATCH", `/api/comptoir/items/${row._id}`, {
      salePrice: Number(f.salePrice) || 0, category: f.category, pack: isPrepared ? null : pack ?? null,
      targetMarkup: f.target === "" ? null : Math.min(95, Math.max(0, Number(f.target) || 0)) / 100,
      recipe: recipe.filter(r => r.itemId && Number(r.quantity) > 0).map(r => ({ itemId: r.itemId, quantity: Number(r.quantity), ...(yields.get(r.itemId) ? { yield: yields.get(r.itemId) } : {}) })),
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
          <FormField label="Objectif de marge (% du prix hors taxes)" hint={`Sert au prix conseillé, à l'écart et aux alertes du matin. Vide = objectif du comptoir (${Math.round(target * 1000) / 10} %)`}><input type="number" min={0} max={95} step="0.5" className={inputCls} value={f.target} placeholder={String(Math.round(target * 1000) / 10)} onChange={x => setF(p => ({ ...p, target: x.target.value }))} /></FormField>
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
