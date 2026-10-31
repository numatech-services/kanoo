"use client";
import { useEffect, useState } from "react";
import { Tags, AlertTriangle, Check, Download } from "lucide-react";
import { FormField, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { csvCell } from "@/lib/csv";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const PCT = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);

interface Row {
  itemId: string; name: string; category?: string; preparation: boolean; soldQty: number; lostMargin: number | null;
  priceTTC: number; priceHT: number; cost: number | null; grossMargin: number | null; grossMarginPct: number | null;
  overhead: number; netMargin: number | null; netMarginPct: number | null; minPriceHT: number | null; minPriceTTC: number | null;
  status: "ok" | "below" | "no_cost" | "no_price" | "impossible";
}
interface Data { desk: { _id: string; name: string; vatRate: number; target: number }; overhead: { rate: number; shrink: number; months: string[]; provisional: boolean; charges: number | null; revenueHT: number | null }; rows: Row[]; counts: { below: number; noCost: number; impossible: boolean } }

const STATUS: Record<Row["status"], { label: string; tone: "pos" | "warn" | "neg" | "mute" }> = {
  ok: { label: "objectif atteint", tone: "pos" }, below: { label: "sous le prix minimum", tone: "neg" }, no_cost: { label: "coût inconnu", tone: "warn" },
  no_price: { label: "sans prix", tone: "mute" }, impossible: { label: "frais trop lourds", tone: "neg" },
};

/**
 * Prix et marges : pour chaque article, le prix d'achat (coût de revient,
 * recette comprise), le prix de vente, la marge brute, la part des frais de
 * fonctionnement (personnel, eau, électricité, loyer…), la marge nette et le
 * prix minimum pour garder la marge nette visée (20 % par défaut).
 */
export default function PrixPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [only, setOnly] = useState<"all" | "below">("below");
  useEffect(() => {
    apiJson("/api/comptoir/desks").then(d => { const list = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(list); if (list[0]) setDeskId(x => x || list[0]._id); }).catch(() => {});
  }, []);
  const { data, loading, error, reload } = useApi<Data | null>(deskId ? `/api/restauration/pricing?deskId=${deskId}` : null, d => (d?.data as Data) ?? null, null, { quiet: true });
  const rows = (data?.rows ?? []).filter(r => only === "all" || r.status === "below" || r.status === "no_cost" || r.status === "impossible");

  async function apply(r: Row) {
    if (!r.minPriceTTC) return;
    if (!(await confirmDialog({ title: `Passer « ${r.name} » à ${MONEY(r.minPriceTTC)} TTC ?`, message: `Prix actuel ${MONEY(r.priceTTC)}. Le nouveau prix s'applique aux prochains tickets (caisse et EasyPay).` }))) return;
    const res = await apiSend<{ error?: string }>("PATCH", `/api/comptoir/items/${r.itemId}`, { salePrice: r.minPriceTTC });
    if (!res.ok) return showToast(res.data.error || "Changement refusé", "error");
    showToast("Prix mis à jour", "success"); reload();
  }
  function exportCsv() {
    if (!data) return;
    const head = ["Article", "Famille", "Vendus (mois de référence)", "Prix TTC", "Prix HT", "Coût de revient", "Marge brute", "Marge brute %", "Part des frais", "Marge nette", "Marge nette %", "Prix minimum HT", "Prix minimum TTC", "État"];
    const lines = data.rows.map(r => [r.name, r.category ?? "", r.soldQty, r.priceTTC, r.priceHT, r.cost ?? "", r.grossMargin ?? "", r.grossMarginPct ?? "", r.overhead, r.netMargin ?? "", r.netMarginPct ?? "", r.minPriceHT ?? "", r.minPriceTTC ?? "", STATUS[r.status].label]);
    const csv = "﻿" + [head, ...lines].map(l => l.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `prix-marges-${data.desk.name}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Tags size={22} /> Prix et marges</h1>
          <p className="text-sm text-ink2">Prix d&apos;achat, prix de vente et marge de chaque produit, personnel et charges compris, avec le prix minimum pour garder votre marge nette.</p>
        </div>
        <div className="flex gap-2 items-end">
          <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          {data && <button onClick={exportCsv} className={buttonClass("secondary", "md")}><Download size={15} /> CSV</button>}
        </div>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {data && (
        <section className="surface-card p-4 space-y-1.5 text-sm">
          <p><span className="font-semibold">Marge nette visée : {PCT(Math.round(data.desk.target * 1000) / 10)}</span> du CA HT, tous frais compris, avant impôt sur les bénéfices (modifiable : comptoir → Résultat → Personnel et charges prévues).</p>
          <p className="text-ink2">
            Frais de fonctionnement {data.overhead.months.length ? `(moyenne de ${data.overhead.months.length} mois : ${data.overhead.months.map(m => new Date(`${m}-15T12:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })).join(", ")} ; pour chaque rubrique, le plus élevé du prévu et du réel)` : ""}
            {data.overhead.charges !== null ? <> : {MONEY(data.overhead.charges)} pour {MONEY(data.overhead.revenueHT)} de CA HT par mois</> : null}, soit <span className="font-semibold">{PCT(data.overhead.rate)}</span> du prix de chaque article.
            Démarque (pertes, repas du personnel, offerts, manquants, achats de caisse) : <span className="font-semibold">{PCT(data.overhead.shrink)}</span> du coût des ventes, ajoutée au coût de revient.
            Prix minimum HT = coût × (1 + démarque) ÷ (1 − marge visée − taux de frais).
          </p>
          {data.overhead.provisional && <p className="text-warn flex gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> Taux provisoire (mois en cours, ou bulletins de paie manquants) : les prix minimum sont indicatifs, l&apos;application est bloquée tant que le mois n&apos;est pas complet.</p>}
          {data.counts.impossible && <p className="text-neg flex gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> Les frais dépassent ce que les prix peuvent couvrir à cette marge : il faut d&apos;abord vendre davantage ou réduire les charges.</p>}
          {!data.overhead.months.length && <p className="text-warn">Pas encore de ventes : le taux de frais est à 0, les prix minimum ne couvrent que la marge visée.</p>}
        </section>
      )}
      <div className="flex gap-1.5">
        {([["below", `À revoir${data ? ` (${data.counts.below + data.counts.noCost})` : ""}`], ["all", "Tous les articles"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setOnly(k)} className={`px-3 h-8 rounded-full border text-[13px] font-semibold ${only === k ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{l}</button>
        ))}
      </div>
      {loading && !data ? <div className="h-48 surface-card animate-pulse" /> : !rows.length ? (
        <EmptyState icon={<Check size={20} />} title={only === "below" ? "Tous les prix tiennent l'objectif" : "Aucun article en vente"} hint={only === "below" ? "Aucun article sous son prix minimum ni sans coût." : "Ajoutez des articles avec un prix de vente."} />
      ) : (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Article</th><th className="text-right">Prix d&apos;achat</th><th className="text-right">Prix de vente TTC</th><th className="text-right">Marge brute</th><th className="text-right">Part des frais</th><th className="text-right">Marge nette</th><th className="text-right">Prix minimum TTC</th><th>État</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.itemId} className="border-t border-line">
                  <td className="text-ink font-medium">{r.name}<span className="block text-[11px] text-ink3 font-normal">{[r.category, r.preparation ? "recette" : null, r.soldQty ? `${r.soldQty} vendu(s)` : null].filter(Boolean).join(" · ")}</span></td>
                  <td className="text-right font-mono">{MONEY(r.cost)}</td>
                  <td className="text-right font-mono">{MONEY(r.priceTTC)}<span className="block text-[11px] text-ink3">{MONEY(r.priceHT)} HT</span></td>
                  <td className="text-right font-mono">{MONEY(r.grossMargin)}<span className="block text-[11px] text-ink3">{PCT(r.grossMarginPct)}</span></td>
                  <td className="text-right font-mono text-ink2">{MONEY(r.overhead)}</td>
                  <td className={`text-right font-mono font-semibold ${(r.netMargin ?? 0) < 0 ? "text-neg" : ""}`}>{MONEY(r.netMargin)}<span className="block text-[11px] font-normal text-ink3">{PCT(r.netMarginPct)}</span></td>
                  <td className="text-right font-mono">{MONEY(r.minPriceTTC)}{r.lostMargin ? <span className="block text-[11px] text-neg">manque {MONEY(r.lostMargin)} sur le mois</span> : null}</td>
                  <td><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></td>
                  <td className="text-right">{r.status === "below" && r.minPriceTTC && !data?.overhead.provisional ? <button onClick={() => apply(r)} className={buttonClass("secondary", "sm")}>Appliquer</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      <p className="text-xs text-ink3">Les frais sont répartis au prorata du chiffre d&apos;affaires : un article vendu 1 000 FCFA HT porte 1 000 × le taux de frais. Le coût de revient d&apos;une recette est la somme de ses ingrédients au coût moyen pondéré ; un ingrédient sans coût rend la recette « coût inconnu ».</p>
    </div>
  );
}
