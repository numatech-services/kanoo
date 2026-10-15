"use client";
import { useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { FlowFilterBar, useFlowFilter, type FlowTotals } from "@/components/ui/FlowFilterBar";
import { Plus, Search, ChevronDown, ChevronRight, Undo2, Lock, FileSpreadsheet, Hash, Link2, Boxes } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import {apiJson, apiSend } from "@/lib/api-client";
import { StockVariationDialog } from "@/components/accounting/StockVariationDialog";
interface Line { accountCode: string; accountLabel: string; debit: number; credit: number; projectId?: string; activityId?: string; costCenter?: string }
interface Entry {
  _id: string; journalCode: string; entryDate: string; reference: string; label: string; lines: Line[];
  isLettered?: boolean; letterRef?: string; linkedDocType?: string; reversedBy?: string; reverses?: string;
}
const JOURNALS: Record<string, string> = { VT: "Ventes", AC: "Achats", BQ: "Banque", CA: "Caisse", OD: "Opérations diverses", AN: "À-nouveaux", EX: "Extournes" };
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function AccountingPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "accountingEntries", "create");
  const canReverse = meCanDo(me, "accountingEntries", "delete");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ journal: "", lettered: "", search: "", account: "" });
  const flowFilter = useFlowFilter();
  const [totals, setTotals] = useState<FlowTotals | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [lock, setLock] = useState<{ lockedUntil: string | null; closedYears: number[] }>({ lockedUntil: null, closedYears: [] });
  const [closingOpen, setClosingOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const LIMIT = 30;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    new URLSearchParams(flowFilter.query).forEach((v, k) => p.set(k, v));
    const [d, l] = await Promise.all([
      apiJson(`/api/accounting-entries?${p}`).catch(() => null),
      apiJson("/api/accounting/closing").catch(() => null),
    ]);
    setEntries(d?.data?.items ?? []); setTotal(d?.data?.pagination?.total ?? 0); setTotals(d?.data?.totals ?? null);
    if (l?.data) setLock(l.data);
  }, [page, f, flowFilter.query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [flowFilter.query]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); setF(x => ({ ...x, search: q.trim() })); }, 300); return () => clearTimeout(t); }, [q]);
  const setFilter = (patch: Partial<typeof f>) => { setPage(1); setF(x => ({ ...x, ...patch })); };
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function reverse(e: Entry) {
    const reason = await promptDialog({ title: `Extourner l'écriture ${e.reference} ? Motif :`, multiline: true });
    if (!reason) return;
    const res = await apiSend("POST", `/api/accounting-entries/${e._id}/reverse`, { reason });
    const d = res.data;
    setMsg({ ok: res.ok, text: res.ok ? `Écriture ${e.reference} extournée.` : d.error });
    if (res.ok) load();
  }

  return (
    <div className="space-y-5">
      <ScreenTabs group="accounting" />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Comptabilité — journal</h1>
          <p className="text-sm text-ink2">{total} écriture{total > 1 ? "s" : ""}{lock.lockedUntil ? ` · période verrouillée jusqu'au ${new Date(lock.lockedUntil).toLocaleDateString("fr-FR")}` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/accounting/etats" className={buttonClass("secondary", "md")}><FileSpreadsheet size={15} /> États</Link>
          <Link href="/accounting/plan" className={buttonClass("secondary", "md")}><Hash size={15} /> Plan comptable</Link>
          <Link href="/accounting/lettrage" className={buttonClass("secondary", "md")}><Link2 size={15} /> Lettrage</Link>
          {canReverse && <button onClick={() => setVariationOpen(true)} className={buttonClass("secondary", "md")}><Boxes size={15} /> Variation de stock</button>}
          {canReverse && <button onClick={() => setClosingOpen(true)} className={buttonClass("secondary", "md")}><Lock size={15} /> Clôture</button>}
          {canCreate && <Link href="/accounting/new" className={buttonClass("primary", "md")}><Plus size={16} /> Écriture</Link>}
        </div>
      </div>
      {msg && <p className={`p-3 rounded-lg text-sm ${msg.ok ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>{msg.text}</p>}

      <div className="flex gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="Pièce, libellé, intitulé de compte" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <input className={`${inputCls} w-32`} placeholder="Compte (ex. 411)" value={f.account} onChange={e => setFilter({ account: e.target.value.replace(/\D/g, "") })} aria-label="Compte" />
        <select className={`${selectCls} w-auto`} value={f.journal} onChange={e => setFilter({ journal: e.target.value })} aria-label="Journal">
          <option value="">Tous journaux</option>{Object.entries(JOURNALS).map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}
        </select>
        <select className={`${selectCls} w-auto`} value={f.lettered} onChange={e => setFilter({ lettered: e.target.value })} aria-label="Lettrage">
          <option value="">Lettrées ou non</option><option value="true">Lettrées</option><option value="false">Non lettrées</option>
        </select>
      </div>
      <FlowFilterBar state={flowFilter} totals={totals} />
      <p className="text-[11px] text-ink3 -mt-2">Recettes : écritures de produits (classe 7) ; dépenses : écritures de charges (classe 6). Totaux sur la période et le journal choisis.</p>

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th /><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th className="text-right">Montant</th><th>État</th><th /></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={8} className="text-center text-ink3 py-8">Aucune écriture</td></tr>}
            {entries.map(e => {
              const amount = e.lines.reduce((s, l) => s + l.debit, 0);
              const isOpen = open.has(e._id);
              return (
                <Fragment key={e._id}>
                  <tr className={`border-t border-line hover:bg-surface2/30 cursor-pointer ${e.reversedBy ? "opacity-60" : ""}`} onClick={() => toggle(e._id)}>
                    <td className="w-6 text-ink3">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="text-xs whitespace-nowrap">{new Date(e.entryDate).toLocaleDateString("fr-FR")}</td>
                    <td className="font-mono text-xs">{e.journalCode}</td>
                    <td className="font-mono text-xs">{e.reference}</td>
                    <td className="text-xs">{e.label}</td>
                    <td className="text-right font-mono">{fmt(amount)}</td>
                    <td className="text-[11px] text-ink2 whitespace-nowrap">
                      {e.reversedBy ? "extournée" : e.reverses ? "extourne" : e.isLettered ? `lettrée ${e.letterRef ?? ""}` : ""}
                    </td>
                    <td className="text-right">
                      {canReverse && (!e.linkedDocType || e.linkedDocType === "manual") && !e.reversedBy && !e.reverses && (
                        <button onClick={ev => { ev.stopPropagation(); reverse(e); }} title="Extourner" className="p-1 text-ink3 hover:text-neg"><Undo2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-surface2/20">
                      <td />
                      <td colSpan={7} className="py-2">
                        <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {e.lines.map((l, i) => (
                              <tr key={i}>
                                <td className="font-mono w-24 py-0.5">{l.accountCode}</td>
                                <td>{l.accountLabel}{(l.projectId || l.activityId || l.costCenter) && <span className="ml-2 text-section">· imputée</span>}</td>
                                <td className="text-right font-mono w-32">{l.debit ? fmt(l.debit) : ""}</td>
                                <td className="text-right font-mono w-32">{l.credit ? fmt(l.credit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      {variationOpen && <StockVariationDialog onClose={() => setVariationOpen(false)} onDone={() => { setVariationOpen(false); load(); }} />}
      {closingOpen && <ClosingDialog lock={lock} onClose={() => setClosingOpen(false)} onDone={() => { setClosingOpen(false); load(); }} />}
    </div>
  );
}

function ClosingDialog({ lock, onClose, onDone }: { lock: { lockedUntil: string | null; closedYears: number[] }; onClose: () => void; onDone: () => void }) {
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const [until, setUntil] = useState(lastMonthEnd.toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function post(body: unknown) {
    setBusy(true); setError("");
    const res = await apiSend("POST", "/api/accounting/closing", body);
    const d = res.data;
    setBusy(false);
    if (!res.ok) { setError(d.error || "Opération refusée"); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Verrouillage et clôture">
      <div className="space-y-5">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Verrouiller une période</p>
          <p className="text-xs text-ink2">Plus aucune écriture ne peut être datée jusqu&apos;à cette date (TVA déposée, mois arrêté). Actuellement : {lock.lockedUntil ? new Date(lock.lockedUntil).toLocaleDateString("fr-FR") : "aucun verrou"}.</p>
          <div className="flex gap-2">
            <input type="date" className={inputCls} value={until} onChange={e => setUntil(e.target.value)} aria-label="Verrouiller jusqu'au" />
            <button disabled={busy} onClick={() => post({ action: "lock", until })} className={buttonClass("primary", "md")}>Verrouiller</button>
          </div>
        </div>
        <div className="space-y-2 pt-4 border-t border-line">
          <p className="text-sm font-semibold text-ink">Clôturer un exercice</p>
          <p className="text-xs text-ink2">Génère les à-nouveaux au 1er janvier suivant (comptes de bilan et résultat en instance d&apos;affectation) et verrouille l&apos;exercice. Irréversible. Exercices clôturés : {lock.closedYears.length ? lock.closedYears.join(", ") : "aucun"}.</p>
          <div className="flex gap-2">
            <FormField label="Exercice"><input type="number" className={inputCls} value={year} onChange={e => setYear(Number(e.target.value))} /></FormField>
            <button disabled={busy} onClick={async () => { if (await confirmDialog({ title: `Clôturer définitivement l'exercice ${year} ?`, danger: true })) post({ action: "close", year }); }} className="self-end px-4 h-10 rounded-lg border border-neg/30 text-neg text-sm font-semibold hover:bg-neg-50 disabled:opacity-60">Clôturer {year}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
