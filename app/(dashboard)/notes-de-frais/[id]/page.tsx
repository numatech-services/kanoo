"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Trash2, Send, Check, X, Banknote, AlertTriangle, Info,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Inset, Avatar, Pill } from "@/components/ui/Primitives";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ReceiptCapture } from "@/components/expenses/ReceiptCapture";
import { fullXof } from "@/components/ui/charts/geometry";
import {
  CATEGORIES, STATUS_LABEL, computeLine,
  type ExpenseCategory, type ExpenseStatus, type ExpensePolicy, type LineIssue,
} from "@/lib/expenses";

interface Line {
  _id: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  amountTTC: number;
  vatAmount: number;
  vatRecoverable: boolean;
  attachmentCount?: number;
}

interface Report {
  _id: string;
  reference: string;
  title: string;
  status: ExpenseStatus;
  lines: Line[];
  totalTTC: number;
  rejectionReason?: string;
  employeeId?: { firstName?: string; lastName?: string; bankAccount?: string; bankName?: string };
  createdBy?: { firstName?: string; lastName?: string };
}

interface Payload {
  report: Report;
  policy: ExpensePolicy;
  issues: LineIssue[];
  totals: { totalTTC: number; totalVatDeducted: number; totalCharge: number };
  canApprove: boolean;
}

interface TreasuryAccount { _id: string; label: string }

const EMPTY_LINE = () => ({
  date: new Date().toISOString().slice(0, 10),
  category: "transport" as ExpenseCategory,
  description: "",
  amountTTC: 0,
  vatAmount: 0,
  vatRecoverable: CATEGORIES.transport.vatRecoverableByDefault,
});

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function NoteDeFraisPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  const [accountId, setAccountId] = useState("");

  const load = useCallback(() => {
    fetch(`/api/expenses/${id}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const list: TreasuryAccount[] = d.data?.items || [];
        setAccounts(list);
        if (list.length === 1) setAccountId(list[0]._id);
      })
      .catch(() => { /* le compte se choisit à la main si la lecture échoue */ });
  }, []);

  async function patch(body: Record<string, unknown>, successKey = "message") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Action refusée");
      if (d.data?.[successKey]) setNotice(d.data[successKey]);
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Note introuvable."}
    </p>;
  }

  const { report, issues, totals, canApprove, policy } = data;
  const editable = report.status === "draft" || report.status === "rejected";
  const blocking = issues.filter(i => i.level === "block");
  const warnings = issues.filter(i => i.level === "warn");
  const beneficiary = [report.employeeId?.firstName, report.employeeId?.lastName]
    .filter(Boolean).join(" ") || "—";

  function updateLine(index: number, patchLine: Partial<Line>) {
    if (!data) return;
    const lines = data.report.lines.map((l, i) => (i === index ? { ...l, ...patchLine } : l));
    setData({ ...data, report: { ...data.report, lines } });
  }

  async function saveLines(lines: Partial<Line>[]) {
    await patch({ lines });
  }

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <Link href="/notes-de-frais" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Notes de frais
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">{report.title}</h1>
          <p className="text-sm text-ink2 flex items-center gap-2 mt-0.5">
            <span className="font-mono text-xs">{report.reference}</span>
            <span className="text-ink3">·</span>
            <Avatar name={beneficiary} size="sm" />
            <span>{beneficiary}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={report.status} label={STATUS_LABEL[report.status]} />

          {editable && (
            <button onClick={() => patch({ status: "submitted" })}
              disabled={busy || blocking.length > 0 || report.lines.length === 0}
              title={blocking.length > 0 ? "Des anomalies bloquent l'envoi" : undefined}
              className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
              <Send size={15} /> Envoyer en validation
            </button>
          )}

          {report.status === "submitted" && canApprove && (
            <>
              <button onClick={() => patch({ status: "approved" })} disabled={busy}
                className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-pos text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
                <Check size={15} /> Approuver
              </button>
              <button
                onClick={() => {
                  const reason = window.prompt(
                    "Pourquoi cette note est-elle refusée ?\n"
                    + "Sans motif, le salarié ne sait pas quoi corriger."
                  );
                  if (reason?.trim()) patch({ status: "rejected", reason });
                }}
                disabled={busy}
                className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/40 text-neg text-sm hover:bg-neg-50 disabled:opacity-50">
                <X size={15} /> Refuser
              </button>
            </>
          )}

          {report.status === "approved" && canApprove && (
            <button onClick={() => setPayOpen(true)} disabled={busy}
              className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-pos text-white text-sm font-semibold hover:brightness-95">
              <Banknote size={15} /> Rembourser
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {report.status === "rejected" && report.rejectionReason && (
        <Inset tone="neg">
          <strong>Refusée.</strong> {report.rejectionReason}
        </Inset>
      )}

      {report.status === "approved" && (
        <Inset tone="info">
          Approuvée : l&apos;écriture d&apos;engagement est passée et la dette figure au
          bilan. Elle ne s&apos;éteindra qu&apos;au remboursement.
        </Inset>
      )}

      {/* ── Totaux ──────────────────────────────────────────────────────── */}
      <div className="strip" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <div>
          <p className="text-xs text-ink2">Total engagé</p>
          <p className="text-xl font-bold text-ink num mt-0.5">{fullXof(totals.totalTTC)}</p>
        </div>
        <div>
          <p className="text-xs text-ink2">TVA récupérable</p>
          <p className="text-xl font-bold text-pos num mt-0.5">{fullXof(totals.totalVatDeducted)}</p>
        </div>
        <div>
          <p className="text-xs text-ink2">Charge nette</p>
          <p className="text-xl font-bold text-ink num mt-0.5">{fullXof(totals.totalCharge)}</p>
          <p className="text-[11px] text-ink3 mt-0.5">Ce qui pèse réellement sur le résultat</p>
        </div>
      </div>

      {blocking.length > 0 && (
        <Inset tone="warn">
          <strong>{blocking.length} anomalie(s) empêchent l&apos;envoi.</strong>{" "}
          Elles sont signalées sur les lignes concernées.
        </Inset>
      )}
      {warnings.length > 0 && (
        <Inset tone="info">
          {warnings.length} point(s) d&apos;attention — n&apos;empêchent pas l&apos;envoi,
          mais l&apos;approbateur les verra.
        </Inset>
      )}

      {/* ── Lignes ──────────────────────────────────────────────────────── */}
      <section className="surface-card overflow-hidden">
        <div className="p-5 pb-3 flex items-center justify-between">
          <h2 className="font-semibold text-ink">Dépenses</h2>
          {editable && (
            <button
              onClick={() => saveLines([...report.lines, EMPTY_LINE()])}
              disabled={busy}
              className="px-3 h-9 inline-flex items-center gap-1.5 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
              <Plus size={14} /> Ajouter une dépense
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="table-dense min-w-[56rem]">
            <thead>
              <tr>
                <th>Date</th><th>Nature</th><th>Objet</th>
                <th className="text-right">Montant TTC</th><th className="text-right">dont TVA</th>
                <th>Justificatif</th><th></th>
              </tr>
            </thead>
            <tbody>
              {report.lines.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-ink3">
                  Aucune dépense. Ajoutez-en une, puis photographiez son reçu.
                </td></tr>
              )}
              {report.lines.map((line, index) => {
                const spec = CATEGORIES[line.category] ?? CATEGORIES.autre;
                const computed = computeLine(
                  { ...line, date: line.date, attachmentCount: line.attachmentCount }, policy
                );
                const lineIssues = issues.filter(i => i.index === index);
                return (
                  <tr key={line._id || index}
                    className={lineIssues.some(i => i.level === "block") ? "bg-neg-50/40" : ""}>
                    <td>
                      {editable ? (
                        <input type="date" value={String(line.date).slice(0, 10)}
                          onChange={e => updateLine(index, { date: e.target.value })}
                          onBlur={() => saveLines(report.lines)}
                          className="w-32 px-2 h-8 rounded border border-line2 bg-surface text-xs" />
                      ) : (
                        <span className="text-ink2 text-xs whitespace-nowrap">
                          {new Date(line.date).toLocaleDateString("fr-FR")}
                        </span>
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <select value={line.category}
                          onChange={e => {
                            const cat = e.target.value as ExpenseCategory;
                            updateLine(index, {
                              category: cat,
                              // Le défaut de la nouvelle nature s'applique tant
                              // que l'utilisateur n'a pas tranché lui-même.
                              vatRecoverable: CATEGORIES[cat].vatRecoverableByDefault,
                            });
                          }}
                          onBlur={() => saveLines(report.lines)}
                          className="w-36 px-2 h-8 rounded border border-line2 bg-surface text-xs">
                          {Object.entries(CATEGORIES).map(([key, c]) => (
                            <option key={key} value={key}>{c.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink2 text-xs">{spec.label}</span>
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input value={line.description}
                          placeholder="Taxi aéroport → bureau"
                          onChange={e => updateLine(index, { description: e.target.value })}
                          onBlur={() => saveLines(report.lines)}
                          className="w-full min-w-[12rem] px-2 h-8 rounded border border-line2 bg-surface text-xs" />
                      ) : (
                        <span className="text-ink">{line.description}</span>
                      )}
                    </td>
                    <td className="text-right">
                      {editable ? (
                        <input type="number" min={0} value={line.amountTTC}
                          onChange={e => updateLine(index, { amountTTC: Number(e.target.value) })}
                          onBlur={() => saveLines(report.lines)}
                          className="w-28 px-2 h-8 rounded border border-line2 bg-surface text-xs text-right num" />
                      ) : (
                        <span className="num font-medium text-ink">{fullXof(line.amountTTC)}</span>
                      )}
                    </td>
                    <td className="text-right">
                      {editable ? (
                        <input type="number" min={0} value={line.vatAmount}
                          onChange={e => updateLine(index, { vatAmount: Number(e.target.value) })}
                          onBlur={() => saveLines(report.lines)}
                          className="w-24 px-2 h-8 rounded border border-line2 bg-surface text-xs text-right num" />
                      ) : (
                        <span className="num text-ink2">{fullXof(line.vatAmount)}</span>
                      )}
                      {computed.vatDeducted === 0 && line.vatAmount > 0 && (
                        <p className="text-[10px] text-ink3">non déductible</p>
                      )}
                    </td>
                    <td>
                      <ReceiptCapture
                        hostId={report._id}
                        lineId={line._id}
                        count={line.attachmentCount || 0}
                        disabled={!editable}
                        onUploaded={load}
                      />
                    </td>
                    <td>
                      {editable && (
                        <button
                          onClick={() => saveLines(report.lines.filter((_, i) => i !== index))}
                          disabled={busy}
                          className="p-1.5 rounded-lg text-ink3 hover:text-neg hover:bg-neg-50">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {issues.length > 0 && (
          <ul className="border-t border-line divide-y divide-line">
            {issues.map((issue, i) => (
              <li key={i} className={`px-5 py-2 text-xs flex items-start gap-2 ${
                issue.level === "block" ? "text-neg" : "text-warn"
              }`}>
                {issue.level === "block"
                  ? <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  : <Info size={13} className="shrink-0 mt-0.5" />}
                <span><strong>Ligne {issue.index + 1}</strong> — {issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.employeeId?.bankAccount && report.status === "approved" && (
        <p className="text-xs text-ink2">
          Coordonnées de règlement&nbsp;: {report.employeeId.bankName || "—"} ·{" "}
          <span className="font-mono">{report.employeeId.bankAccount}</span>
        </p>
      )}

      {/* ── Remboursement ───────────────────────────────────────────────── */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Rembourser la note">
        <div className="space-y-4">
          <p className="text-sm text-ink2">
            <strong className="num text-ink">{fullXof(report.totalTTC)}</strong> à verser à{" "}
            {beneficiary}.
          </p>

          <FormField label="Compte qui règle" required
            hint="Sans compte désigné, le remboursement n'apparaîtrait sur aucun solde.">
            {accounts.length === 0 ? (
              <p className="text-xs text-warn px-3 py-2 rounded-lg bg-warn-50">
                Aucun compte de trésorerie.{" "}
                <Link href="/treasury" className="underline">En créer un</Link> avant de rembourser.
              </p>
            ) : (
              <select className={selectCls} value={accountId}
                onChange={e => setAccountId(e.target.value)}>
                <option value="">— Choisir —</option>
                {accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
              </select>
            )}
          </FormField>

          <p className="text-xs text-ink3">
            Le remboursement passe l&apos;écriture de règlement et crée le mouvement de
            trésorerie. La note devient définitive&nbsp;: une correction ultérieure
            passera par une note corrective, pas par une modification.
          </p>

          <div className="flex justify-end gap-3 pt-3 border-t border-line">
            <button onClick={() => setPayOpen(false)}
              className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
              Annuler
            </button>
            <button
              disabled={busy || !accountId}
              onClick={async () => {
                const done = await patch({ status: "reimbursed", treasuryAccountId: accountId });
                if (done) { setPayOpen(false); router.refresh(); }
              }}
              className="px-5 h-10 rounded-lg bg-pos text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
              Enregistrer le remboursement
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
