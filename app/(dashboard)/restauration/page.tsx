"use client";
import { useState } from "react";
import Link from "next/link";
import { UtensilsCrossed, AlertTriangle, Target, PackageCheck, ClipboardCheck, CalendarClock, Truck, Tags } from "lucide-react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { MetricCard } from "@/components/ui/MetricCard";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const PCT = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

interface Desk {
  deskId: string; name: string; target: number; revenueHT: number; materialMargin: number; charges: number; result: number;
  netMarginPct: number | null; foodCostPct: number | null; staffCostPct: number | null; tickets: number; stockValue: number;
  gap: { targetResult: number; missing: number; priceUpliftPct: number | null };
  alerts: { low: number; toSupply: number; expiring: number; expired: number; belowMinPrice: number; noCost: number; openInventories: number; inventoryDue: boolean;
    lastInventory: { at: string; number: string } | null; ordersToReceive: Array<{ _id: string; number: string; supplier?: string; status: string; totalTTC?: number }>; warnings: string[] };
}
interface Data { month: string; desks: Desk[]; totals: { revenueHT: number; materialMargin: number; charges: number; result: number; netMarginPct: number | null } }

/**
 * Restauration — vue d'ensemble : chaque restaurant, sa marge nette tous frais
 * compris face à la cible (20 % par défaut), ce qu'il manque pour l'atteindre
 * et ce qui demande une action aujourd'hui.
 */
export default function RestaurationPage() {
  const [month, setMonth] = useState(monthOf());
  const { data, loading, error } = useApi<Data | null>(`/api/restauration/overview?month=${month}`, d => (d?.data as Data) ?? null, null, { quiet: true });
  const t = data?.totals;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><UtensilsCrossed size={22} /> Restauration</h1>
          <p className="text-sm text-ink2">Ventes, marges, stock, personnel et charges de tous vos restaurants, et la marge nette tous frais compris face à votre objectif.</p>
        </div>
        <FormField label="Mois"><input type="month" className={inputCls} value={month} max={monthOf()} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-64 surface-card animate-pulse" /> : !data?.desks.length ? (
        <EmptyState icon={<UtensilsCrossed size={20} />} title="Aucun restaurant" hint="Créez un comptoir (Comptoirs → Nouveau comptoir) pour chaque restaurant, bar ou point de vente." />
      ) : <>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<UtensilsCrossed size={18} />} tone="blue" label="Chiffre d'affaires HT" value={MONEY(t?.revenueHT)} sub={`${data.desks.length} restaurant(s)`} />
          <MetricCard icon={<Tags size={18} />} tone="green" label="Marge matière" value={MONEY(t?.materialMargin)} sub="ventes − coût des marchandises − pertes" />
          <MetricCard icon={<PackageCheck size={18} />} tone="violet" label="Charges de fonctionnement" value={MONEY(t?.charges)} sub="personnel, eau, électricité, loyer…" />
          <MetricCard icon={<Target size={18} />} tone={(t?.result ?? 0) < 0 ? "red" : "green"} label="Résultat (marge nette)" value={MONEY(t?.result)} valueCls={(t?.result ?? 0) < 0 ? "text-neg" : ""} sub={`marge nette ${PCT(t?.netMarginPct)}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.desks.map(d => {
            const reached = d.netMarginPct !== null && d.netMarginPct >= d.target;
            const a = d.alerts;
            const actions: Array<[React.ReactNode, string, string]> = [
              ...(a.belowMinPrice ? [[<Tags key="p" size={14} />, `${a.belowMinPrice} article(s) sous le prix minimum`, "/restauration/prix"] as [React.ReactNode, string, string]] : []),
              ...(a.noCost ? [[<AlertTriangle key="c" size={14} />, `${a.noCost} article(s) sans coût d'achat`, `/comptoir?desk=${d.deskId}&tab=rentabilite`] as [React.ReactNode, string, string]] : []),
              ...(a.toSupply ? [[<PackageCheck key="s" size={14} />, `${a.toSupply} article(s) à monter de la réserve`, `/comptoir?desk=${d.deskId}&tab=stock`] as [React.ReactNode, string, string]] : []),
              ...(a.low ? [[<AlertTriangle key="l" size={14} />, `${a.low} article(s) sous leur seuil`, `/comptoir?desk=${d.deskId}&tab=stock`] as [React.ReactNode, string, string]] : []),
              ...(a.expired || a.expiring ? [[<CalendarClock key="e" size={14} />, `${a.expired ? `${a.expired} article(s) périmé(s)` : ""}${a.expired && a.expiring ? ", " : ""}${a.expiring ? `${a.expiring} à consommer sous 7 jours` : ""}`, `/comptoir?desk=${d.deskId}&tab=stock`] as [React.ReactNode, string, string]] : []),
              ...(a.openInventories ? [[<ClipboardCheck key="i" size={14} />, `${a.openInventories} inventaire(s) en cours à valider`, `/comptoir?desk=${d.deskId}&tab=stock`] as [React.ReactNode, string, string]]
                : a.inventoryDue ? [[<ClipboardCheck key="i" size={14} />, a.lastInventory ? `Dernier inventaire le ${new Date(a.lastInventory.at).toLocaleDateString("fr-FR")} : celui de la semaine est à faire` : "Aucun inventaire validé : faites le premier (stock initial)", `/comptoir?desk=${d.deskId}&tab=stock`] as [React.ReactNode, string, string]] : []),
              ...a.ordersToReceive.map(o => [<Truck key={o._id} size={14} />, `Commande ${o.number}${o.supplier ? ` (${o.supplier})` : ""} à réceptionner en réserve`, `/commandes/${o._id}`] as [React.ReactNode, string, string]),
            ];
            return (
              <section key={d.deskId} className="surface-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/comptoir?desk=${d.deskId}&tab=resultat`} className="font-semibold text-ink hover:text-section">{d.name}</Link>
                    <p className="text-xs text-ink3">{d.tickets} ticket(s) · stock {MONEY(d.stockValue)}</p>
                  </div>
                  <Pill tone={reached ? "pos" : d.revenueHT ? "warn" : "mute"}>marge nette {PCT(d.netMarginPct)} / objectif {PCT(d.target)}</Pill>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-ink2">CA HT</dt><dd className="text-right font-mono">{MONEY(d.revenueHT)}</dd>
                  <dt className="text-ink2">Marge matière</dt><dd className="text-right font-mono">{MONEY(d.materialMargin)}</dd>
                  <dt className="text-ink2">Charges (personnel compris)</dt><dd className="text-right font-mono">{MONEY(d.charges)}</dd>
                  <dt className="text-ink2 font-semibold">Résultat</dt><dd className={`text-right font-mono font-semibold ${d.result < 0 ? "text-neg" : ""}`}>{MONEY(d.result)}</dd>
                  <dt className="text-ink2">Coût matière / personnel</dt><dd className="text-right font-mono">{PCT(d.foodCostPct)} / {PCT(d.staffCostPct)}</dd>
                </dl>
                {!reached && d.gap.missing > 0 && (
                  <p className="text-sm text-warn">Il manque {MONEY(d.gap.missing)} pour atteindre {PCT(d.target)} de marge nette{d.gap.priceUpliftPct !== null ? `, soit une hausse moyenne des prix de ${PCT(d.gap.priceUpliftPct)} à volumes égaux` : ""} — ou moins de charges, ou plus de ventes.</p>
                )}
                {actions.length > 0 ? (
                  <ul className="space-y-1">{actions.map(([icon, label, href], i) => <li key={i}><Link href={href} className="text-sm text-ink2 hover:text-section inline-flex items-center gap-1.5">{icon} {label}</Link></li>)}</ul>
                ) : <p className="text-sm text-pos">Rien à faire pour l&apos;instant.</p>}
                {a.warnings.slice(0, 3).map(w => <p key={w} className="text-[11px] text-ink3 flex gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}</p>)}
              </section>
            );
          })}
        </div>
      </>}
    </div>
  );
}
