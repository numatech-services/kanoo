"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { formatMoney, formatDate } from "@/lib/format";

interface Treasury { _id: string; label: string; type: string; ledgerCode?: string; openingBalance?: number }
interface Ledger { code: string; label: string }
interface Party { _id: string; name: string }
interface Line { accountCode: string; accountLabel: string; side: "debit" | "credit"; amount: string; thirdPartyId: string }
interface Existing { _id: string; entryDate: string; lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number }> }

const blank = (accountCode = "", side: Line["side"] = "debit", accountLabel = ""): Line => ({ accountCode, accountLabel, side, amount: "", thirdPartyId: "" });
const NO_LEDGER: Ledger[] = [];
const NO_TREASURY: Treasury[] = [];
const num = (s: string) => Math.round(Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0);

/**
 * Reprise des soldes d'ouverture : le bilan de départ d'une organisation qui
 * arrive sur Kanoo, saisi une fois et passé au journal AN. Banques et caisses
 * se reprennent compte par compte pour que la trésorerie parte du même chiffre.
 */
export default function ReprisePage() {
  const opening = useApi<{ entry?: Existing | null; accounts?: Treasury[] } | null>("/api/accounting/opening", o => o?.data ?? null, null);
  const ledgerAccounts = useApi<Ledger[]>("/api/ledger-accounts", l => l?.data ?? NO_LEDGER, NO_LEDGER);
  const clientsRes = useApi<Party[]>("/api/clients?picker=1&isActive=true", c => c?.data?.items ?? [], []);
  const suppliersRes = useApi<Party[]>("/api/suppliers?picker=1", s => s?.data?.items ?? [], []);
  const existing = opening.data?.entry ?? null;
  const treasury = opening.data?.accounts ?? NO_TREASURY;
  const ledger = useMemo(() => ledgerAccounts.data.filter(a => /^[1-5]/.test(a.code) && !/^5[27]/.test(a.code)), [ledgerAccounts.data]);
  const clients = clientsRes.data, suppliers = suppliersRes.data;
  const loaded = opening.loaded && ledgerAccounts.loaded && clientsRes.loaded && suppliersRes.loaded;
  // Les soldes de trésorerie saisis repartent de ceux du serveur à chaque lecture.
  const [tAmounts, setTAmounts] = useState<Record<string, string>>({});
  const [amountsFor, setAmountsFor] = useState(opening.data);
  if (opening.data !== amountsFor) {
    setAmountsFor(opening.data);
    setTAmounts(Object.fromEntries(treasury.map(a => [a._id, a.openingBalance ? String(a.openingBalance) : ""])));
  }
  const [date, setDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [lines, setLines] = useState<Line[]>([blank("101000", "credit", "Capital social"), blank("411000"), blank("401000", "credit")]);
  const [busy, setBusy] = useState(false);

  const load = () => { opening.reload(); ledgerAccounts.reload(); clientsRes.reload(); suppliersRes.reload(); };

  const labelOf = useMemo(() => new Map(ledger.map(a => [a.code, a.label])), [ledger]);
  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  const tDebit = treasury.reduce((t, a) => t + Math.max(0, num(tAmounts[a._id] ?? "")), 0);
  const tCredit = treasury.reduce((t, a) => t + Math.max(0, -num(tAmounts[a._id] ?? "")), 0);
  const debit = tDebit + lines.reduce((t, l) => t + (l.side === "debit" ? num(l.amount) : 0), 0);
  const credit = tCredit + lines.reduce((t, l) => t + (l.side === "credit" ? num(l.amount) : 0), 0);
  const gap = debit - credit;

  async function submit() {
    if (!(await confirmDialog({ title: "Passer la reprise des soldes ?", message: `Une écriture au journal AN, datée du ${formatDate(date)}, pour ${formatMoney(debit)} à l'actif comme au passif. Les soldes d'ouverture des comptes de trésorerie seront mis au même chiffre.`, confirmLabel: "Passer l'écriture" }))) return;
    setBusy(true);
    try {
      const res = await apiSend("POST", "/api/accounting/opening", {
        date,
        treasury: treasury.map(a => ({ accountId: a._id, amount: num(tAmounts[a._id] ?? "") })).filter(t => t.amount),
        lines: lines.filter(l => num(l.amount)).map(l => ({
          accountCode: l.accountCode.trim(), accountLabel: l.accountLabel || labelOf.get(l.accountCode.trim()) || "",
          debit: l.side === "debit" ? num(l.amount) : 0, credit: l.side === "credit" ? num(l.amount) : 0,
          thirdPartyId: l.thirdPartyId || undefined,
        })),
      });
      if (!res.ok) { showToast(res.data?.error || "Reprise refusée.", "error"); return; }
      showToast("Soldes d'ouverture repris.", "success");
      load();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <ScreenTabs group="accounting" />
      <div>
        <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
        <h1 className="page-title mt-1">Reprise des soldes d&apos;ouverture</h1>
        <p className="text-sm text-ink2">Reportez le bilan de clôture de votre ancien logiciel ou de votre expert-comptable : banques et caisses compte par compte, puis les autres soldes. L&apos;actif doit égaler le passif.</p>
      </div>

      {!loaded ? <div className="surface-card h-40 animate-pulse" /> : existing ? (
        <section className="surface-card p-5 space-y-3">
          <p className="font-semibold text-ink inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-pos" /> Soldes repris au {formatDate(existing.entryDate)}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink3"><th className="py-1">Compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead>
            <tbody>{existing.lines.map((l, i) => (
              <tr key={i} className="border-t border-line"><td className="py-1.5"><span className="font-mono">{l.accountCode}</span> {l.accountLabel}</td><td className="text-right num">{l.debit ? formatMoney(l.debit) : ""}</td><td className="text-right num">{l.credit ? formatMoney(l.credit) : ""}</td></tr>
            ))}</tbody>
          </table>
          <p className="text-xs text-ink2">Pour corriger, extournez l&apos;écriture « REPRISE-OUVERTURE » depuis les écritures comptables, puis refaites la reprise.</p>
        </section>
      ) : (
        <>
          <section className="surface-card p-5 space-y-3">
            <label className="block text-sm font-medium text-ink max-w-xs">Date d&apos;ouverture
              <input type="date" className={`${inputCls} mt-1`} value={date} onChange={e => setDate(e.target.value)} />
            </label>
          </section>

          <section className="surface-card p-5 space-y-3">
            <h2 className="font-semibold text-ink">Trésorerie</h2>
            <p className="text-xs text-ink2">Solde réel de chaque compte à la date d&apos;ouverture (négatif pour un découvert).</p>
            {treasury.length === 0 ? <p className="text-sm text-ink3">Aucun compte de trésorerie : créez vos banques et caisses dans Trésorerie.</p> : treasury.map(a => (
              <div key={a._id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-ink">{a.label}{a.ledgerCode && <span className="text-xs text-ink3 font-mono ml-2">{a.ledgerCode}</span>}</span>
                <input inputMode="numeric" aria-label={`Solde ${a.label}`} className={`${inputCls} w-44 text-right num`} value={tAmounts[a._id] ?? ""} onChange={e => setTAmounts(t => ({ ...t, [a._id]: e.target.value }))} placeholder="0" />
              </div>
            ))}
          </section>

          <section className="surface-card p-5 space-y-3">
            <h2 className="font-semibold text-ink">Autres soldes</h2>
            <p className="text-xs text-ink2">Capitaux, report à nouveau, immobilisations, stocks, clients, fournisseurs, dettes fiscales et sociales… Reprenez clients et fournisseurs tiers par tiers pour pouvoir les lettrer ensuite.</p>
            <datalist id="ledger-codes">{ledger.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</datalist>
            {lines.map((l, i) => {
              const parties = /^41/.test(l.accountCode) ? clients : /^40/.test(l.accountCode) ? suppliers : null;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <input list="ledger-codes" aria-label="Compte" className={`${inputCls} w-28 font-mono`} value={l.accountCode} onChange={e => setLine(i, { accountCode: e.target.value, accountLabel: "" })} placeholder="Compte" />
                  <span className="flex-1 min-w-[8rem] text-xs text-ink2 truncate">{labelOf.get(l.accountCode.trim()) ?? (l.accountCode ? "Compte absent du plan" : "")}</span>
                  {parties && (
                    <select aria-label="Tiers" className={`${selectCls} w-48`} value={l.thirdPartyId} onChange={e => setLine(i, { thirdPartyId: e.target.value })}>
                      <option value="">— Sans tiers —</option>{parties.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  )}
                  <select aria-label="Sens" className={`${selectCls} w-28`} value={l.side} onChange={e => setLine(i, { side: e.target.value as Line["side"] })}>
                    <option value="debit">Débit</option><option value="credit">Crédit</option>
                  </select>
                  <input inputMode="numeric" aria-label="Montant" className={`${inputCls} w-36 text-right num`} value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} placeholder="0" />
                  <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="p-2 text-ink3 hover:text-neg" aria-label="Retirer la ligne"><Trash2 size={14} /></button>
                </div>
              );
            })}
            <button type="button" onClick={() => setLines(ls => [...ls, blank()])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter un solde</button>
          </section>

          <section className="surface-card p-5 flex flex-wrap items-center gap-6">
            <div><p className="text-xs text-ink3">Actif (débit)</p><p className="num font-semibold text-ink">{formatMoney(debit)}</p></div>
            <div><p className="text-xs text-ink3">Passif (crédit)</p><p className="num font-semibold text-ink">{formatMoney(credit)}</p></div>
            <div><p className="text-xs text-ink3">Écart</p><p className={`num font-semibold ${gap ? "text-neg" : "text-pos"}`}>{formatMoney(gap)}</p></div>
            <button type="button" disabled={busy || gap !== 0 || debit === 0} onClick={submit} className={`${buttonClass("primary")} ml-auto`}>{busy ? "…" : "Passer la reprise"}</button>
          </section>
        </>
      )}
    </div>
  );
}
