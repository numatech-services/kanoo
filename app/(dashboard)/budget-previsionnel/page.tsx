"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Target, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { BarChart } from "@/components/ui/charts/BarChart";
import { Pill, Inset, EmptyState, MiniBar } from "@/components/ui/Primitives";
import { Modal } from "@/components/ui/Modal";
import { fullXof, compactXof } from "@/components/ui/charts/geometry";
import {
  VERDICT_LABEL, isFavourable, TOLERANCE_PERCENT,
  type LineVerdict, type BudgetLine, type LineResult,
} from "@/lib/budget";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
interface Profile { label: string; weights: number[] }

interface Payload {
  budget: { _id: string; year: number; label: string; status: string } | null;
  year: number;
  throughMonth?: number;
  results?: Array<LineResult & { _id: string }>;
  summary?: {
    revenueBudget: number; revenueActual: number;
    expenseBudget: number; expenseActual: number;
    plannedResult: number; actualResult: number; projectedResult: number | null;
    linesOverBudget: number; linesExhausted: number; offBudgetAmount: number;
  };
  headline?: string;
  profiles: Record<string, Profile>;
  months: string[];
}

const VERDICT_TONE = (result: LineResult): "pos" | "neg" | "mute" | "warn" => {
  const favourable = isFavourable(result);
  if (favourable === null) return "mute";
  if (result.verdict === "exhausted") return "warn";
  return favourable ? "pos" : "neg";
};

async function csrf() {
  const csrfToken = await getCsrfToken();
  return csrfToken as string;
}

export default function BudgetPrevisionnelPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<"" | "in" | "out">("");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/budget-previsionnel?year=${year}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Budget indisponible."}
    </p>;
  }

  const { budget, results = [], summary, months, profiles, throughMonth = -1 } = data;
  const closedMonth = throughMonth >= 0 ? months[throughMonth] : null;

  const revenues = results.filter(r => r.line.nature === "revenue");
  const expenses = results.filter(r => r.line.nature === "expense");

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Budget prévisionnel</h1>
          <p className="text-sm text-ink2">
            Le réalisé se compare à la part du budget correspondant au temps écoulé —
            pas au budget annuel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-10 px-3 rounded-lg border border-line2 bg-surface text-sm text-ink">
            {[year + 1, year, year - 1, year - 2].filter((v, i, a) => a.indexOf(v) === i)
              .sort((a, b) => b - a)
              .map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {budget && (
            <>
              <button onClick={() => setEditOpen(true)} className="px-4 h-10 rounded-lg border border-line2 text-sm font-semibold hover:bg-surface2">Réviser</button>
              <button onClick={async () => {
                if (!(await confirmDialog({ title: `Supprimer le budget ${year} ?`, message: `Le réalisé comptable n'est pas touché.`, danger: true }))) return;
                const res = await fetch(`/api/budget-previsionnel?year=${year}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
                if (res.ok) load(); else setError("Suppression impossible");
              }} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50" title="Supprimer le budget"><Trash2 size={15} /></button>
            </>
          )}
          {!budget && (
            <button onClick={() => setCreateOpen(true)}
              className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
              <Plus size={16} /> Établir le budget {year}
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {!budget ? (
        <EmptyState
          icon={<Target size={20} />}
          title={`Aucun budget pour ${year}`}
          hint="Chaque ligne se rattache à un compte comptable : le réalisé vient des écritures, pas d'un comptage parallèle qui finirait par diverger."
        />
      ) : throughMonth < 0 ? (
        <Inset tone="info">
          Aucun mois n&apos;est encore clos sur {year}. La comparaison commencera au
          premier mois terminé — confronter trois semaines de réalisé à un mois entier
          de budget ferait paraître chaque ligne en avance sur ses dépenses.
        </Inset>
      ) : (
        <>
          {data.headline && (
            <p className={`px-4 py-3 rounded-xl text-sm border ${
              (summary?.actualResult ?? 0) >= (summary?.plannedResult ?? 0)
                ? "bg-pos-50 border-pos/25 text-pos"
                : "bg-warn-50 border-warn/25 text-warn"
            }`}>
              {data.headline}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label={`Produits à fin ${closedMonth}`}
              value={summary?.revenueActual ?? 0} format={fullXof}
              icon={<TrendingUp size={17} />} tone="revenue"
              hint={`${fullXof(summary?.revenueBudget ?? 0)} prévus sur la période`} />
            <KpiCard label={`Charges à fin ${closedMonth}`}
              value={summary?.expenseActual ?? 0} format={fullXof}
              icon={<TrendingDown size={17} />} tone="pending" goodDirection="down"
              hint={`${fullXof(summary?.expenseBudget ?? 0)} prévues sur la période`} />
            <KpiCard label="Résultat constaté"
              value={summary?.actualResult ?? 0} format={fullXof}
              tone={(summary?.actualResult ?? 0) >= 0 ? "margin" : "neg"}
              hint={`${fullXof(summary?.plannedResult ?? 0)} prévus`} />
            <KpiCard label="Projection fin d'exercice"
              value={summary?.projectedResult ?? "—"}
              format={summary?.projectedResult !== null ? fullXof : undefined}
              tone="parties"
              hint="Au rythme constaté — hypothèse fragile, mais explicite" />
          </div>

          {(summary?.linesOverBudget ?? 0) > 0 && (
            <Inset tone="warn">
              {summary!.linesOverBudget} poste(s) au-delà de leur prorata, au-delà du
              seuil de tolérance de {TOLERANCE_PERCENT}&nbsp;%. Un écart plus faible est
              du bruit&nbsp;: l&apos;annoncer chaque mois apprend à ignorer les alertes.
            </Inset>
          )}
          {(summary?.offBudgetAmount ?? 0) > 0 && (
            <Inset tone="info">
              {fullXof(summary!.offBudgetAmount)} enregistrés sur des comptes sans ligne
              budgétaire. Ce n&apos;est pas une faute&nbsp;: c&apos;est un poste qui
              n&apos;avait pas été prévu, et qu&apos;il faut soit ajouter, soit expliquer.
            </Inset>
          )}

          {results.length > 0 && (
            <section className="surface-card p-5">
              <h2 className="font-semibold text-ink">Réalisé contre prévu, mois par mois</h2>
              <p className="text-xs text-ink2 mt-0.5 mb-4">
                Les mois non clos restent vides : ils n&apos;ont rien à dire encore.
              </p>
              <BarChart
                labels={months.map(m => m.slice(0, 3))}
                series={[
                  {
                    label: "Charges prévues",
                    values: months.map((_, i) =>
                      expenses.reduce((s, r) => s + (r.monthly.budget[i] ?? 0), 0)),
                    color: "rgb(var(--c-line2))",
                  },
                  {
                    label: "Charges réalisées",
                    values: months.map((_, i) =>
                      i <= throughMonth
                        ? expenses.reduce((s, r) => s + (r.monthly.actual[i] ?? 0), 0)
                        : 0),
                    color: "rgb(var(--k-3))",
                  },
                ]}
                formatValue={compactXof}
                height={220}
              />
            </section>
          )}

          <SegmentedControl ariaLabel="Recettes ou dépenses" value={flow} onChange={setFlow}
            segments={[{ value: "", label: "Tout" }, { value: "in", label: "Recettes", count: revenues.length }, { value: "out", label: "Dépenses", count: expenses.length }]} />
          {([["Produits", revenues, "in"], ["Charges", expenses, "out"]] as const).filter(([, , k]) => !flow || flow === k).map(([title, rows]) => {
            const list = rows as Array<LineResult & { _id: string }>;
            if (list.length === 0) return null;
            return (
              <section key={String(title)} className="surface-card overflow-hidden">
                <div className="p-5 pb-3">
                  <h2 className="font-semibold text-ink">{String(title)}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table-dense min-w-[58rem]">
                    <thead>
                      <tr>
                        <th>Poste</th><th>Compte</th>
                        <th className="text-right">Prévu à fin {closedMonth}</th>
                        <th className="text-right">Réalisé</th>
                        <th className="text-right">Écart</th>
                        <th>Consommation</th>
                        <th className="text-right">Projection</th>
                        <th>État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(result => (
                        <tr key={result._id}>
                          <td className="text-ink">{result.line.label}</td>
                          <td className="font-mono text-xs text-ink3">{result.line.accountPrefix}</td>
                          <td className="num text-right text-ink2">{fullXof(result.budgetToDate)}</td>
                          <td className="num text-right text-ink font-medium">{fullXof(result.actualToDate)}</td>
                          <td className={`num text-right font-medium ${
                            isFavourable(result) === false ? "text-neg"
                              : isFavourable(result) === true ? "text-pos" : "text-ink3"
                          }`}>
                            {result.variance > 0 ? "+" : ""}{fullXof(result.variance)}
                            {result.variancePercent !== null && (
                              <span className="block text-[11px] font-normal">
                                {result.variancePercent > 0 ? "+" : ""}{result.variancePercent} %
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="flex items-center gap-2">
                              <MiniBar
                                value={Math.abs(result.actualToDate)}
                                max={Math.abs(result.line.annualAmount) || 1}
                                tone={result.line.nature === "revenue" ? "revenue" : "pending"} />
                              <span className="num text-[11px] text-ink3">
                                {result.consumedPercent !== null ? `${result.consumedPercent} %` : "—"}
                              </span>
                            </span>
                            <span className="block text-[11px] text-ink3 mt-0.5">
                              sur {fullXof(result.line.annualAmount)}
                            </span>
                          </td>
                          <td className="num text-right text-ink2">
                            {result.projection !== null ? fullXof(result.projection) : "—"}
                          </td>
                          <td>
                            <Pill tone={VERDICT_TONE(result)}>
                              {VERDICT_LABEL[result.verdict as LineVerdict]}
                            </Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)}
        year={year} profiles={profiles} onCreated={() => { setCreateOpen(false); load(); }} />
      {editOpen && (
        <CreateDialog open onClose={() => setEditOpen(false)} year={year} profiles={profiles} edit
          initial={results.map(r => {
            const w = r.line.monthlyWeights;
            const profile = !w ? "even" : Object.entries(profiles).find(([, p]) => JSON.stringify(p.weights) === JSON.stringify(w))?.[0] ?? "custom";
            return { accountPrefix: r.line.accountPrefix, label: r.line.label, nature: r.line.nature, annualAmount: r.line.annualAmount, profile, weights: w, spread: r.line.spread } as DraftLine;
          })}
          onCreated={() => { setEditOpen(false); load(); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface DraftLine extends Omit<BudgetLine, "monthlyWeights"> {
  profile: string;
  /** Répartition personnalisée conservée lors d'une révision. */
  weights?: number[];
}

const SUGGESTED: DraftLine[] = [
  { accountPrefix: "70", label: "Ventes et prestations", nature: "revenue", annualAmount: 0, profile: "even" },
  { accountPrefix: "60", label: "Achats", nature: "expense", annualAmount: 0, profile: "even" },
  { accountPrefix: "61", label: "Transports", nature: "expense", annualAmount: 0, profile: "even" },
  { accountPrefix: "62", label: "Services extérieurs", nature: "expense", annualAmount: 0, profile: "even" },
  { accountPrefix: "64", label: "Impôts et taxes", nature: "expense", annualAmount: 0, profile: "even" },
  { accountPrefix: "66", label: "Charges de personnel", nature: "expense", annualAmount: 0, profile: "even" },
];

function CreateDialog({
  open, onClose, year, profiles, onCreated, edit = false, initial,
}: {
  open: boolean; onClose: () => void; year: number;
  profiles: Record<string, Profile>; onCreated: () => void; edit?: boolean; initial?: DraftLine[];
}) {
  const [lines, setLines] = useState<DraftLine[]>(initial ?? SUGGESTED);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(index: number, patch: Partial<DraftLine>) {
    setLines(ls => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/budget-previsionnel", {
        method: edit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({
          year,
          label: `Budget ${year}`,
          lines: lines
            .filter(l => l.annualAmount !== 0)
            .map(l => ({
              accountPrefix: l.accountPrefix,
              label: l.label,
              nature: l.nature,
              annualAmount: l.annualAmount,
              monthlyWeights: l.profile === "custom" ? l.weights : l.profile !== "even" ? profiles[l.profile]?.weights : undefined,
            })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création refusée");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  const totalRevenue = lines.filter(l => l.nature === "revenue").reduce((s, l) => s + l.annualAmount, 0);
  const totalExpense = lines.filter(l => l.nature === "expense").reduce((s, l) => s + l.annualAmount, 0);

  return (
    <Modal open={open} onClose={onClose} title={`Budget ${year}`} size="xl">
      <form onSubmit={submit} className="space-y-4">
        <Inset tone="info">
          Chaque ligne se rattache à un compte SYSCOHADA — « 60 » attrape tous les
          achats, « 6061 » le seul carburant. Le réalisé viendra des écritures
          comptables&nbsp;: un budget rapproché d&apos;un autre total que celui du grand
          livre finit toujours par diverger.
        </Inset>

        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="table-dense">
            <thead>
              <tr><th>Compte</th><th>Poste</th><th>Nature</th>
                <th className="text-right">Montant annuel</th><th>Répartition</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <input value={line.accountPrefix}
                      onChange={e => update(index, { accountPrefix: e.target.value })}
                      className="w-20 h-8 px-2 rounded border border-line2 bg-surface text-xs font-mono" />
                  </td>
                  <td>
                    <input value={line.label}
                      onChange={e => update(index, { label: e.target.value })}
                      className="w-full min-w-[10rem] h-8 px-2 rounded border border-line2 bg-surface text-xs" />
                  </td>
                  <td>
                    <select value={line.nature}
                      onChange={e => update(index, { nature: e.target.value as BudgetLine["nature"] })}
                      className="h-8 px-2 rounded border border-line2 bg-surface text-xs">
                      <option value="expense">Charge</option>
                      <option value="revenue">Produit</option>
                    </select>
                  </td>
                  <td className="text-right">
                    <input type="number" min={0} value={line.annualAmount}
                      onChange={e => update(index, { annualAmount: Number(e.target.value) })}
                      className="w-32 h-8 px-2 rounded border border-line2 bg-surface text-xs text-right num" />
                  </td>
                  <td>
                    <select value={line.profile}
                      onChange={e => update(index, { profile: e.target.value })}
                      className="h-8 px-2 rounded border border-line2 bg-surface text-xs max-w-[12rem]">
                      {Object.entries(profiles).map(([key, p]) => (
                        <option key={key} value={key}>{p.label}</option>
                      ))}
                      {line.weights && <option value="custom">Répartition actuelle</option>}
                    </select>
                  </td>
                  <td>
                    <button type="button" onClick={() => setLines(ls => ls.filter((_, i) => i !== index))}
                      className="p-1.5 rounded-lg text-ink3 hover:text-neg hover:bg-neg-50">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button"
          onClick={() => setLines(ls => [...ls, { accountPrefix: "", label: "", nature: "expense", annualAmount: 0, profile: "even" }])}
          className="px-3 h-9 inline-flex items-center gap-1.5 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
          <Plus size={14} /> Ajouter un poste
        </button>

        <div className="grid sm:grid-cols-3 gap-3 text-sm pt-3 border-t border-line">
          <div><span className="text-ink2">Produits</span>
            <p className="num font-bold text-ink">{fullXof(totalRevenue)}</p></div>
          <div><span className="text-ink2">Charges</span>
            <p className="num font-bold text-ink">{fullXof(totalExpense)}</p></div>
          <div><span className="text-ink2">Résultat prévu</span>
            <p className={`num font-bold ${totalRevenue - totalExpense >= 0 ? "text-pos" : "text-neg"}`}>
              {fullXof(totalRevenue - totalExpense)}
            </p></div>
        </div>

        <p className="text-xs text-ink2">
          La répartition compte autant que le montant&nbsp;: une entreprise de BTP ne
          facture pas en août comme en novembre, et un budget en douzièmes égaux produit
          une alerte tous les mois creux et un faux calme tous les mois pleins.
        </p>

        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button type="button" onClick={onClose}
            className={buttonClass("secondary", "md")}>
            Annuler
          </button>
          <button type="submit" disabled={saving || lines.every(l => l.annualAmount === 0)}
            className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Enregistrement…" : edit ? `Enregistrer la révision ${year}` : `Établir le budget ${year}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
