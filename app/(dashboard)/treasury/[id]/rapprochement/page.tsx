"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload, Link2, Unlink, EyeOff, CheckCircle2 } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { fullXof } from "@/components/ui/charts/geometry";

interface Movement {
  _id: string; date: string; amount: number; label: string;
  reference?: string; statementLineId?: string; source?: string;
}
interface StatementLine {
  _id: string; date: string; amount: number; label: string;
  reference?: string; movementId?: string; ignoredAt?: string; ignoreReason?: string;
}
interface Suggestion {
  movementId: string; lineId: string; score: number; reasons: string[];
}
interface Payload {
  account: { _id: string; label: string; type: string };
  asOf: string;
  summary: {
    openingBalance: number; bookBalance: number; bankBalance: number; gap: number;
    movementsTotal: number; movementsReconciled: number; movementsPending: number; pendingAmount: number;
    linesTotal: number; linesReconciled: number; linesPending: number; unexplainedAmount: number;
  };
  suggestions: Suggestion[];
  movements: Movement[];
  lines: StatementLine[];
}

const day = (d: string) => new Date(d).toLocaleDateString("fr-FR");

export default function RapprochementPage() {
  const { id } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/treasury-accounts/${id}/reconciliation`, { credentials: "include" })
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

  async function act(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/treasury-accounts/${id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Action refusée");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return (
      <div className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
        {error || "Compte introuvable."}
      </div>
    );
  }

  const { summary, suggestions, movements, lines, account } = data;
  const reconciled = summary.gap === 0 && summary.movementsPending === 0 && summary.linesPending === 0;

  const movementById = new Map(movements.map(m => [m._id, m]));
  const lineById = new Map(lines.map(l => [l._id, l]));

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <Link href="/treasury" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Trésorerie
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">Rapprochement — {account.label}</h1>
          <p className="text-sm text-ink2">
            Ce que Kanoo a enregistré, face à ce que la banque déclare. L&apos;écart est l&apos;information utile.
          </p>
        </div>
        <button onClick={() => setImportOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Upload size={16} /> Importer un relevé
        </button>
      </div>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Solde comptable" value={summary.bookBalance} format={fullXof}
          hint="Ouverture + mouvements Kanoo" />
        <KpiCard label="Solde bancaire" value={summary.bankBalance} format={fullXof} tone="info"
          hint="Ouverture + lignes de relevé" />
        <KpiCard label="Écart" value={summary.gap} format={fullXof}
          tone={summary.gap === 0 ? "pos" : "neg"}
          hint={summary.gap === 0 ? "Comptes concordants" : "À justifier ligne par ligne"} />
        <KpiCard label="À rapprocher"
          value={summary.movementsPending + summary.linesPending}
          tone={summary.movementsPending + summary.linesPending === 0 ? "pos" : "warn"}
          hint={`${summary.movementsPending} mouvement(s), ${summary.linesPending} ligne(s)`} />
      </div>

      {reconciled && summary.linesTotal > 0 && (
        <p className="px-4 py-3 rounded-xl bg-pos-50 border border-pos/25 text-sm text-pos flex items-center gap-2">
          <CheckCircle2 size={16} />
          Compte rapproché : chaque mouvement a sa ligne de relevé, et réciproquement.
        </p>
      )}

      {summary.linesTotal === 0 && (
        <p className="px-4 py-3 rounded-xl bg-info-50 border border-info/25 text-sm text-info">
          Aucun relevé importé pour ce compte. Le solde bancaire affiché est donc le
          solde d&apos;ouverture — il ne dit rien de la réalité tant qu&apos;un relevé n&apos;a pas été chargé.
        </p>
      )}

      {/* ── Propositions ─────────────────────────────────────────────── */}
      {suggestions.length > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink">{suggestions.length} appariement(s) proposé(s)</h2>
            <p className="text-xs text-ink2 mt-0.5">
              Montant identique et date proche. Chaque proposition reste à valider&nbsp;:
              rien n&apos;est rapproché automatiquement.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[52rem]">
              <thead>
                <tr>
                  <th>Mouvement Kanoo</th><th>Ligne de relevé</th>
                  <th>Montant</th><th>Indices</th><th></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map(s => {
                  const m = movementById.get(s.movementId);
                  const l = lineById.get(s.lineId);
                  if (!m || !l) return null;
                  const key = `${s.movementId}-${s.lineId}`;
                  return (
                    <tr key={key}>
                      <td>
                        <p className="text-ink">{m.label}</p>
                        <p className="text-[11px] text-ink3">{day(m.date)}</p>
                      </td>
                      <td>
                        <p className="text-ink2">{l.label}</p>
                        <p className="text-[11px] text-ink3">{day(l.date)}</p>
                      </td>
                      <td className={`num font-semibold ${m.amount >= 0 ? "text-pos" : "text-neg"}`}>
                        {fullXof(m.amount)}
                      </td>
                      <td className="text-[11px] text-ink2">
                        {s.reasons.join(" · ")}
                        <span className="ml-1 num text-ink3">({s.score})</span>
                      </td>
                      <td>
                        <button
                          disabled={busy === key}
                          onClick={() => act({ action: "match", movementId: s.movementId, lineId: s.lineId }, key)}
                          className="px-2.5 py-1 rounded bg-section text-white text-xs font-medium hover:brightness-95 disabled:opacity-50 inline-flex items-center gap-1">
                          <Link2 size={12} /> Rapprocher
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Les deux colonnes ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink">Mouvements sans ligne de relevé</h2>
            <p className="text-xs text-ink2 mt-0.5">
              Enregistrés chez vous, pas encore vus par la banque. Total&nbsp;:{" "}
              <span className="num font-semibold">{fullXof(summary.pendingAmount)}</span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead>
              <tbody>
                {movements.filter(m => !m.statementLineId).length === 0 && (
                  <tr><td colSpan={3} className="py-8 text-center text-ink3">Aucun</td></tr>
                )}
                {movements.filter(m => !m.statementLineId).map(m => (
                  <tr key={m._id}>
                    <td className="text-ink2 whitespace-nowrap">{day(m.date)}</td>
                    <td className="text-ink">{m.label}</td>
                    <td className={`num text-right ${m.amount >= 0 ? "text-pos" : "text-neg"}`}>
                      {fullXof(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink">Lignes de relevé inexpliquées</h2>
            <p className="text-xs text-ink2 mt-0.5">
              La banque les a passées, rien ne les explique chez vous. Total&nbsp;:{" "}
              <span className="num font-semibold">{fullXof(summary.unexplainedAmount)}</span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th><th></th></tr></thead>
              <tbody>
                {lines.filter(l => !l.movementId && !l.ignoredAt).length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-ink3">Aucune</td></tr>
                )}
                {lines.filter(l => !l.movementId && !l.ignoredAt).map(l => (
                  <tr key={l._id}>
                    <td className="text-ink2 whitespace-nowrap">{day(l.date)}</td>
                    <td className="text-ink">{l.label}</td>
                    <td className={`num text-right ${l.amount >= 0 ? "text-pos" : "text-neg"}`}>
                      {fullXof(l.amount)}
                    </td>
                    <td>
                      <button
                        disabled={busy === l._id}
                        onClick={() => {
                          const reason = window.prompt(
                            "Pourquoi écarter cette ligne du rapprochement ?\n"
                            + "Sans motif, l'écart resterait inexpliqué."
                          );
                          if (reason?.trim()) act({ action: "ignore", lineId: l._id, reason }, l._id);
                        }}
                        title="Écarter du rapprochement"
                        className="p-1 rounded text-ink3 hover:text-warn hover:bg-warn-50 disabled:opacity-50">
                        <EyeOff size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── Déjà rapprochés ──────────────────────────────────────────── */}
      {summary.movementsReconciled > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink">
              {summary.movementsReconciled} opération(s) rapprochée(s)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th><th></th></tr></thead>
              <tbody>
                {movements.filter(m => m.statementLineId).map(m => (
                  <tr key={m._id}>
                    <td className="text-ink2 whitespace-nowrap">{day(m.date)}</td>
                    <td className="text-ink2">{m.label}</td>
                    <td className="num text-right text-ink2">{fullXof(m.amount)}</td>
                    <td>
                      <button
                        disabled={busy === m._id}
                        onClick={() => act({ action: "unmatch", movementId: m._id }, m._id)}
                        title="Dissocier"
                        className="p-1 rounded text-ink3 hover:text-neg hover:bg-neg-50 disabled:opacity-50">
                        <Unlink size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)}
        accountId={String(id)} onImported={load} />
    </div>
  );
}

/**
 * Import d'un relevé CSV.
 *
 * Les colonnes sont désignées par l'utilisateur, jamais devinées : les banques
 * n'exportent pas deux fichiers pareils, et une détection qui se trompe importe
 * des montants faux sans le dire.
 */
function ImportDialog({
  open, onClose, accountId, onImported,
}: { open: boolean; onClose: () => void; accountId: string; onImported: () => void }) {
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<string[][]>([]);
  const [separator, setSeparator] = useState(";");
  const [skipRows, setSkipRows] = useState(1);
  const [mode, setMode] = useState<"single" | "split">("split");
  const [cols, setCols] = useState({ date: 0, label: 1, amount: 2, debit: 2, credit: 3, reference: -1 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setContent(text);
      setPreview(
        text.split(/\r?\n/).slice(0, 4).filter(Boolean).map(r => r.split(separator))
      );
      setResult(null);
    };
    reader.readAsText(file, "utf-8");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const mapping: Record<string, unknown> = {
        separator, skipRows, date: cols.date, label: cols.label,
        ...(cols.reference >= 0 ? { reference: cols.reference } : {}),
        ...(mode === "single" ? { amount: cols.amount } : { debit: cols.debit, credit: cols.credit }),
      };
      const res = await fetch(`/api/treasury-accounts/${accountId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ content, mapping }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Import refusé");

      const rejected = d.data.rejected as Array<{ row: number; reason: string }>;
      setResult({
        kind: "ok",
        text: rejected.length > 0
          ? `${d.data.message} ${rejected.length} ligne(s) écartée(s) : ${rejected.slice(0, 3).map(r => `ligne ${r.row} (${r.reason})`).join(", ")}.`
          : d.data.message,
      });
      onImported();
    } catch (err) {
      setResult({ kind: "err", text: err instanceof Error ? err.message : "Import impossible" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Importer un relevé bancaire" size="xl">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Fichier CSV" required
          hint="Export de votre banque. Le fichier est lu dans le navigateur et envoyé tel quel.">
          <input type="file" accept=".csv,text/csv,text/plain" className={inputCls}
            onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
        </FormField>

        {preview.length > 0 && (
          <>
            <div className="border border-line rounded-lg overflow-x-auto">
              <table className="table-dense">
                <thead>
                  <tr>{preview[0]?.map((_, i) => <th key={i}>Col. {i}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => (
                      <td key={j} className="text-ink2 whitespace-nowrap max-w-[12rem] truncate">{cell}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid sm:grid-cols-4 gap-3">
              <FormField label="Séparateur">
                <select className={selectCls} value={separator}
                  onChange={e => {
                    setSeparator(e.target.value);
                    setPreview(content.split(/\r?\n/).slice(0, 4).filter(Boolean).map(r => r.split(e.target.value)));
                  }}>
                  <option value=";">point-virgule</option>
                  <option value=",">virgule</option>
                  <option value={"\t"}>tabulation</option>
                </select>
              </FormField>
              <FormField label="Lignes d'en-tête">
                <input type="number" min={0} className={inputCls} value={skipRows}
                  onChange={e => setSkipRows(Number(e.target.value))} />
              </FormField>
              <FormField label="Colonne date">
                <input type="number" min={0} className={inputCls} value={cols.date}
                  onChange={e => setCols(c => ({ ...c, date: Number(e.target.value) }))} />
              </FormField>
              <FormField label="Colonne libellé">
                <input type="number" min={0} className={inputCls} value={cols.label}
                  onChange={e => setCols(c => ({ ...c, label: Number(e.target.value) }))} />
              </FormField>
            </div>

            <FormField label="Montants"
              hint="Une colonne signée, ou deux colonnes séparées débit et crédit.">
              <select className={selectCls} value={mode}
                onChange={e => setMode(e.target.value as "single" | "split")}>
                <option value="split">Deux colonnes : débit et crédit</option>
                <option value="single">Une colonne de montant signé</option>
              </select>
            </FormField>

            <div className="grid sm:grid-cols-3 gap-3">
              {mode === "single" ? (
                <FormField label="Colonne montant">
                  <input type="number" min={0} className={inputCls} value={cols.amount}
                    onChange={e => setCols(c => ({ ...c, amount: Number(e.target.value) }))} />
                </FormField>
              ) : (
                <>
                  <FormField label="Colonne débit">
                    <input type="number" min={0} className={inputCls} value={cols.debit}
                      onChange={e => setCols(c => ({ ...c, debit: Number(e.target.value) }))} />
                  </FormField>
                  <FormField label="Colonne crédit">
                    <input type="number" min={0} className={inputCls} value={cols.credit}
                      onChange={e => setCols(c => ({ ...c, credit: Number(e.target.value) }))} />
                  </FormField>
                </>
              )}
              <FormField label="Colonne référence" hint="−1 si absente">
                <input type="number" min={-1} className={inputCls} value={cols.reference}
                  onChange={e => setCols(c => ({ ...c, reference: Number(e.target.value) }))} />
              </FormField>
            </div>
          </>
        )}

        {result && (
          <p className={`px-3 py-2 rounded-lg text-sm border ${
            result.kind === "ok" ? "bg-pos-50 border-pos/25 text-pos" : "bg-neg-50 border-neg/25 text-neg"
          }`}>
            {result.text}
          </p>
        )}

        <p className="text-xs text-ink2">
          Réimporter un relevé déjà chargé ne crée pas de doublon&nbsp;: chaque ligne
          porte une empreinte. Un fichier qui recouvre partiellement le précédent
          n&apos;ajoute que ce qui manque.
        </p>

        <div className="flex justify-end gap-3 pt-2 border-t border-line">
          <button type="button" onClick={onClose}
            className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            Fermer
          </button>
          <button type="submit" disabled={busy || !content}
            className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {busy ? "Import…" : "Importer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
