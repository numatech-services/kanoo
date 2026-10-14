"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, EyeOff, CheckCircle2, RefreshCw, AlertTriangle, XCircle, Search,
} from "lucide-react";
import { Pill, Inset, EmptyState } from "@/components/ui/Primitives";
import { confirmDialog } from "@/components/ui/Dialogs";
import { fullXof } from "@/components/ui/charts/geometry";
import { COUNT_STATUS_LABEL, type CountStatus } from "@/lib/inventory";

import { apiJson, apiSend } from "@/lib/api-client";
interface Line {
  _id: string;
  code: string;
  label: string;
  unit?: string;
  theoreticalQty: number | null;
  countedQty: number | null;
  recountQty: number | null;
  unitCost: number | null;
  variance: number | null;
  varianceValue: number | null;
  needsRecount: boolean;
  needsReason: boolean;
  counted: boolean;
  reason?: string;
}

interface Payload {
  session: { _id: string; reference: string; label: string; status: CountStatus; blind: boolean; location?: string };
  lines: Line[];
  summary: {
    lines: number; counted: number; pending: number; withVariance: number;
    needingRecount: number; needingReason: number;
    shortageValue: number; surplusValue: number; netValue: number;
    unvaluedLines: number; accuracy: number | null;
  };
  blockers: Array<{ code: string; message: string }>;
  topVariances: Array<{ line: Line; result: { variance: number; varianceValue: number | null } }>;
}


export default function InventaireDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(() => {
    apiJson(`/api/inventaires/${id}`)
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, reload = true) {
    setError(null);
    try {
      const res = await apiSend("PATCH", `/api/inventaires/${id}`, body);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Action refusée");
      if (d.data?.message) setNotice(d.data.message);
      if (reload) load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
      return false;
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Inventaire introuvable."}
    </p>;
  }

  const { session, lines, summary, blockers, topVariances } = data;
  const counting = session.status === "counting";
  const review = session.status === "review";
  const done = session.status === "validated" || session.status === "cancelled";

  const shown = lines.filter(line => {
    if (onlyPending && line.counted) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return line.code.toLowerCase().includes(q) || line.label.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <Link href="/inventaires" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Inventaires
          </Link>
          <h1 className="page-title mt-1">{session.label}</h1>
          <p className="text-sm text-ink2 flex items-center gap-2">
            <span className="font-mono text-xs">{session.reference}</span>
            <Pill tone={session.status === "validated" ? "pos" : counting ? "info" : "warn"}>
              {COUNT_STATUS_LABEL[session.status]}
            </Pill>
            {session.blind && counting && (
              <Pill tone="info" icon={<EyeOff size={11} />}>Comptage aveugle</Pill>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counting && (
            <button onClick={() => patch({ status: "review" })}
              disabled={summary.pending > 0}
              title={summary.pending > 0 ? `${summary.pending} ligne(s) non relevée(s)` : undefined}
              className="px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
              Terminer le comptage
            </button>
          )}
          {review && (
            <>
              <button onClick={() => patch({ status: "counting" })}
                className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
                Reprendre le comptage
              </button>
              <button onClick={() => patch({ status: "validated" })}
                disabled={blockers.length > 0}
                title={blockers[0]?.message}
                className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-pos text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
                <CheckCircle2 size={15} /> Valider et régulariser
              </button>
            </>
          )}
          {!done && (
            <button
              onClick={async () => {
                if (await confirmDialog({ title: "Annuler cet inventaire ?", message: "Aucun stock ne sera modifié.", danger: true, confirmLabel: "Annuler l'inventaire", cancelLabel: "Garder" })) {
                  patch({ status: "cancelled" }).then(() => router.push("/inventaires"));
                }
              }}
              className="px-3 h-10 rounded-lg border border-neg/40 text-neg text-sm hover:bg-neg-50">
              <XCircle size={15} />
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {/* Avancement — chiffré même en aveugle : il ne révèle aucune quantité
          ligne à ligne, et le responsable a besoin de savoir où il en est. */}
      <div className="strip" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <div>
          <p className="text-xs text-ink2">Avancement</p>
          <p className="text-xl font-bold text-ink num mt-0.5">
            {summary.counted} / {summary.lines}
          </p>
          <p className="text-[11px] text-ink3">{summary.pending} restant(s)</p>
        </div>
        <div>
          <p className="text-xs text-ink2">Écarts constatés</p>
          <p className="text-xl font-bold text-ink num mt-0.5">
            {counting && session.blind ? "—" : summary.withVariance}
          </p>
          {!(counting && session.blind) && summary.accuracy !== null && (
            <p className="text-[11px] text-ink3">{summary.accuracy} % d&apos;articles justes</p>
          )}
        </div>
        <div>
          <p className="text-xs text-ink2">Manquants</p>
          <p className="text-xl font-bold text-neg num mt-0.5">
            {counting && session.blind ? "—" : fullXof(summary.shortageValue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink2">Excédents</p>
          <p className="text-xl font-bold text-pos num mt-0.5">
            {counting && session.blind ? "—" : fullXof(summary.surplusValue)}
          </p>
          <p className="text-[11px] text-ink3">Ne compensent pas les manquants</p>
        </div>
      </div>

      {blockers.length > 0 && review && (
        <div className="space-y-2">
          {blockers.map(b => <Inset key={b.code} tone="warn">{b.message}</Inset>)}
        </div>
      )}

      {summary.unvaluedLines > 0 && !counting && (
        <Inset tone="info">
          {summary.unvaluedLines} article(s) sans historique d&apos;achat valorisé&nbsp;:
          leur écart est compté en quantité mais reste hors de l&apos;écriture comptable.
          Écrire un montant deviné serait pire que ne rien écrire.
        </Inset>
      )}

      {topVariances.length > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink">Les écarts les plus lourds</h2>
            <p className="text-xs text-ink2 mt-0.5">C&apos;est par là que commence l&apos;enquête.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Article</th><th className="text-right">Écart</th><th className="text-right">Valeur</th></tr></thead>
              <tbody>
                {topVariances.map(({ line, result }) => (
                  <tr key={line._id}>
                    <td className="text-ink">{line.code} — {line.label}</td>
                    <td className={`num text-right ${result.variance < 0 ? "text-neg" : "text-pos"}`}>
                      {result.variance > 0 ? "+" : ""}{result.variance}
                    </td>
                    <td className={`num text-right ${(result.varianceValue ?? 0) < 0 ? "text-neg" : "text-pos"}`}>
                      {result.varianceValue !== null ? fullXof(result.varianceValue) : "non valorisé"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Code ou libellé…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-line2 bg-surface text-sm text-ink" />
        </div>
        <button type="button" aria-pressed={onlyPending} className="fchip"
          onClick={() => setOnlyPending(v => !v)}>
          Non comptés
          <span className="fchip-count num">{summary.pending}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Aucun article ne correspond"
          hint="Modifiez la recherche, ou décochez le filtre." />
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[58rem]">
              <thead>
                <tr>
                  <th>Code</th><th>Article</th>
                  {!(counting && session.blind) && <th className="text-right">Théorique</th>}
                  <th className="text-right">Compté</th>
                  {!(counting && session.blind) && <th className="text-right">Écart</th>}
                  {!(counting && session.blind) && <th className="text-right">Valeur</th>}
                  <th>Motif</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(line => (
                  <tr key={line._id} className={line.needsRecount ? "bg-warn-50/40" : ""}>
                    <td className="font-mono text-xs text-ink2">{line.code}</td>
                    <td className="text-ink">
                      {line.label}
                      {line.unit && <span className="text-[11px] text-ink3 ml-1">({line.unit})</span>}
                      {line.needsRecount && (
                        <span className="block text-[11px] text-warn flex items-center gap-1 mt-0.5">
                          <RefreshCw size={10} /> Écart important — à recompter
                        </span>
                      )}
                    </td>

                    {!(counting && session.blind) && (
                      <td className="num text-right text-ink2">{line.theoreticalQty ?? "—"}</td>
                    )}

                    <td className="text-right">
                      {done ? (
                        <span className="num text-ink font-medium">
                          {line.recountQty ?? line.countedQty ?? "—"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number" min={0} inputMode="numeric"
                            defaultValue={line.countedQty ?? ""}
                            onBlur={e => {
                              const value = e.target.value === "" ? null : Number(e.target.value);
                              if (value !== line.countedQty) patch({ lineId: line._id, countedQty: value });
                            }}
                            className="w-24 h-8 px-2 rounded border border-line2 bg-surface text-sm text-right num" />
                          {line.needsRecount && (
                            <input
                              type="number" min={0} inputMode="numeric"
                              defaultValue={line.recountQty ?? ""}
                              placeholder="2e"
                              title="Second comptage"
                              onBlur={e => {
                                const value = e.target.value === "" ? null : Number(e.target.value);
                                if (value !== line.recountQty) patch({ lineId: line._id, recountQty: value });
                              }}
                              className="w-20 h-8 px-2 rounded border border-warn/50 bg-warn-50 text-sm text-right num" />
                          )}
                        </span>
                      )}
                    </td>

                    {!(counting && session.blind) && (
                      <td className={`num text-right font-medium ${
                        (line.variance ?? 0) < 0 ? "text-neg" : (line.variance ?? 0) > 0 ? "text-pos" : "text-ink3"
                      }`}>
                        {line.variance === null ? "—" : line.variance > 0 ? `+${line.variance}` : line.variance}
                      </td>
                    )}

                    {!(counting && session.blind) && (
                      <td className="num text-right text-ink2">
                        {line.varianceValue === null
                          ? (line.variance ? <span className="text-[11px] text-warn">non valorisé</span> : "—")
                          : fullXof(line.varianceValue)}
                      </td>
                    )}

                    <td>
                      {!done && (line.needsReason || line.reason) ? (
                        <input
                          defaultValue={line.reason ?? ""}
                          placeholder={line.needsReason ? "Motif obligatoire" : "Motif"}
                          onBlur={e => {
                            if (e.target.value !== (line.reason ?? "")) {
                              patch({ lineId: line._id, reason: e.target.value });
                            }
                          }}
                          className={`w-40 h-8 px-2 rounded border text-xs ${
                            line.needsReason ? "border-warn bg-warn-50" : "border-line2 bg-surface"
                          }`} />
                      ) : (
                        <span className="text-xs text-ink2">{line.reason || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {counting && session.blind && (
        <p className="text-xs text-ink3 flex items-center gap-2">
          <AlertTriangle size={13} />
          Les quantités théoriques ne quittent pas le serveur pendant le comptage : les
          masquer à l&apos;écran ne servirait à rien, il suffirait d&apos;ouvrir
          l&apos;inspecteur du navigateur.
        </p>
      )}
    </div>
  );
}
