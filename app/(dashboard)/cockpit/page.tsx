"use client";
import { useState } from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { formatMoney } from "@/lib/format";
import type { Cockpit } from "@/lib/cockpit";

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; href?: string }) {
  const body = (
    <div className="surface-card p-4 h-full">
      <p className="text-[11px] font-semibold text-ink2 uppercase">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink3 mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

/** Cockpit : performance, trésorerie, dettes et engagements de toute l'organisation. */
export default function CockpitPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const res = useApi<Cockpit | null>(`/api/cockpit?year=${year}`, d => d?.data ?? null, null);
  const c = res.data;
  const max = c ? Math.max(1, ...c.months.map(m => Math.max(m.revenue, m.charges))) : 1;
  const days = (n: number | null) => (n === null ? "—" : `${n} j`);
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title inline-flex items-center gap-2"><Gauge size={22} /> Cockpit</h1>
          <p className="text-sm text-ink2">Toutes les activités sur une page, lues dans la comptabilité et dans les pièces ouvertes. Chiffres de gestion, à rapprocher des états de fin d&apos;exercice.</p>
        </div>
        <select className="h-10 px-3 rounded-xl border border-line2 text-sm" value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Exercice">
          {[0, 1, 2].map(k => new Date().getFullYear() - k).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {!c ? (res.error ? <div className="surface-card p-4 text-sm text-neg">{res.error}</div> : <div className="surface-card h-48 animate-pulse" />) : (
        <>
          {!c.currentYear && <div className="surface-card p-3 text-sm text-warn">Exercice {c.year} : le résultat porte sur l&apos;exercice ; trésorerie, créances, dettes, emprunts et cautions sont ceux d&apos;aujourd&apos;hui. Les délais clients et fournisseurs ne se calculent que sur l&apos;exercice en cours.</div>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Chiffre d'affaires" value={formatMoney(c.result.revenue)} sub="Compte de résultat SYSCOHADA (XB)" href="/accounting/etats" />
            <Tile label="Excédent brut d'exploitation" value={formatMoney(c.result.ebitda)} sub="Produits − charges externes − personnel" tone={c.result.ebitda < 0 ? "neg" : "pos"} />
            <Tile label="Résultat net" value={formatMoney(c.result.net)} sub={c.ratios.netMargin !== null ? `${c.ratios.netMargin} % du chiffre d'affaires` : undefined} tone={c.result.net < 0 ? "neg" : "pos"} />
            <Tile label="Trésorerie" value={formatMoney(c.treasury.total)} sub={`${c.treasury.accounts.length} caisse(s) et banque(s)`} tone={c.treasury.total < 0 ? "neg" : undefined} href="/treasury" />
            <Tile label="Créances clients" value={formatMoney(c.receivables.due)} sub={c.receivables.overdue ? `dont ${formatMoney(c.receivables.overdue)} en retard` : `${c.receivables.count} facture(s) ouverte(s)`} tone={c.receivables.overdue ? "neg" : undefined} href="/invoices" />
            <Tile label="Dettes fournisseurs" value={formatMoney(c.payables.due)} sub={c.payables.overdue ? `dont ${formatMoney(c.payables.overdue)} échues` : undefined} href="/depenses/echeancier" />
            <Tile label="Emprunts restant dus" value={formatMoney(c.debt.loans)} sub={c.debt.overdueInstallments ? `${formatMoney(c.debt.overdueInstallments)} d'échéances en retard` : `intérêts à venir ${formatMoney(c.debt.interestLeft)}`} tone={c.debt.overdueInstallments ? "neg" : undefined} href="/emprunts" />
            <Tile label="Cautions en cours" value={formatMoney(c.debt.guaranteesGiven)} sub={c.debt.guaranteesReceived ? `reçues : ${formatMoney(c.debt.guaranteesReceived)}` : "Engagements hors bilan"} href="/cautions" />
          </div>

          <section className="surface-card p-5">
            <h2 className="font-semibold text-ink mb-3">Ratios</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div><p className="text-ink2">Endettement net</p><p className="font-mono font-semibold">{formatMoney(c.ratios.netDebt)}</p><p className="text-[11px] text-ink3">Emprunts + découverts − trésorerie</p></div>
              <div><p className="text-ink2">Besoin en fonds de roulement (approché)</p><p className="font-mono font-semibold">{formatMoney(c.ratios.workingCapital)}</p><p className="text-[11px] text-ink3">Créances clients − dettes fournisseurs</p></div>
              <div><p className="text-ink2">Délai moyen clients / fournisseurs</p><p className="font-mono font-semibold">{days(c.ratios.dso)} / {days(c.ratios.dpo)}</p><p className="text-[11px] text-ink3">Estimés sur l&apos;exercice (TVA normale)</p></div>
              <div><p className="text-ink2">Couverture des intérêts</p><p className="font-mono font-semibold">{c.ratios.interestCover === null ? "—" : `${c.ratios.interestCover.toLocaleString("fr-FR")} ×`}</p><p className="text-[11px] text-ink3">EBE ÷ intérêts ; dette ÷ produits annuels : {c.ratios.debtToRevenue === null ? "—" : `${c.ratios.debtToRevenue} %`}</p></div>
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className="surface-card overflow-hidden">
              <h2 className="font-semibold text-ink px-5 py-3 border-b border-line">Par activité</h2>
              {c.activities.length === 0 ? <p className="p-5 text-sm text-ink3">Aucune écriture de produits ou de charges sur l&apos;exercice.</p> : (
                <div className="overflow-x-auto"><table className="table-dense w-full">
                  <thead><tr className="text-left text-ink2"><th>Activité</th><th className="text-right">Produits</th><th className="text-right">Charges</th><th className="text-right">Marge</th></tr></thead>
                  <tbody>{c.activities.map(a => (
                    <tr key={a.id ?? "none"} className="border-t border-line">
                      <td className={a.id ? "" : "text-ink3"}>{a.name}</td>
                      <td className="text-right font-mono">{formatMoney(a.revenue)}</td>
                      <td className="text-right font-mono">{formatMoney(a.charges)}</td>
                      <td className={`text-right font-mono font-semibold ${a.margin < 0 ? "text-neg" : ""}`}>{formatMoney(a.margin)}{a.marginRate !== null && <span className="block text-[11px] font-normal text-ink3">{a.marginRate} %</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              <p className="px-5 py-2 text-[11px] text-ink3 border-t border-line">Selon le secteur d&apos;activité imputé sur chaque écriture ; « Non imputé » rassemble le reste.</p>
            </section>
            <section className="surface-card p-5">
              <h2 className="font-semibold text-ink mb-3">Mois par mois</h2>
              <div className="space-y-1.5">
                {c.months.map((m, i) => (
                  <div key={m.month} className="grid grid-cols-[2.5rem_1fr] items-center gap-2 text-[11px]">
                    <span className="text-ink2">{MONTHS[i]}</span>
                    <div className="space-y-0.5">
                      <div className="h-2 rounded bg-pos/70" style={{ width: `${Math.max(0, m.revenue / max) * 100}%` }} title={`Produits ${formatMoney(m.revenue)}`} />
                      <div className="h-2 rounded bg-neg/60" style={{ width: `${Math.max(0, m.charges / max) * 100}%` }} title={`Charges ${formatMoney(m.charges)}`} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-ink3 mt-2">Vert : produits ; rouge : charges.</p>
            </section>
          </div>

          <section className="surface-card overflow-hidden">
            <h2 className="font-semibold text-ink px-5 py-3 border-b border-line">Caisses et banques</h2>
            <div className="divide-y divide-line">{c.treasury.accounts.map(a => (
              <div key={a.label} className="px-5 py-2 flex justify-between text-sm"><span className="text-ink2">{a.label}</span><span className={`font-mono ${a.balance < 0 ? "text-neg" : ""}`}>{formatMoney(a.balance)}</span></div>
            ))}</div>
          </section>
        </>
      )}
    </div>
  );
}
