"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { apiJson } from "@/lib/api-client";

interface Line { ref: string; label: string; amount: number; gross?: number; depreciation?: number; total?: boolean }
interface Data {
  year: number; asOf: string; closed: boolean;
  balanceSheet: { actif: Line[]; passif: Line[]; totalActif: number; totalPassif: number };
  balanceSheetPrev: { actif: Line[]; passif: Line[] };
  incomeStatement: { lines: Line[]; resultat: number; unclassified: number };
  incomeStatementPrev: { lines: Line[] };
  cashFlow: { lines: Line[]; gap: number };
  notes: {
    fixedAssets: Array<{ label: string; opening: number; acquisitions: number; disposals: number; closing: number }>;
    depreciation: Array<{ label: string; opening: number; charges: number; reversals: number; closing: number }>;
    clients: Array<[string, number]>; suppliers: Array<[string, number]>;
    commitments: Array<{ label: string; beneficiary: string; amount: number; expiry?: string }>;
  };
}
type Tab = "actif" | "passif" | "cr" | "tft" | "notes";
const TABS: Array<[Tab, string]> = [["actif", "Bilan actif"], ["passif", "Bilan passif"], ["cr", "Compte de résultat"], ["tft", "Flux de trésorerie"], ["notes", "Notes annexes"]];
const fmt = (n?: number) => (n === undefined || n === null ? "" : Math.round(n).toLocaleString("fr-FR"));

function Table({ lines, prev, withGross }: { lines: Line[]; prev?: Line[]; withGross?: boolean }) {
  const p = (ref: string) => prev?.find(x => x.ref === ref)?.amount;
  return (
    <div className="overflow-x-auto"><table className="table-dense w-full">
      <thead><tr className="text-left text-ink2"><th className="w-12">Réf.</th><th>Libellé</th>
        {withGross && <><th className="text-right">Brut</th><th className="text-right">Amort./Dépréc.</th></>}
        <th className="text-right">Exercice</th>{prev && <th className="text-right">Exercice précédent</th>}</tr></thead>
      <tbody>{lines.map(l => (
        <tr key={l.ref} className={`border-t border-line ${l.total ? "bg-surface2 font-semibold" : ""}`}>
          <td className="font-mono text-xs text-ink3">{l.ref}</td><td className="text-sm">{l.label}</td>
          {withGross && <><td className="text-right num">{fmt(l.gross)}</td><td className="text-right num">{fmt(l.depreciation)}</td></>}
          <td className={`text-right num ${l.amount < 0 ? "text-neg" : ""}`}>{fmt(l.amount)}</td>
          {prev && <td className="text-right num text-ink2">{fmt(p(l.ref))}</td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/**
 * États financiers au format SYSCOHADA révisé (références de la DSF) : bilan,
 * compte de résultat, tableau des flux de trésorerie et notes principales ;
 * téléchargeables en liasse Excel pour l'expert-comptable et la DGI.
 */
export default function FinancialStatementsPage() {
  const current = new Date().getFullYear();
  const [year, setYear] = useState(current - (new Date().getMonth() < 4 ? 1 : 0));
  const [tab, setTab] = useState<Tab>("actif");
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null); setError("");
    apiJson(`/api/accounting/financial-statements?annee=${year}`).then(r => { if (r?.success) setD(r.data); else setError(r?.error ?? "Chargement impossible"); });
  }, [year]);

  const balanced = d && Math.abs(d.balanceSheet.totalActif - d.balanceSheet.totalPassif) < 1;
  return (
    <div className="space-y-5">
      <ScreenTabs group="accounting" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
          <h1 className="page-title mt-1">États financiers SYSCOHADA</h1>
          <p className="text-sm text-ink2">Bilan, compte de résultat, tableau des flux et notes, aux références de la DSF.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select aria-label="Exercice" className={`${selectCls} w-auto`} value={year} onChange={e => setYear(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => current - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
          </select>
          <a href={`/api/accounting/financial-statements?annee=${year}&format=xlsx`} className={buttonClass("primary", "md")}><Download size={15} /> Liasse Excel</a>
        </div>
      </div>
      {error && <p className="p-3 rounded-lg bg-neg-50 text-neg text-sm">{error}</p>}
      {d && (
        <>
          <section className="surface-card p-4 flex flex-wrap gap-4 text-sm">
            <span className={`inline-flex items-center gap-1.5 ${balanced ? "text-pos" : "text-neg"}`}>{balanced ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} Actif {fmt(d.balanceSheet.totalActif)} {balanced ? "=" : "≠"} passif {fmt(d.balanceSheet.totalPassif)}</span>
            <span className={`inline-flex items-center gap-1.5 ${d.cashFlow.gap === 0 ? "text-pos" : "text-neg"}`}>{d.cashFlow.gap === 0 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} Flux de trésorerie {d.cashFlow.gap === 0 ? "rapprochés de la trésorerie" : `: écart de ${fmt(d.cashFlow.gap)}`}</span>
            {d.incomeStatement.unclassified !== 0 && <span className="inline-flex items-center gap-1.5 text-warn"><AlertTriangle size={15} /> {fmt(d.incomeStatement.unclassified)} sur des comptes hors nomenclature</span>}
            {!d.closed && <span className="text-ink2">Exercice non clôturé : états provisoires.</span>}
          </section>
          <div className="flex gap-2 flex-wrap">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={buttonClass(tab === k ? "primary" : "secondary", "sm")}>{l}</button>)}</div>
          <section className="surface-card overflow-hidden">
            {tab === "actif" && <Table lines={d.balanceSheet.actif} prev={d.balanceSheetPrev.actif} withGross />}
            {tab === "passif" && <Table lines={d.balanceSheet.passif} prev={d.balanceSheetPrev.passif} />}
            {tab === "cr" && <Table lines={d.incomeStatement.lines} prev={d.incomeStatementPrev.lines} />}
            {tab === "tft" && <Table lines={d.cashFlow.lines} />}
            {tab === "notes" && (
              <div className="p-5 space-y-6 text-sm">
                <div><h2 className="font-semibold text-ink mb-2">Note 3A — Immobilisations brutes</h2>
                  <table className="table-dense w-full"><thead><tr className="text-left text-ink2"><th>Rubrique</th><th className="text-right">Ouverture</th><th className="text-right">Acquisitions</th><th className="text-right">Sorties</th><th className="text-right">Clôture</th></tr></thead>
                    <tbody>{d.notes.fixedAssets.map(f => <tr key={f.label} className="border-t border-line"><td>{f.label}</td><td className="text-right num">{fmt(f.opening)}</td><td className="text-right num">{fmt(f.acquisitions)}</td><td className="text-right num">{fmt(f.disposals)}</td><td className="text-right num">{fmt(f.closing)}</td></tr>)}</tbody></table></div>
                <div><h2 className="font-semibold text-ink mb-2">Note 3C — Amortissements</h2>
                  <table className="table-dense w-full"><thead><tr className="text-left text-ink2"><th>Rubrique</th><th className="text-right">Ouverture</th><th className="text-right">Dotations</th><th className="text-right">Reprises</th><th className="text-right">Clôture</th></tr></thead>
                    <tbody>{d.notes.depreciation.map(f => <tr key={f.label} className="border-t border-line"><td>{f.label}</td><td className="text-right num">{fmt(f.opening)}</td><td className="text-right num">{fmt(f.charges)}</td><td className="text-right num">{fmt(f.reversals)}</td><td className="text-right num">{fmt(f.closing)}</td></tr>)}</tbody></table></div>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div><h2 className="font-semibold text-ink mb-2">Note 7 — Clients</h2>{d.notes.clients.map(([l, v]) => <p key={l} className="flex justify-between border-t border-line py-1"><span>{l}</span><span className="num">{fmt(v)}</span></p>)}</div>
                  <div><h2 className="font-semibold text-ink mb-2">Note 17 — Fournisseurs</h2>{d.notes.suppliers.map(([l, v]) => <p key={l} className="flex justify-between border-t border-line py-1"><span>{l}</span><span className="num">{fmt(v)}</span></p>)}</div>
                </div>
                <div><h2 className="font-semibold text-ink mb-2">Engagements hors bilan — cautions données</h2>
                  {d.notes.commitments.length === 0 ? <p className="text-ink3">Aucune caution en cours à la clôture.</p> : d.notes.commitments.map((c, i) => <p key={i} className="flex justify-between border-t border-line py-1"><span>{c.label} — {c.beneficiary}</span><span className="num">{fmt(c.amount)}</span></p>)}</div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
