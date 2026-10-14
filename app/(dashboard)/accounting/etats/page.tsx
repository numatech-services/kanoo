"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { inputCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { apiJson } from "@/lib/api-client";
type Tab = "balance" | "ledger" | "pl" | "bs";
const TABS: Array<[Tab, string]> = [["balance", "Balance générale"], ["ledger", "Grand livre"], ["pl", "Compte de résultat"], ["bs", "Bilan"]];
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

interface BalanceRow { code: string; label: string; debit: number; credit: number; soldeDebit: number; soldeCredit: number }
interface LedgerLine { entryId: string; date: string; journal: string; reference: string; label: string; account: string; debit: number; credit: number; balance: number }
interface PL { groups: Array<{ key: string; label: string; side: string; amount: number; accounts: Array<{ code: string; label: string; amount: number }> }>; produits: number; charges: number; resultat: number }
interface BS { actif: Array<{ code: string; label: string; amount: number; rubric: string }>; passif: Array<{ code: string; label: string; amount: number; rubric: string }>; totalActif: number; totalPassif: number; resultat: number }

/** États comptables : balance, grand livre, compte de résultat, bilan — avec export CSV. */
export default function StatementsPage() {
  const y = new Date().getFullYear();
  const [tab, setTab] = useState<Tab>("balance");
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [account, setAccount] = useState("");
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState("");

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ type: tab, to, ...extra });
    if (tab !== "bs") p.set("from", from);
    if (account && (tab === "ledger" || tab === "balance")) p.set("account", account);
    return p;
  }, [tab, from, to, account]);

  useEffect(() => {
    if (tab === "ledger" && !account) { setData(null); return; }
    setError("");
    apiJson(`/api/accounting/reports?${qs()}`)
      .then(d => { if (d.success) setData(d.data); else { setError(d.error ?? "Chargement impossible"); setData(null); } })
      .catch(() => setError("Chargement impossible"));
  }, [qs, tab, account]);

  return (
    <div className="space-y-5">
      <ScreenTabs group="accounting" />
      <div>
        <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
        <h1 className="page-title mt-1">États comptables</h1>
      </div>
      <div className="flex gap-1 flex-wrap">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); setData(null); }} className={`px-4 h-9 rounded-lg text-sm font-semibold ${tab === k ? "bg-section text-white" : "border border-line2 text-ink2 hover:bg-surface2"}`}>{l}</button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-end">
        {tab !== "bs" && <label className="block"><span className="block text-xs text-ink2 mb-1">Du</span><input type="date" className={`${inputCls} w-auto`} value={from} onChange={e => setFrom(e.target.value)} /></label>}
        <label className="block"><span className="block text-xs text-ink2 mb-1">{tab === "bs" ? "Au (date du bilan)" : "Au"}</span><input type="date" className={`${inputCls} w-auto`} value={to} onChange={e => setTo(e.target.value)} /></label>
        {(tab === "ledger" || tab === "balance") && (
          <label className="block"><span className="block text-xs text-ink2 mb-1">{tab === "ledger" ? "Compte ou racine (obligatoire)" : "Racine de compte"}</span>
            <input className={`${inputCls} w-40`} value={account} onChange={e => setAccount(e.target.value.replace(/\D/g, ""))} placeholder="Ex. 411, 521000" /></label>
        )}
        {data != null && <a href={`/api/accounting/reports?${qs({ format: "csv" })}`} className={buttonClass("secondary", "md")}><Download size={15} /> CSV</a>}
      </div>
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
      {tab === "ledger" && !account && <p className="text-sm text-ink3">Saisissez un compte (ex. 411 pour tous les clients, 521000 pour la banque).</p>}

      {tab === "balance" && data != null && (() => {
        const d = data as { rows: BalanceRow[]; totals: { debit: number; credit: number; soldeDebit: number; soldeCredit: number } };
        return (
          <div className="bg-surface rounded-xl border border-line overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr className="bg-surface2/50 text-left"><th>Compte</th><th>Intitulé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde débiteur</th><th className="text-right">Solde créditeur</th></tr></thead>
              <tbody>
                {d.rows.map(r => (
                  <tr key={r.code} className="border-t border-line hover:bg-surface2/30 cursor-pointer" onClick={() => { setAccount(r.code); setTab("ledger"); }}>
                    <td className="font-mono">{r.code}</td><td className="text-xs">{r.label}</td>
                    <td className="text-right font-mono">{fmt(r.debit)}</td><td className="text-right font-mono">{fmt(r.credit)}</td>
                    <td className="text-right font-mono">{r.soldeDebit ? fmt(r.soldeDebit) : ""}</td><td className="text-right font-mono">{r.soldeCredit ? fmt(r.soldeCredit) : ""}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-bold"><td colSpan={2}>Totaux</td><td className="text-right font-mono">{fmt(d.totals.debit)}</td><td className="text-right font-mono">{fmt(d.totals.credit)}</td><td className="text-right font-mono">{fmt(d.totals.soldeDebit)}</td><td className="text-right font-mono">{fmt(d.totals.soldeCredit)}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      {tab === "ledger" && account && data != null && (() => {
        const d = data as { openingBalance: number; lines: LedgerLine[]; closingBalance: number; totalDebit: number; totalCredit: number };
        return (
          <div className="bg-surface rounded-xl border border-line overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr className="bg-surface2/50 text-left"><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead>
              <tbody>
                <tr className="text-ink2"><td colSpan={7}>Solde d&apos;ouverture</td><td className="text-right font-mono">{fmt(d.openingBalance)}</td></tr>
                {d.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="text-xs whitespace-nowrap">{new Date(l.date).toLocaleDateString("fr-FR")}</td><td className="font-mono text-xs">{l.journal}</td>
                    <td className="font-mono text-xs">{l.reference}</td><td className="text-xs">{l.label}</td><td className="font-mono text-xs">{l.account}</td>
                    <td className="text-right font-mono">{l.debit ? fmt(l.debit) : ""}</td><td className="text-right font-mono">{l.credit ? fmt(l.credit) : ""}</td>
                    <td className={`text-right font-mono ${l.balance < 0 ? "text-neg" : ""}`}>{fmt(l.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-bold"><td colSpan={5}>Totaux et solde de clôture</td><td className="text-right font-mono">{fmt(d.totalDebit)}</td><td className="text-right font-mono">{fmt(d.totalCredit)}</td><td className="text-right font-mono">{fmt(d.closingBalance)}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      {tab === "pl" && data != null && (() => {
        const d = data as PL;
        const side = (s: string) => d.groups.filter(g => g.side === s);
        return (
          <div className="grid md:grid-cols-2 gap-4">
            {[["charge", "Charges", d.charges], ["produit", "Produits", d.produits]].map(([s, title, tot]) => (
              <div key={String(s)} className="bg-surface rounded-xl border border-line p-4 space-y-2">
                <h2 className="font-semibold text-ink">{title}</h2>
                {side(String(s)).map(g => (
                  <details key={g.key} className="text-sm">
                    <summary className="flex justify-between cursor-pointer"><span>{g.label}</span><span className="font-mono">{fmt(g.amount)}</span></summary>
                    <ul className="pl-4 text-xs text-ink2">{g.accounts.map(a => <li key={a.code} className="flex justify-between"><span>{a.code} {a.label}</span><span className="font-mono">{fmt(a.amount)}</span></li>)}</ul>
                  </details>
                ))}
                <p className="flex justify-between font-bold border-t border-line pt-2"><span>Total</span><span className="font-mono">{fmt(Number(tot))}</span></p>
              </div>
            ))}
            <div className={`md:col-span-2 rounded-xl p-4 text-center font-bold text-lg ${d.resultat >= 0 ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>
              {d.resultat >= 0 ? "Bénéfice" : "Perte"} de la période : {fmt(d.resultat)} FCFA
            </div>
          </div>
        );
      })()}

      {tab === "bs" && data != null && (() => {
        const d = data as BS;
        const block = (items: BS["actif"]) => {
          const rubrics = [...new Set(items.map(i => i.rubric))];
          return rubrics.map(r => (
            <details key={r} className="text-sm" open>
              <summary className="flex justify-between cursor-pointer font-medium"><span>{r}</span><span className="font-mono">{fmt(items.filter(i => i.rubric === r).reduce((s, i) => s + i.amount, 0))}</span></summary>
              <ul className="pl-4 text-xs text-ink2">{items.filter(i => i.rubric === r).map(i => <li key={i.code + r} className="flex justify-between"><span>{i.code} {i.label}</span><span className="font-mono">{fmt(i.amount)}</span></li>)}</ul>
            </details>
          ));
        };
        return (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-surface rounded-xl border border-line p-4 space-y-2"><h2 className="font-semibold">Actif</h2>{block(d.actif)}<p className="flex justify-between font-bold border-t border-line pt-2"><span>Total actif</span><span className="font-mono">{fmt(d.totalActif)}</span></p></div>
            <div className="bg-surface rounded-xl border border-line p-4 space-y-2"><h2 className="font-semibold">Passif</h2>{block(d.passif)}<p className="flex justify-between font-bold border-t border-line pt-2"><span>Total passif</span><span className="font-mono">{fmt(d.totalPassif)}</span></p></div>
            {Math.abs(d.totalActif - d.totalPassif) > 1 && <p className="md:col-span-2 text-sm text-warn">Écart actif / passif : {fmt(d.totalActif - d.totalPassif)} FCFA — vérifiez les écritures non équilibrées ou les comptes hors classes 1 à 7.</p>}
          </div>
        );
      })()}
    </div>
  );
}
