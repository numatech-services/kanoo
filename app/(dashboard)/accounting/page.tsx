"use client";
import { useState, useEffect, Fragment } from "react";
import Link from "next/link";
import { FlowFilterBar, useFlowFilter, type FlowTotals } from "@/components/ui/FlowFilterBar";
import { Plus, Search, ChevronDown, ChevronRight, Undo2, Pencil, History, Lock, FileSpreadsheet, Hash, Link2, Boxes } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { StockVariationDialog } from "@/components/accounting/StockVariationDialog";
import { localDay } from "@/lib/format";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";
interface Line { accountCode: string; accountLabel: string; debit: number; credit: number; projectId?: string; activityId?: string; costCenter?: string }
interface Entry {
  _id: string; journalCode: string; entryDate: string; reference: string; label: string; lines: Line[];
  isLettered?: boolean; letterRef?: string; linkedDocType?: string; reversedBy?: string; reverses?: string;
}
const JOURNALS: Record<string, string> = { VT: "Ventes", AC: "Achats", BQ: "Banque", CA: "Caisse", OD: "Opérations diverses", AN: "À-nouveaux", EX: "Extournes" };
const fmt = (n: number) => n.toLocaleString("fr-FR");
type Lock = { lockedUntil: string | null; closedYears: number[] };
const NO_LOCK: Lock = { lockedUntil: null, closedYears: [] };

export default function AccountingPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "accountingEntries", "create");
  const canReverse = meCanDo(me, "accountingEntries", "delete");
  const canUpdate = meCanDo(me, "accountingEntries", "update");
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ journal: "", lettered: "", search: "", account: "" });
  const flowFilter = useFlowFilter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closingOpen, setClosingOpen] = useState(false);
  const [variationOpen, setVariationOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const LIMIT = 30;

  // Changement de période : retour à la première page.
  const [prevFlowQuery, setPrevFlowQuery] = useState(flowFilter.query);
  if (flowFilter.query !== prevFlowQuery) { setPrevFlowQuery(flowFilter.query); setPage(1); }
  const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  new URLSearchParams(flowFilter.query).forEach((v, k) => p.set(k, v));
  const list = useApi<{ items?: Entry[]; pagination?: { total?: number }; totals?: FlowTotals } | null>(
    `/api/accounting-entries?${p}`, d => d?.data ?? null, null,
  );
  const entries = list.data?.items ?? [];
  const total = list.data?.pagination?.total ?? 0;
  const totals = list.data?.totals ?? null;
  const closing = useApi<Lock>("/api/accounting/closing", l => l?.data ?? NO_LOCK, NO_LOCK);
  const lock = closing.data;
  const load = () => { list.reload(); closing.reload(); };
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
                    <td className="text-right whitespace-nowrap">
                      {canUpdate && (() => {
                        const why = editBlock(e, lock.lockedUntil);
                        return (
                          <button onClick={ev => { ev.stopPropagation(); if (!why) setEditing(e); }} disabled={!!why} aria-disabled={!!why}
                            title={why ?? "Modifier le libellé, la pièce ou l'imputation (motif obligatoire)"} aria-label={why ? `Modification impossible : ${why}` : `Modifier l'écriture ${e.reference}`}
                            className="p-1.5 text-ink3 hover:text-section disabled:opacity-40 disabled:cursor-not-allowed"><Pencil size={14} /></button>
                        );
                      })()}
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
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {canUpdate && (() => {
                            const why = editBlock(e, lock.lockedUntil);
                            return why
                              ? <span className="text-[11px] text-ink3">Modification impossible : {why}.</span>
                              : <button onClick={() => setEditing(e)} className={buttonClass("secondary", "sm")}><Pencil size={13} /> Modifier</button>;
                          })()}
                          <Link href={`/audit?ecriture=${e._id}`} className={buttonClass("ghost", "sm")}><History size={13} /> Historique</Link>
                        </div>
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
      {editing && <EditEntryDialog entry={editing} onClose={() => setEditing(null)}
        onDone={text => { setEditing(null); setMsg({ ok: true, text }); load(); }} />}
      {closingOpen && <ClosingDialog lock={lock} onClose={() => setClosingOpen(false)} onDone={() => { setClosingOpen(false); load(); }} />}
    </div>
  );
}

/** Pourquoi une écriture ne se modifie pas (null : modifiable). */
function editBlock(e: Entry, lockedUntil: string | null): string | null {
  if (e.reversedBy) return "écriture extournée";
  if (e.reverses) return "écriture d'extourne";
  if (lockedUntil && new Date(e.entryDate) <= new Date(lockedUntil)) return `période verrouillée jusqu'au ${new Date(lockedUntil).toLocaleDateString("fr-FR", { timeZone: "UTC" })}`;
  return null;
}

const idOf = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const o = v as { _id?: unknown };
  return String(o._id ?? v);
};

/**
 * Modification d'une écriture, motif obligatoire : libellé et pièce, ou
 * imputation analytique (écriture saisie à la main). L'ancienne valeur, la
 * nouvelle et le motif sont gardés au journal d'audit, dans la même opération.
 * Les montants et les comptes ne se modifient pas : ils se corrigent par extourne.
 */
function EditEntryDialog({ entry, onClose, onDone }: { entry: Entry; onClose: () => void; onDone: (text: string) => void }) {
  const fromDocument = !!entry.linkedDocType && entry.linkedDocType !== "manual";
  const [mode, setMode] = useState<"texte" | "imputation">("texte");
  const [label, setLabel] = useState(entry.label);
  const [reference, setReference] = useState(entry.reference);
  const initialImps = entry.lines.map(l => ({ projectId: idOf(l.projectId), activityId: idOf(l.activityId), costCenter: l.costCenter || undefined }));
  const [imps, setImps] = useState<ImputationValue[]>(initialImps);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = (i: ImputationValue) => `${i.projectId ?? ""}|${i.activityId ?? ""}|${i.costCenter ?? ""}`;
  const changed = mode === "texte"
    ? label.trim() !== entry.label || (!fromDocument && reference.trim() !== entry.reference)
    : imps.some((x, i) => key(x) !== key(initialImps[i]));
  async function save() {
    if (!changed) { setError("Rien n'a changé."); return; }
    if (mode === "texte" && !label.trim()) { setError("Le libellé ne peut pas être vide."); return; }
    if (mode === "texte" && !fromDocument && !reference.trim()) { setError("La pièce ne peut pas être vide."); return; }
    if (reason.trim().length < 5) { setError("Indiquez le motif de la modification (5 caractères au moins)."); return; }
    setBusy(true); setError("");
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (mode === "texte") { body.label = label.trim(); if (!fromDocument) body.reference = reference.trim(); }
    else body.imputations = imps;
    const res = await apiSend("PATCH", `/api/accounting-entries/${entry._id}`, body);
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Modification refusée."); return; }
    onDone(`Écriture ${mode === "texte" && !fromDocument ? reference.trim() : entry.reference} modifiée ; le motif est enregistré au journal d'audit.`);
  }
  const tab = (k: typeof mode, l: string) => (
    <button type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setError(""); }}
      className={`px-3 py-1.5 rounded-full text-sm ${mode === k ? "bg-section text-white" : "bg-surface2 text-ink2"}`}>{l}</button>
  );
  return (
    <Modal open onClose={onClose} title={`Modifier l'écriture ${entry.reference}`} size={mode === "imputation" ? "lg" : "md"}
      description="Un montant ou un compte erroné ne se modifie pas : il se corrige par extourne puis nouvelle saisie."
      footer={<>
        <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
        <button onClick={save} disabled={busy} className={buttonClass("primary", "md")}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
      </>}>
      <div className="space-y-4">
        <div className="flex gap-2" role="tablist">{tab("texte", "Libellé et pièce")}{tab("imputation", "Imputation analytique")}</div>
        {error && <p role="alert" className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        {mode === "texte" ? <>
          <FormField label="Libellé" required>
            <input className={inputCls} value={label} maxLength={300} onChange={e => setLabel(e.target.value)} />
          </FormField>
          <FormField label="Pièce (référence)" required={!fromDocument}
            hint={fromDocument ? "Écriture produite par un document (facture, achat…) : sa référence le relie au document et ne se modifie pas." : undefined}>
            <input className={inputCls} value={reference} maxLength={80} disabled={fromDocument} onChange={e => setReference(e.target.value)} />
          </FormField>
        </> : fromDocument ? (
          <p className="p-3 bg-surface2 text-sm text-ink2 rounded-lg">Écriture produite par un document : changez le projet ou le secteur sur le document lui-même (facture, achat, note de frais). L&apos;écriture est mise à jour en même temps ; un motif vous sera demandé.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink2">Projet, secteur et service de chaque ligne. Les montants et les comptes restent tels quels.</p>
            {entry.lines.map((l, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-sm text-ink"><span className="font-mono text-xs">{l.accountCode}</span> {l.accountLabel} <span className="text-ink3 font-mono text-xs">{fmt(l.debit || l.credit)} {l.debit ? "D" : "C"}</span></p>
                <ImputationFields value={imps[i]} onChange={v => setImps(all => all.map((x, k) => (k === i ? v : x)))} />
              </div>
            ))}
          </div>
        )}
        {!(mode === "imputation" && fromDocument) && (
          <FormField label="Motif de la modification" required hint="5 caractères au moins. Conservé au journal d'audit avec l'ancienne et la nouvelle valeur.">
            <textarea className={inputCls} rows={3} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  );
}

function ClosingDialog({ lock, onClose, onDone }: { lock: { lockedUntil: string | null; closedYears: number[] }; onClose: () => void; onDone: () => void }) {
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const [until, setUntil] = useState(localDay(lastMonthEnd));
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alloc, setAlloc] = useState({ year: Math.max(0, ...lock.closedYears) || new Date().getFullYear() - 1, reserve: "", report: "", dividends: "" });
  async function post(body: unknown) {
    setBusy(true); setError("");
    const res = await apiSend("POST", "/api/accounting/closing", body);
    const d = res.data;
    setBusy(false);
    if (!res.ok) { setError(d.error || "Opération refusée"); return false; }
    onDone();
    return true;
  }
  // Clôture : contrôles d'abord (dotations, stock, compte d'attente,
  // brouillons) ; les avertissements se confirment explicitement.
  async function close() {
    setBusy(true); setError("");
    const r = await apiSend("POST", "/api/accounting/closing", { action: "check", year });
    setBusy(false);
    if (!r.ok) { setError(r.data?.error || "Contrôle impossible"); return; }
    const checks = (r.data?.data?.checks ?? []) as Array<{ level: string; message: string }>;
    const blocking = checks.filter(c => c.level === "block");
    if (blocking.length) { setError(blocking.map(c => c.message).join(" ")); return; }
    const message = checks.length
      ? `Points relevés :\n• ${checks.map(c => c.message).join("\n• ")}\n\nClôturer quand même ? L'exercice sera verrouillé.`
      : "Les à-nouveaux seront générés et l'exercice verrouillé. Irréversible.";
    if (await confirmDialog({ title: `Clôturer définitivement l'exercice ${year} ?`, message, danger: true })) {
      await post({ action: "close", year, acknowledgeWarnings: checks.length > 0 });
    }
  }
  // Reculer la date rouvre une période déjà verrouillée : motif demandé, gardé au journal.
  async function lockPeriod() {
    const reopening = !!lock.lockedUntil && new Date(`${until}T23:59:59`) < new Date(lock.lockedUntil);
    if (!reopening) { await post({ action: "lock", until }); return; }
    const reason = await promptDialog({
      title: "Rouvrir une période verrouillée ?",
      message: `La saisie redeviendra possible après le ${new Date(`${until}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })}. Si une déclaration de TVA a été déposée pour cette période, toute modification devra être régularisée.`,
      label: "Motif de la réouverture (5 caractères au moins)", confirmLabel: "Rouvrir", required: true, multiline: true,
    });
    if (!reason?.trim()) return;
    if (reason.trim().length < 5) { setError("Motif trop court : 5 caractères au moins."); return; }
    await post({ action: "lock", until, reason: reason.trim() });
  }
  async function allocate() {
    const allocations = [
      { accountCode: "111000", amount: Number(alloc.reserve) || 0 },
      { accountCode: "121000", amount: Number(alloc.report) || 0 },
      { accountCode: "465000", amount: Number(alloc.dividends) || 0 },
    ].filter(a => a.amount > 0);
    await post({ action: "allocate", year: alloc.year, allocations });
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
            <button disabled={busy} onClick={lockPeriod} className={buttonClass("primary", "md")}>Verrouiller</button>
          </div>
        </div>
        <div className="space-y-2 pt-4 border-t border-line">
          <p className="text-sm font-semibold text-ink">Clôturer un exercice</p>
          <p className="text-xs text-ink2">Génère les à-nouveaux au 1er janvier suivant (comptes de bilan et résultat en instance d&apos;affectation) et verrouille l&apos;exercice. Irréversible. Exercices clôturés : {lock.closedYears.length ? lock.closedYears.join(", ") : "aucun"}.</p>
          <div className="flex gap-2">
            <FormField label="Exercice"><input type="number" className={inputCls} value={year} onChange={e => setYear(Number(e.target.value))} /></FormField>
            <button disabled={busy} onClick={close} className="self-end px-4 h-10 rounded-lg border border-neg/30 text-neg text-sm font-semibold hover:bg-neg-50 disabled:opacity-60">Clôturer {year}</button>
          </div>
        </div>
        {lock.closedYears.length > 0 && (
          <div className="space-y-2 pt-4 border-t border-line">
            <p className="text-sm font-semibold text-ink">Affecter le résultat</p>
            <p className="text-xs text-ink2">Selon la décision de l&apos;assemblée : le résultat en instance (130) est réparti entre réserve légale, report à nouveau et dividendes. La somme doit égaler le résultat.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <FormField label="Exercice">
                <select className={inputCls} value={alloc.year} onChange={e => setAlloc(a => ({ ...a, year: Number(e.target.value) }))}>
                  {lock.closedYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </FormField>
              <FormField label="Réserve légale"><input type="number" min="0" className={inputCls} value={alloc.reserve} onChange={e => setAlloc(a => ({ ...a, reserve: e.target.value }))} /></FormField>
              <FormField label="Report à nouveau"><input type="number" min="0" className={inputCls} value={alloc.report} onChange={e => setAlloc(a => ({ ...a, report: e.target.value }))} /></FormField>
              <FormField label="Dividendes"><input type="number" min="0" className={inputCls} value={alloc.dividends} onChange={e => setAlloc(a => ({ ...a, dividends: e.target.value }))} /></FormField>
            </div>
            <button disabled={busy} onClick={allocate} className={buttonClass("secondary", "md")}>Passer l&apos;écriture d&apos;affectation</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
