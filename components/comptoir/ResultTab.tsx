"use client";
import { useEffect, useState } from "react";
import { Scale, Download, Lock, Unlock, Settings2, TrendingUp, Users, AlertTriangle, Target, Utensils, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { MetricCard } from "@/components/ui/MetricCard";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend, apiJson } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useMe, meCanDo } from "@/lib/useMe";
import { CHARGE_CATEGORIES, MENU_LABELS, type ChargeCategory, type MenuClass, type Pnl } from "@/lib/restaurant";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const PCT = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const share = (v: number, base: number) => (base > 0 ? `${Math.round((v / base) * 1000) / 10} %` : "");
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const MONTH_LABEL = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

interface Result {
  month: string; desk: { _id: string; name: string; hasSector: boolean; sharedWith: string[]; commonShare: number; target: number }; pnl: Pnl;
  target: { targetResult: number; missing: number; priceUpliftPct: number | null };
  sales: { tickets: number; revenueTTC: number; cancelled: number; unvaluedLines: number; vatByRate: Array<{ rate: number; ht: number; tva: number }>; byMethod: Array<{ method: string; amount: number }> };
  warnings: string[]; staffTotal: number;
  consumption: Array<{ itemId: string; name: string; unit: string; sold: number; losses: number; inventoryGap: number; real: number; varianceValue: number; variancePct: number | null }>;
  reconciliation: { accountingRevenue: number; accountingPurchases: number; stockEntriesValued: number; unvaluedReceptions: number; untaggedCharges: number };
  lossesByReason: Array<{ reason: string; label: string; value: number }>;
  inventories: Array<{ number: string; level: string; gapValue: number; validatedAt: string }>;
  chargesDetail: Array<{ category: ChargeCategory; accountCode: string; accountLabel: string; amount: number }>;
  staffDetail: Array<{ employeeId: string; name: string; share: number; allocated: number }>;
  closed: { closedAt: string; result: number; drift: number } | null;
  menu: Array<{ id: string; name: string; category?: string; quantity: number; unitMargin: number; mix: number; class: MenuClass }>;
  trend?: Array<{ month: string; revenueHT: number; materialMargin: number; charges: number; result: number; foodCostPct: number | null }>;
}
interface All { month: string; rows: Array<{ deskId: string; name: string; hasSector: boolean; closed: boolean; revenueHT: number; unvaluedRevenueHT: number; warnings: number; materialMargin: number; charges: number; result: number; foodCostPct: number | null; staffCostPct: number | null; tickets: number }>; totals: { revenueHT: number; materialMargin: number; charges: number; result: number; tickets: number } }

/**
 * Résultat du restaurant (gestion), mois par mois : ce que le comptoir a
 * vendu, ce que la marchandise a coûté, ce qui s'est perdu, ce que le
 * restaurant coûte à faire tourner (personnel, eau, électricité, loyer…) et
 * ce qui reste. Pour le chef du comptoir, la direction et le comptable.
 */
export function ResultTab({ deskId }: { deskId: string }) {
  const me = useMe();
  const finance = meCanDo(me, "accountingEntries", "read");
  const [month, setMonth] = useState(monthOf());
  const [scope, setScope] = useState<"desk" | "all">("desk");
  const [settings, setSettings] = useState(false);
  const { data: r, reload } = useApi<Result | null>(scope === "desk" ? `/api/comptoir/result?deskId=${deskId}&month=${month}&trend=1` : null, d => (d?.data as Result) ?? null, null);
  const { data: all } = useApi<All | null>(scope === "all" ? `/api/comptoir/result?all=1&month=${month}` : null, d => (d?.data as All) ?? null, null);
  const past = month < monthOf();

  async function exportXlsx() {
    const res = await fetch(`/api/comptoir/result?deskId=${deskId}&month=${month}&format=xlsx`, { credentials: "include" });
    if (!res.ok) return showToast("Export impossible", "error");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `resultat-${month}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }
  const [closing, setClosing] = useState<"close" | "reopen" | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Mois"><input type="month" className={inputCls} value={month} max={monthOf()} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
        <div className="flex gap-1 mb-0.5">
          {([["desk", "Ce comptoir"], ["all", "Tous les comptoirs"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)} className={`px-3 h-9 rounded-full border text-[13px] font-semibold ${scope === k ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{l}</button>
          ))}
        </div>
        {scope === "desk" && <div className="flex flex-wrap gap-2 ml-auto">
          <button onClick={() => setSettings(true)} className={buttonClass("secondary", "md")}><Settings2 size={15} /> Personnel et charges prévues</button>
          <button onClick={exportXlsx} className={buttonClass("secondary", "md")}><Download size={15} /> Dossier Excel du mois</button>
          {finance && past && (r?.closed
            ? <button onClick={() => setClosing("reopen")} className={buttonClass("ghost", "md")}><Unlock size={15} /> Rouvrir le mois</button>
            : <button onClick={() => setClosing("close")} className={buttonClass("primary", "md")}><Lock size={15} /> Clôturer le mois</button>)}
        </div>}
      </div>

      {scope === "all" ? <AllDesks data={all} /> : !r ? <div className="h-64 surface-card animate-pulse" /> : <DeskResult r={r} />}
      {settings && <SettingsDialog deskId={deskId} payroll={meCanDo(me, "payslips", "read")} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reload(); }} />}
      {closing && <CloseDialog deskId={deskId} month={month} action={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload(); }} />}
    </div>
  );
}

function DeskResult({ r }: { r: Result }) {
  const p = r.pnl, q = p.ratios, ca = p.revenueHT;
  const [open, setOpen] = useState<ChargeCategory | null>(null);
  const rows: Array<[string, number, string?, boolean?]> = [
    ["Chiffre d'affaires HT", p.revenueHT, `${r.sales.tickets} ticket(s), ${MONEY(r.sales.revenueTTC)} TTC`, true],
    ...(p.unvaluedRevenueHT ? [["dont ventes sans coût connu, hors marge", -p.unvaluedRevenueHT, "renseignez leur coût (onglet Marges) pour les compter"] as [string, number, string]] : []),
    ["− Coût des marchandises vendues", -p.costOfSales, "au coût de revient de chaque ligne (CMUP, recettes)"],
    ...(p.cashPurchases ? [["− Achats payés en caisse hors réception", -p.cashPurchases, "comptés comme consommés dans le mois"] as [string, number, string]] : []),
    ["= Marge brute", p.grossMargin, undefined, true],
    ["− Pertes déclarées", -p.losses, "casse, péremption, invendus, déchets, plats ratés"],
    ["− Repas du personnel et offerts", -p.staffAndOffered, "hors coût matière"],
    [p.inventoryGap < 0 ? "− Manquants d'inventaire" : "+ Écarts d'inventaire", p.inventoryGap, "comptoir et réserve, au coût"],
    ["= Marge matière", p.materialMargin, undefined, true],
  ];
  const max = Math.max(1, ...(r.trend ?? []).map(t => Math.max(Math.abs(t.result), t.revenueHT)));
  return (
    <div className="space-y-5">
      {r.warnings.map(w => <p key={w} className="text-sm text-warn flex gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}</p>)}
      {r.closed && <p className={`text-sm flex gap-1.5 ${r.closed.drift ? "text-warn" : "text-ink2"}`}><Lock size={15} className="mt-0.5 shrink-0" /> Mois clos le {new Date(r.closed.closedAt).toLocaleDateString("fr-FR")} sur un résultat de {MONEY(r.closed.result)}{r.closed.drift ? ` — écart depuis la clôture : ${MONEY(r.closed.drift)} (vente ou écriture arrivée après)` : ""}.</p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<TrendingUp size={18} />} tone="blue" label="Chiffre d'affaires HT" value={MONEY(ca)} sub={q.averageTicket ? `ticket moyen ${MONEY(q.averageTicket)}` : "—"} />
        <MetricCard icon={<Utensils size={18} />} tone="green" label="Marge matière" value={MONEY(p.materialMargin)} sub={`coût matière ${PCT(q.foodCostPct)} du CA`} />
        <MetricCard icon={<Users size={18} />} tone="violet" label="Charges de fonctionnement" value={MONEY(p.totalCharges)} sub={`dont personnel ${PCT(q.staffCostPct)} du CA`} />
        <MetricCard icon={<Scale size={18} />} tone={p.result < 0 ? "red" : "green"} label="Résultat du comptoir" value={MONEY(p.result)} valueCls={p.result < 0 ? "text-neg" : ""} sub={`marge nette ${PCT(q.resultPct)} du CA`} />
      </div>
      {p.revenueHT > 0 && (
        <section className={`surface-card p-4 flex flex-wrap items-center gap-3 ${r.target.missing ? "border-warn" : "border-pos"}`}>
          <Target size={18} className={r.target.missing ? "text-warn" : "text-pos"} />
          <p className="text-sm flex-1 min-w-[16rem]">
            Objectif : <span className="font-semibold">{PCT(Math.round(r.desk.target * 1000) / 10)} de marge nette</span>, tous frais compris (personnel, eau, électricité, loyer…), soit un résultat de {MONEY(r.target.targetResult)}.{" "}
            {r.target.missing
              ? <>Il manque <span className="font-semibold text-warn">{MONEY(r.target.missing)}</span>{r.target.priceUpliftPct !== null ? <>, soit une hausse moyenne des prix de <span className="font-semibold">{PCT(r.target.priceUpliftPct)}</span> à volumes égaux</> : null} — ou moins de charges et de pertes, ou plus de ventes. Voir les articles sous leur prix minimum dans Restauration → Prix et marges.</>
              : <span className="text-pos font-semibold">Objectif atteint.</span>}
          </p>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <section className="surface-card p-4">
          <h3 className="font-semibold text-ink mb-2">Compte de résultat de gestion — {MONTH_LABEL(r.month)}</h3>
          <table className="table-dense w-full">
            <thead><tr><th>Rubrique</th><th className="text-right">Réel</th><th className="text-right">% CA</th><th className="text-right">Prévu</th></tr></thead>
            <tbody>
              {rows.map(([l, v, hint, bold]) => (
                <tr key={l} className="border-t border-line"><td className={bold ? "font-semibold" : ""}>{l}{hint && <span className="block text-[11px] text-ink3 font-normal">{hint}</span>}</td><td className={`text-right font-mono ${bold ? "font-semibold" : ""} ${v < 0 ? "text-neg" : ""}`}>{MONEY(v)}</td><td className="text-right text-xs text-ink3">{share(Math.abs(v), ca)}</td><td></td></tr>
              ))}
              {p.charges.map(c => (
                <tr key={c.category} className="border-t border-line cursor-pointer hover:bg-surface2" onClick={() => setOpen(o => o === c.category ? null : c.category)}>
                  <td className="pl-4">− {c.label}
                    {open === c.category && <span className="block text-[11px] text-ink3">{c.category === "personnel" && r.staffDetail.length ? r.staffDetail.map(s => `${s.name} (${Math.round(s.share * 100)} %) ${MONEY(s.allocated)}`).join(" · ") : c.category === "personnel" && r.staffTotal ? `personnel affecté ${MONEY(r.staffTotal)} (détail réservé à la paie)` : null}{r.chargesDetail.filter(d => d.category === c.category).map(d => `${d.accountCode} ${d.accountLabel} ${MONEY(d.amount)}`).join(" · ")}</span>}
                  </td>
                  <td className="text-right font-mono text-neg">{MONEY(-c.actual)}</td><td className="text-right text-xs text-ink3">{share(c.actual, ca)}</td>
                  <td className={`text-right font-mono text-xs ${c.planned && c.actual > c.planned ? "text-warn font-semibold" : "text-ink2"}`}>{c.planned ? MONEY(-c.planned) : ""}</td>
                </tr>
              ))}
              <tr className="border-t border-line"><td className="font-semibold">Total des charges</td><td className="text-right font-mono font-semibold text-neg">{MONEY(-p.totalCharges)}</td><td className="text-right text-xs text-ink3">{share(p.totalCharges, ca)}</td><td className="text-right font-mono text-xs text-ink2">{p.plannedCharges ? MONEY(-p.plannedCharges) : ""}</td></tr>
              <tr className="border-t-2 border-ink"><td className="font-bold">= Résultat du comptoir</td><td className={`text-right font-mono font-bold ${p.result < 0 ? "text-neg" : "text-pos"}`}>{MONEY(p.result)}</td><td className="text-right text-xs text-ink3">{share(p.result, ca)}</td><td></td></tr>
            </tbody>
          </table>
          <p className="text-[11px] text-ink3 mt-2">Charges : écritures comptables imputées au secteur du comptoir (factures, dépenses de caisse), hors achats de marchandises (601 à 603, déjà comptés au coût des ventes){r.desk.commonShare ? `, plus ${Math.round(r.desk.commonShare * 100)} % des charges communes sans secteur` : ""}. Personnel : coût employeur des bulletins du mois au prorata du temps passé au comptoir. Cliquez sur une ligne pour le détail par compte.</p>
        </section>

        <div className="space-y-5">
          <section className="surface-card p-4 space-y-2">
            <h3 className="font-semibold text-ink flex items-center gap-2"><Target size={16} /> Repères</h3>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-ink2">Coût matière</dt><dd className="text-right font-mono">{PCT(q.foodCostPct)}</dd>
              <dt className="text-ink2">Coût du personnel</dt><dd className="text-right font-mono">{PCT(q.staffCostPct)}</dd>
              <dt className="text-ink2">Matière + personnel</dt><dd className="text-right font-mono">{PCT(q.primeCostPct)}</dd>
              <dt className="text-ink2">Taux de marge matière</dt><dd className="text-right font-mono">{PCT(q.marginRate)}</dd>
              <dt className="text-ink2">Coût de revient par ticket</dt><dd className="text-right font-mono">{MONEY(q.costPerTicket)}</dd>
              <dt className="text-ink2">Point mort du mois</dt><dd className="text-right font-mono">{MONEY(q.breakEvenRevenue)}</dd>
              <dt className="text-ink2">soit par jour d&apos;ouverture</dt><dd className="text-right font-mono font-semibold">{MONEY(q.breakEvenPerDay)}</dd>
            </dl>
            <p className="text-[11px] text-ink3">Point mort : chiffre d&apos;affaires HT qui couvre les charges du mois au taux de marge matière constaté (pour le mois en cours, rubrique par rubrique, les charges prévues si elles dépassent le réel).</p>
          </section>
          {(r.lossesByReason.length > 0 || r.inventories.length > 0) && (
            <section className="surface-card p-4 space-y-2">
              <h3 className="font-semibold text-ink">Pertes et inventaires</h3>
              {r.lossesByReason.map(l => <p key={l.reason} className="text-sm flex justify-between"><span className="text-ink2">{l.label}</span><span className="font-mono text-neg">{MONEY(-l.value)}</span></p>)}
              {r.inventories.map(i => <p key={i.number} className="text-sm flex justify-between"><span className="text-ink2">{i.number} ({i.level === "reserve" ? "réserve" : "comptoir"})</span><span className={`font-mono ${i.gapValue < 0 ? "text-neg" : ""}`}>{MONEY(i.gapValue)}</span></p>)}
            </section>
          )}
        </div>
      </div>

      <section className="surface-card p-4 space-y-2">
        <h3 className="font-semibold text-ink">Rapprochement avec la comptabilité</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-ink2">CA comptable du secteur (70)</dt><dd className="text-right font-mono">{MONEY(r.reconciliation.accountingRevenue)}</dd>
          <dt className="text-ink2">CA de gestion (tickets)</dt><dd className="text-right font-mono">{MONEY(p.revenueHT)}</dd>
          <dt className="text-ink2">Écart à expliquer</dt><dd className={`text-right font-mono ${r.reconciliation.accountingRevenue - p.revenueHT ? "text-warn font-semibold" : ""}`}>{MONEY(r.reconciliation.accountingRevenue - p.revenueHT)}</dd>
          <dt className="text-ink2">Achats 601 à 603 du secteur</dt><dd className="text-right font-mono">{MONEY(r.reconciliation.accountingPurchases)}</dd>
          <dt className="text-ink2">Entrées en stock valorisées</dt><dd className="text-right font-mono">{MONEY(r.reconciliation.stockEntriesValued)}</dd>
          <dt className="text-ink2">Charges du mois sans secteur (toute l&apos;organisation)</dt><dd className="text-right font-mono">{MONEY(r.reconciliation.untaggedCharges)}</dd>
        </dl>
        <p className="text-[11px] text-ink3">Un écart de CA vient d&apos;entrées de caisse hors ticket, d&apos;annulations ou d&apos;écritures saisies à la main ; un écart d&apos;achats, de marchandises achetées sans entrée en stock (ou l&apos;inverse). Les charges sans secteur se répartissent par la quote-part (Personnel et charges prévues).</p>
      </section>

      {r.consumption.length > 0 && (
        <section className="surface-card p-4 space-y-2">
          <h3 className="font-semibold text-ink">Consommation théorique et réelle</h3>
          <p className="text-xs text-ink3">Théorique : ce que les ventes (et les recettes) auraient dû consommer. Réelle : théorique + pertes déclarées + manquants d&apos;inventaire. Les plus gros écarts d&apos;abord.</p>
          <div className="overflow-x-auto"><table className="table-dense w-full">
            <thead><tr><th>Article</th><th className="text-right">Théorique</th><th className="text-right">Pertes</th><th className="text-right">Inventaire</th><th className="text-right">Réelle</th><th className="text-right">Écart</th><th className="text-right">Écart (%)</th></tr></thead>
            <tbody>{r.consumption.slice(0, 20).map(c => (
              <tr key={c.itemId} className="border-t border-line">
                <td>{c.name}</td><td className="text-right font-mono">{c.sold.toLocaleString("fr-FR")} <span className="text-ink3 text-xs">{c.unit}</span></td>
                <td className="text-right font-mono">{c.losses ? c.losses.toLocaleString("fr-FR") : "—"}</td><td className="text-right font-mono">{c.inventoryGap ? c.inventoryGap.toLocaleString("fr-FR") : "—"}</td>
                <td className="text-right font-mono">{c.real.toLocaleString("fr-FR")}</td>
                <td className={`text-right font-mono ${c.varianceValue > 0 ? "text-neg" : ""}`}>{MONEY(c.varianceValue)}</td><td className="text-right font-mono text-ink2">{PCT(c.variancePct)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      {r.menu.length > 0 && (
        <section className="surface-card p-4 space-y-2">
          <h3 className="font-semibold text-ink flex items-center gap-2"><Utensils size={16} /> Analyse de la carte</h3>
          <p className="text-xs text-ink3">Chaque article selon sa popularité (part des ventes de sa famille) et sa marge unitaire HT, comparées à la moyenne de sa famille sur le mois.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(MENU_LABELS) as MenuClass[]).map(c => {
              const list = r.menu.filter(m => m.class === c);
              return (
                <div key={c} className="rounded-xl border border-line p-3">
                  <p className="font-semibold text-sm">{MENU_LABELS[c].label} <span className="text-ink3 font-normal">({list.length})</span></p>
                  <p className="text-[11px] text-ink3 mb-1.5">{MENU_LABELS[c].advice}</p>
                  {list.slice(0, 8).map(m => <p key={m.id} className="text-sm flex justify-between gap-2"><span className="truncate">{m.name}{m.category ? <span className="text-ink3 text-[11px]"> · {m.category}</span> : null}</span><span className="font-mono text-xs text-ink2 shrink-0">{m.quantity} · {MONEY(m.unitMargin)}</span></p>)}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {r.trend && (
        <section className="surface-card p-4 space-y-2">
          <h3 className="font-semibold text-ink">Douze derniers mois</h3>
          <div className="overflow-x-auto"><table className="table-dense w-full">
            <thead><tr><th>Mois</th><th className="text-right">CA HT</th><th className="text-right">Marge matière</th><th className="text-right">Charges</th><th className="text-right">Résultat</th><th className="text-right">Coût matière</th><th className="w-40"></th></tr></thead>
            <tbody>{r.trend.map(t => (
              <tr key={t.month} className="border-t border-line">
                <td className="whitespace-nowrap">{MONTH_LABEL(t.month)}</td>
                <td className="text-right font-mono">{t.revenueHT ? MONEY(t.revenueHT) : "—"}</td>
                <td className="text-right font-mono">{t.revenueHT ? MONEY(t.materialMargin) : "—"}</td>
                <td className="text-right font-mono">{t.charges ? MONEY(t.charges) : "—"}</td>
                <td className={`text-right font-mono font-semibold ${t.result < 0 ? "text-neg" : ""}`}>{t.revenueHT || t.charges ? MONEY(t.result) : "—"}</td>
                <td className="text-right font-mono text-ink2">{PCT(t.foodCostPct)}</td>
                <td><div className="h-2 rounded-full bg-surface2 overflow-hidden" aria-hidden><div className={`h-full ${t.result < 0 ? "bg-neg" : "bg-pos"}`} style={{ width: `${(Math.abs(t.result) / max) * 100}%` }} /></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}

function AllDesks({ data }: { data: All | null }) {
  if (!data) return <div className="h-48 surface-card animate-pulse" />;
  return (
    <section className="surface-card p-4">
      <h3 className="font-semibold text-ink mb-2">Tous les comptoirs — {MONTH_LABEL(data.month)}</h3>
      <div className="overflow-x-auto"><table className="table-dense w-full">
        <thead><tr><th>Comptoir</th><th className="text-right">Tickets</th><th className="text-right">CA HT</th><th className="text-right">Marge matière</th><th className="text-right">Charges</th><th className="text-right">Résultat</th><th className="text-right">Coût matière</th><th className="text-right">Personnel</th><th></th></tr></thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.deskId} className="border-t border-line">
              <td>{r.name}{!r.hasSector && <span className="block text-[11px] text-warn">sans secteur : charges non reprises</span>}{r.unvaluedRevenueHT > 0 && <span className="block text-[11px] text-warn">{MONEY(r.unvaluedRevenueHT)} de ventes sans coût, hors marge</span>}{r.warnings > 0 && <span className="block text-[11px] text-ink3">{r.warnings} point(s) d&apos;attention : voir le comptoir</span>}</td>
              <td className="text-right font-mono">{r.tickets}</td>
              <td className="text-right font-mono">{MONEY(r.revenueHT)}</td>
              <td className="text-right font-mono">{MONEY(r.materialMargin)}</td>
              <td className="text-right font-mono">{MONEY(r.charges)}</td>
              <td className={`text-right font-mono font-semibold ${r.result < 0 ? "text-neg" : ""}`}>{MONEY(r.result)}</td>
              <td className="text-right font-mono text-ink2">{PCT(r.foodCostPct)}</td>
              <td className="text-right font-mono text-ink2">{PCT(r.staffCostPct)}</td>
              <td>{r.closed && <Pill tone="mute">clos</Pill>}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink font-semibold">
            <td>Total</td><td className="text-right font-mono">{data.totals.tickets}</td><td className="text-right font-mono">{MONEY(data.totals.revenueHT)}</td><td className="text-right font-mono">{MONEY(data.totals.materialMargin)}</td>
            <td className="text-right font-mono">{MONEY(data.totals.charges)}</td><td className={`text-right font-mono ${data.totals.result < 0 ? "text-neg" : ""}`}>{MONEY(data.totals.result)}</td><td colSpan={3}></td>
          </tr>
        </tbody>
      </table></div>
    </section>
  );
}

interface DeskCfg { staff?: Array<{ employeeId: string; share: number }>; plannedCosts?: Array<{ category: string; label?: string; amount: number }>; openDaysPerMonth?: number; commonCostShare?: number; lenientStock?: boolean; targetNetMargin?: number }

/**
 * Personnel affecté au comptoir (part de son temps ; réservé à qui gère la
 * paie), charges prévues par mois, quote-part des charges communes, jours
 * d'ouverture. Rien n'est envoyé avant que le paramétrage actuel soit chargé.
 */
function SettingsDialog({ deskId, payroll, onClose, onSaved }: { deskId: string; payroll: boolean; onClose: () => void; onSaved: () => void }) {
  const [emps, setEmps] = useState<Array<{ _id: string; firstName: string; lastName: string; position?: string }>>([]);
  const [staff, setStaff] = useState<Array<{ employeeId: string; share: string }>>([]);
  const [planned, setPlanned] = useState<Array<{ category: string; label: string; amount: string }>>([]);
  const [days, setDays] = useState("26");
  const [common, setCommon] = useState("");
  const [lenient, setLenient] = useState(false);
  const [target, setTarget] = useState("20");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (payroll) apiJson("/api/employees?limit=100&isActive=true").then(d => setEmps(Array.isArray(d.data) ? d.data : d.data?.items ?? [])).catch(() => {});
    apiJson("/api/comptoir/desks").then(d => {
      const desk = ((d.data ?? []) as Array<DeskCfg & { _id: string }>).find(x => x._id === deskId);
      if (!desk) return;
      setStaff((desk.staff ?? []).map(s => ({ employeeId: String(s.employeeId), share: String(Math.round(s.share * 100)) })));
      setPlanned((desk.plannedCosts ?? []).map(p => ({ category: p.category, label: p.label ?? "", amount: String(p.amount) })));
      setDays(String(desk.openDaysPerMonth ?? 26));
      setCommon(desk.commonCostShare ? String(Math.round(desk.commonCostShare * 1000) / 10) : "");
      setLenient(!!desk.lenientStock);
      setTarget(String(Math.round((desk.targetNetMargin ?? 0.2) * 1000) / 10));
      setLoaded(true);
    }).catch(() => showToast("Paramètres du comptoir illisibles : réessayez.", "error"));
  }, [deskId, payroll]);
  async function save() {
    if (!loaded) return;
    setBusy(true);
    const r = await apiSend<{ error?: string }>("PATCH", `/api/comptoir/desks/${deskId}`, {
      ...(payroll ? { staff: staff.filter(s => s.employeeId && Number(s.share) > 0).map(s => ({ employeeId: s.employeeId, share: Number(s.share) / 100 })) } : {}),
      plannedCosts: planned.filter(p => Number(p.amount) > 0).map(p => ({ category: p.category, label: p.label, amount: Number(p.amount) })),
      openDaysPerMonth: Number(days) || 26,
      commonCostShare: (Number(common.replace(",", ".")) || 0) / 100,
      lenientStock: lenient,
      targetNetMargin: (Number(target.replace(",", ".")) || 0) / 100,
    });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Enregistrement refusé", "error");
    showToast("Paramètres du résultat enregistrés", "success"); onSaved();
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Personnel et charges prévues" description="Le coût des employés affectés entre dans le résultat au prorata de leur temps ; les charges prévues servent de budget et de base au point mort."
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || !loaded} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button></>}>
      {!loaded ? <div className="h-40 animate-pulse surface-card" /> : <div className="space-y-4">
        {payroll ? <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Personnel affecté au comptoir</p>
          {staff.map((s, i) => (
            <div key={i} className="flex gap-2">
              <select className={selectCls} value={s.employeeId} onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, employeeId: e.target.value } : y))}>
                <option value="">Collaborateur…</option>
                {emps.map(e => <option key={e._id} value={e._id}>{e.lastName} {e.firstName}{e.position ? ` — ${e.position}` : ""}</option>)}
              </select>
              <input className={`${inputCls} w-24`} inputMode="numeric" value={s.share} onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, share: e.target.value } : y))} aria-label="Part de temps en %" />
              <span className="self-center text-sm text-ink3">%</span>
              <button onClick={() => setStaff(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setStaff(x => [...x, { employeeId: "", share: "100" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter un collaborateur</button>
        </div> : <p className="text-xs text-ink3">L&apos;affectation du personnel revient à qui gère la paie (gérant, chef comptable).</p>}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Charges prévues par mois</p>
          {planned.map((p, i) => (
            <div key={i} className="flex gap-2">
              <select className={selectCls} value={p.category} onChange={e => setPlanned(x => x.map((y, j) => j === i ? { ...y, category: e.target.value } : y))}>
                {(Object.keys(CHARGE_CATEGORIES) as ChargeCategory[]).map(c => <option key={c} value={c}>{CHARGE_CATEGORIES[c]}</option>)}
              </select>
              <input className={inputCls} placeholder="Précision (facultative)" value={p.label} onChange={e => setPlanned(x => x.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} />
              <input className={`${inputCls} w-32`} inputMode="numeric" placeholder="FCFA" value={p.amount} onChange={e => setPlanned(x => x.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} />
              <button onClick={() => setPlanned(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setPlanned(x => [...x, { category: "electricite", label: "", amount: "" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter une charge prévue</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Quote-part des charges communes (%)" hint="Loyer global, compteur commun, gardiennage… sans secteur : la part portée par ce comptoir."><input className={inputCls} inputMode="decimal" value={common} onChange={e => setCommon(e.target.value)} /></FormField>
          <FormField label="Jours d'ouverture par mois"><input className={inputCls} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} /></FormField>
          <FormField label="Marge nette visée (%)" hint="Tous frais compris : personnel, eau, électricité, loyer… Sert au prix minimum de chaque article."><input className={inputCls} inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} /></FormField>
        </div>
        <label className="inline-flex items-start gap-2 text-sm text-ink2"><input type="checkbox" className="mt-1" checked={lenient} onChange={e => setLenient(e.target.checked)} /> Vendre un plat même si un ingrédient manque au comptoir (pris en réserve sans approvisionnement enregistré) : le manque est d&apos;abord monté de la réserve, le reste se régularise à l&apos;inventaire.</label>
        <p className="text-xs text-ink3">Les factures réelles (eau, électricité, loyer…) se saisissent dans Achats ou en dépense de caisse du comptoir, avec leur nature : elles remontent ici par le secteur du comptoir.</p>
      </div>}
    </Modal>
  );
}

/** Clôture (préalables, motif pour passer outre) et réouverture (motif obligatoire) du mois de gestion. */
function CloseDialog({ deskId, month, action, onClose, onDone }: { deskId: string; month: string; action: "close" | "reopen"; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError(null);
    const res = await apiSend<{ error?: string }>("POST", "/api/comptoir/result", action === "close" ? { deskId, month, action, note: text, force } : { deskId, month, action, reason: text });
    setBusy(false);
    if (!res.ok) return setError(res.data.error || "Opération refusée");
    showToast(action === "close" ? "Mois clôturé et verrouillé" : "Mois rouvert", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={action === "close" ? `Clôturer ${MONTH_LABEL(month)}` : `Rouvrir ${MONTH_LABEL(month)}`}
      description={action === "close" ? "Le résultat est figé et le mois verrouillé : ventes, caisse, pertes, mouvements et inventaires datés de ce mois sont refusés." : "La clôture précédente est gardée dans l'historique ; la réouverture est tracée."}
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || (action === "reopen" && text.trim().length < 10)} onClick={go} className={buttonClass(action === "close" ? "primary" : "danger", "md")}>{action === "close" ? "Clôturer" : "Rouvrir"}</button></>}>
      <div className="space-y-3">
        <FormField label={action === "close" ? "Motif (obligatoire pour passer outre un préalable)" : "Motif de la réouverture (10 caractères au moins)"}><textarea className={inputCls} rows={3} value={text} onChange={e => setText(e.target.value)} /></FormField>
        {action === "close" && <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> Clôturer malgré les préalables non remplis (ventes sans coût, entrées sans prix, paie manquante)</label>}
        {error && <p className="text-sm text-neg">{error}</p>}
      </div>
    </Modal>
  );
}
