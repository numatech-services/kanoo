"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calculator, Download, TriangleAlert } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TABS = [["journal", "Journal d'activité"], ["evolution", "Évolution"], ["controls", "À contrôler"], ["balance", "Équilibre"], ["margins", "Marges"], ["stock", "Stocks"]] as const;
type Tab = (typeof TABS)[number][0];
const PERIODS = [["today", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["quarter", "Trimestre"], ["year", "Année"], ["custom", "Dates libres"]] as const;

function range(p: string): { from: string; to: string } {
  const now = new Date(), to = dayOf(now);
  if (p === "today") return { from: to, to };
  if (p === "week") { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: dayOf(d), to }; }
  if (p === "quarter") return { from: dayOf(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to };
  if (p === "year") return { from: dayOf(new Date(now.getFullYear(), 0, 1)), to };
  return { from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}
const csv = (name: string, rows: Array<Array<string | number | null>>) => {
  const body = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 1000) / 10} %` : "—");

interface JRow { date: string; site: string; kind: string; label: string; category: string; method: string; party: string | null; piece: string | null; sale: number; receipt: number; expense: number; status: string | null }
interface Journal { rows: JRow[]; truncated: boolean; totals: { sales: number; receipts: number; expenses: number }; categories: string[]; methods: string[] }
interface Evo { days: number; prevFrom: string; prevTo: string; sites: Array<{ deskId: string; name: string; current: M; previous: M }>; total: { current: M; previous: M } }
interface M { revenue: number; tickets: number; expenses: number }
interface Ctl { items: Array<{ key: string; label: string; count: number; amount?: number; detail?: string }>; total: number }
interface Bal { payrollHidden: boolean; warnings: string[]; name: string; since: string; cumulativeResult: number; cumulativeRevenue: number; levels: { margin: number; afterDirect: number; afterCommon: number; status: string } | null; breakEvenRevenue: number | null; monthRevenue: number; cash: number | null; dueIn7Days: number; repayableLeft: number }
interface Margins { missingCost: number; rows: Array<{ itemId: string; name: string; category: string; sold: number; netHT: number; standardCost: number | null; expectedMargin: number | null; losses: number; gaps: number; actualMargin: number | null; estimated: boolean }>; families: Array<{ category: string; netHT: number; expected: number; realCost: number }>; site: { expected: number; actual: number; revenueHT: number; losses: number; gap: number }; method: string }
interface Stock { sites: Array<{ _id: string; name: string }>; rows: Array<{ productId: string; label: string; unit: string; sites: Record<string, number>; transit: number; total: number; value: number }>; totalValue: number }

/**
 * Espace de la comptable : le journal des opérations, l'évolution sur des durées
 * équivalentes, ce qui attend une décision, l'équilibre de chaque site, les
 * marges et le stock consolidé. Activité, trésorerie et résultat restent distincts.
 */
export default function ComptablePage() {
  const [tab, setTab] = useState<Tab>("journal");
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [period, setPeriod] = useState("month");
  const [custom, setCustom] = useState(() => range("month"));
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => setDesks((d.data ?? []) as Array<{ _id: string; name: string }>)).catch(() => {}); }, []);
  const r = period === "custom" ? custom : range(period);
  const q = `from=${r.from}&to=${r.to}${deskId ? `&deskId=${deskId}` : ""}`;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Calculator size={22} /> Espace comptable</h1>
        <p className="text-sm text-ink2">Recettes, dépenses, ce qu&apos;il reste à contrôler, et où en est chaque site.</p>
      </div>
      <RestoNav />
      <div className="flex gap-1.5 overflow-x-auto" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold shrink-0 ${tab === k ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{l}</button>)}</div>
      {tab !== "stock" && (
        <div className="flex gap-2 items-end flex-wrap">
          <FormField label="Site"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}><option value="">{tab === "margins" ? "Choisir…" : "Tous les sites"}</option>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          {(tab === "journal" || tab === "evolution") && <FormField label="Période"><select className={selectCls} value={period} onChange={e => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormField>}
          {period === "custom" && (tab === "journal" || tab === "evolution") && <>
            <FormField label="Du"><input type="date" className={inputCls} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></FormField>
            <FormField label="Au"><input type="date" className={inputCls} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></FormField>
          </>}
        </div>
      )}
      {tab === "journal" && <JournalTab q={q} name={`journal-${r.from}-${r.to}.csv`} />}
      {tab === "evolution" && <EvolutionTab q={q} />}
      {tab === "controls" && <ControlsTab q={deskId ? `deskId=${deskId}` : ""} />}
      {tab === "balance" && <BalanceTab q={deskId ? `deskId=${deskId}` : ""} />}
      {tab === "margins" && (deskId ? <MarginsTab deskId={deskId} /> : <p className="text-sm text-ink3">Choisissez un site.</p>)}
      {tab === "stock" && <StockTab />}
    </div>
  );
}

function JournalTab({ q, name }: { q: string; name: string }) {
  const [category, setCategory] = useState(""), [method, setMethod] = useState(""), [search, setSearch] = useState("");
  const { data, error } = useApi<Journal | null>(`/api/restauration/comptable?view=journal&${q}`, d => (d?.data as Journal) ?? null, null, { quiet: true });
  const rows = useMemo(() => (data?.rows ?? []).filter(r => (!category || r.category === category) && (!method || r.method === method) && (!search.trim() || `${r.party ?? ""} ${r.status ?? ""} ${r.label}`.toLowerCase().includes(search.trim().toLowerCase()))), [data, category, method, search]);
  const receipts = rows.reduce((t, r) => t + r.receipt, 0), expenses = rows.reduce((t, r) => t + r.expense, 0), sold = rows.reduce((t, r) => t + r.sale, 0);
  if (error) return <p className="text-sm text-neg">{error}</p>;
  if (!data) return <div className="h-40 surface-card animate-pulse" />;
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex gap-2 items-end flex-wrap justify-between">
        <div className="flex gap-2 flex-wrap">
          <select className={`${selectCls} w-auto`} value={category} aria-label="Catégorie" onChange={e => setCategory(e.target.value)}><option value="">Toutes catégories</option>{data.categories.map(c => <option key={c}>{c}</option>)}</select>
          <select className={`${selectCls} w-auto`} value={method} aria-label="Moyen de paiement" onChange={e => setMethod(e.target.value)}><option value="">Tous moyens</option>{data.methods.map(c => <option key={c}>{c}</option>)}</select>
          <input className={`${inputCls} w-44`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Tiers, statut…" aria-label="Filtrer par tiers ou statut" />
        </div>
        <button onClick={() => csv(name, [["Date", "Site", "Libellé", "Catégorie", "Moyen", "Tiers", "Pièce", "Vendu", "Encaissé", "Décaissé", "Statut"], ...rows.map(r => [r.date.slice(0, 10), r.site, r.label, r.category, r.method, r.party, r.piece, r.sale, r.receipt, r.expense, r.status])])} className={buttonClass("secondary", "sm")}><Download size={14} /> Exporter</button>
      </div>
      <p className="text-sm text-ink2">Vendu <b className="font-mono">{MONEY(sold)}</b> · encaissé <b className="font-mono">{MONEY(receipts)}</b> · décaissé <b className="font-mono">{MONEY(expenses)}</b>. Dotations, remises et recharges de cartes sont listées sans compter. La paie et les charges payées hors du site n&apos;y figurent pas.</p>
      {data.truncated && <p className="text-sm text-warn">Période trop longue : la liste et ses totaux sont incomplets. Réduisez les dates.</p>}
      <div className="overflow-x-auto"><table className="table-dense w-full min-w-[760px]">
        <thead><tr><th>Date</th><th>Site</th><th>Opération</th><th>Catégorie</th><th>Moyen</th><th className="text-right">Vendu</th><th className="text-right">Encaissé</th><th className="text-right">Décaissé</th></tr></thead>
        <tbody>{rows.slice(0, 500).map((r, i) => (
          <tr key={i} className="border-t border-line">
            <td className="whitespace-nowrap">{new Date(r.date).toLocaleDateString("fr-FR")}</td><td>{r.site}</td>
            <td>{r.label}{r.party ? ` — ${r.party}` : ""}{r.status ? <span className="block text-[11px] text-ink3">{r.status}</span> : null}</td>
            <td>{r.kind === "internal" ? <Pill tone="mute">{r.category}</Pill> : r.category}</td><td>{r.method}</td>
            <td className="text-right font-mono">{r.sale ? MONEY(r.sale) : ""}</td><td className="text-right font-mono">{r.receipt ? MONEY(r.receipt) : ""}</td><td className="text-right font-mono">{r.expense ? MONEY(r.expense) : ""}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {rows.length > 500 && <p className="text-[12px] text-ink3">500 premières lignes affichées ; l&apos;export contient les {rows.length} lignes.</p>}
    </section>
  );
}

function EvolutionTab({ q }: { q: string }) {
  const { data, error } = useApi<Evo | null>(`/api/restauration/comptable?view=evolution&${q}`, d => (d?.data as Evo) ?? null, null, { quiet: true });
  if (error) return <p className="text-sm text-neg">{error}</p>;
  if (!data) return <div className="h-40 surface-card animate-pulse" />;
  const line = (name: string, c: M, p: M, key?: string) => (
    <tr key={key ?? name} className="border-t border-line"><td>{name}</td><td className="text-right font-mono">{MONEY(c.revenue)}</td><td className="text-right font-mono">{MONEY(p.revenue)}</td><td className="text-right">{delta(c.revenue, p.revenue)}</td><td className="text-right font-mono">{c.tickets}</td><td className="text-right font-mono">{MONEY(c.expenses)}</td><td className="text-right font-mono">{MONEY(p.expenses)}</td><td className="text-right">{delta(c.expenses, p.expenses)}</td></tr>
  );
  return (
    <section className="surface-card p-4 space-y-2">
      <p className="text-sm text-ink2">{data.days} jour(s) comparés aux {data.days} jour(s) précédents (du {new Date(`${data.prevFrom}T12:00:00`).toLocaleDateString("fr-FR")} au {new Date(`${data.prevTo}T12:00:00`).toLocaleDateString("fr-FR")}).</p>
      <div className="overflow-x-auto"><table className="table-dense w-full min-w-[720px]">
        <thead><tr><th>Site</th><th className="text-right">CA</th><th className="text-right">Avant</th><th className="text-right">Écart</th><th className="text-right">Tickets</th><th className="text-right">Sorties de caisse</th><th className="text-right">Avant</th><th className="text-right">Écart</th></tr></thead>
        <tbody>{data.sites.map(s => line(s.name, s.current, s.previous, s.deskId))}{data.sites.length > 1 && line("Total", data.total.current, data.total.previous)}</tbody>
      </table></div>
    </section>
  );
}

function ControlsTab({ q }: { q: string }) {
  const { data, error } = useApi<Ctl | null>(`/api/restauration/comptable?view=controls&${q}`, d => (d?.data as Ctl) ?? null, null, { quiet: true });
  if (error) return <p className="text-sm text-neg">{error}</p>;
  if (!data) return <div className="h-40 surface-card animate-pulse" />;
  return (
    <section className="surface-card p-4 space-y-2">
      <ul className="divide-y divide-line">{data.items.map(i => (
        <li key={i.key} className="py-2 flex items-center justify-between gap-2 text-sm">
          <span>{i.count > 0 ? <TriangleAlert size={14} className="inline text-warn mr-1.5" /> : null}{i.label}{i.detail ? <span className="block text-[12px] text-ink3">{i.detail}</span> : null}</span>
          <span className="font-mono">{i.count}{i.amount ? ` · ${MONEY(i.amount)}` : ""}</span>
        </li>
      ))}</ul>
      <p className="text-[12px] text-ink3">Traiter : <Link href="/restauration/transferts" className="underline">transferts</Link> · <Link href="/restauration/achats" className="underline">factures et fournisseurs</Link> · <Link href="/restauration/ouverture" className="underline">financements</Link>.</p>
    </section>
  );
}

function BalanceTab({ q }: { q: string }) {
  const { data, error, loading } = useApi<Bal[]>(`/api/restauration/comptable?view=balance&${q}`, d => (d?.data as Bal[]) ?? [], [], { quiet: true });
  if (error) return <p className="text-sm text-neg">{error}</p>;
  if (loading && !data.length) return <div className="h-40 surface-card animate-pulse" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">{data.map(b => (
      <section key={b.name} className="surface-card p-4 space-y-2 text-sm">
        <p className="font-semibold text-ink">{b.name} <span className="text-ink3 font-normal">depuis {b.since}</span></p>
        <p className="flex justify-between"><span>Résultat de gestion cumulé{b.payrollHidden ? " (avant personnel)" : ""}{b.warnings.length ? " (incomplet)" : ""}</span><b className={`font-mono ${b.cumulativeResult < 0 ? "text-neg" : ""}`}>{MONEY(b.cumulativeResult)}</b></p>
        <p className="flex justify-between"><span>CA du mois / CA d&apos;équilibre</span><b className="font-mono">{MONEY(b.monthRevenue)} / {MONEY(b.breakEvenRevenue)}</b></p>
        {b.levels && <>
          <p className="flex justify-between"><span>Marge du mois</span><b className="font-mono">{MONEY(b.levels.margin)}</b></p>
          <p className="flex justify-between"><span>Après charges du site</span><b className="font-mono">{MONEY(b.levels.afterDirect)}</b></p>
          <p className="flex justify-between"><span>Après charges centrales ({b.levels.status === "validated" ? "validé" : "estimé"})</span><b className="font-mono">{MONEY(b.levels.afterCommon)}</b></p>
        </>}
        <p className="flex justify-between border-t border-line pt-1"><span>Caisse du site</span><b className="font-mono">{MONEY(b.cash)}</b></p>
        <p className="flex justify-between"><span>À payer sous 7 jours</span><b className="font-mono">{MONEY(b.dueIn7Days)}</b></p>
        <p className="flex justify-between"><span>Avance restant à rembourser</span><b className="font-mono">{MONEY(b.repayableLeft)}</b></p>
        {b.warnings.map(w => <p key={w} className="text-[12px] text-warn">{w}</p>)}
        <p className="text-[12px] text-ink3">Résultat de gestion : ni comptable ni fiscal. La caisse ne compte ni la banque ni le mobile money de l&apos;entreprise.</p>
      </section>
    ))}</div>
  );
}

function MarginsTab({ deskId }: { deskId: string }) {
  const [month, setMonth] = useState(() => dayOf(new Date()).slice(0, 7));
  const { data } = useApi<Margins | null>(`/api/restauration/comptable?view=margins&deskId=${deskId}&month=${month}`, d => (d?.data as Margins) ?? null, null, { quiet: true });
  return (
    <section className="surface-card p-4 space-y-3">
      <FormField label="Mois"><input type="month" className={`${inputCls} w-44`} value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
      {!data ? <div className="h-32 animate-pulse" /> : <>
        <p className="text-sm text-ink2">Marge attendue <b className="font-mono">{MONEY(data.site.expected)}</b> · marge constatée du site <b className="font-mono">{MONEY(data.site.actual)}</b> (pertes {MONEY(data.site.losses)}, écarts {MONEY(data.site.gap)}).{data.missingCost ? ` ${data.missingCost} article(s) sans coût ne sont pas dans la marge attendue.` : ""}</p>
        <div className="overflow-x-auto"><table className="table-dense w-full min-w-[760px]">
          <thead><tr><th>Article</th><th>Famille</th><th className="text-right">Vendu</th><th className="text-right">Ventes nettes</th><th className="text-right">Coût standard</th><th className="text-right">Marge attendue</th><th className="text-right">Pertes</th><th className="text-right">Écarts</th><th className="text-right">Marge constatée</th></tr></thead>
          <tbody>{data.rows.map(r => (
            <tr key={r.itemId} className="border-t border-line"><td>{r.name}</td><td>{r.category}</td><td className="text-right font-mono">{r.sold}</td><td className="text-right font-mono">{MONEY(r.netHT)}</td><td className="text-right font-mono">{MONEY(r.standardCost)}</td><td className="text-right font-mono">{MONEY(r.expectedMargin)}</td><td className="text-right font-mono">{r.estimated ? "" : MONEY(r.losses)}</td><td className="text-right font-mono">{r.estimated ? "" : MONEY(r.gaps)}</td><td className="text-right font-mono">{r.estimated ? <Pill tone="mute">estimation</Pill> : MONEY(r.actualMargin)}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="text-[12px] text-ink3">{data.method}</p>
      </>}
    </section>
  );
}

function StockTab() {
  const { data } = useApi<Stock | null>("/api/restauration/comptable?view=stock", d => (d?.data as Stock) ?? null, null, { quiet: true });
  if (!data) return <div className="h-40 surface-card animate-pulse" />;
  return (
    <section className="surface-card p-4 space-y-2">
      <p className="text-sm text-ink2">Stock de l&apos;entreprise : <b className="font-mono">{MONEY(data.totalValue)}</b> au coût. La marchandise en transit n&apos;est comptée qu&apos;une fois.</p>
      <div className="overflow-x-auto"><table className="table-dense w-full min-w-[640px]">
        <thead><tr><th>Article</th>{data.sites.map(s => <th key={s._id} className="text-right">{s.name}</th>)}<th className="text-right">En transit</th><th className="text-right">Total</th><th className="text-right">Valeur</th></tr></thead>
        <tbody>{data.rows.map(r => <tr key={r.productId} className="border-t border-line"><td>{r.label} <span className="text-ink3">({r.unit})</span></td>{data.sites.map(s => <td key={s._id} className="text-right font-mono">{r.sites[s._id] ?? ""}</td>)}<td className="text-right font-mono">{r.transit || ""}</td><td className="text-right font-mono">{r.total}</td><td className="text-right font-mono">{MONEY(r.value)}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}
