"use client";
import { useEffect, useMemo, useState } from "react";
import { Gauge, Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { goScore, recommend, type CriterionKey, type GoDecision, type Scores } from "@/lib/go-no-go";

interface Criterion { key: CriterionKey; label: string; hint: string; weight: number }
interface Saved { scores: Scores; score: number; decision: GoDecision; note?: string; decidedAt: string }
const DECISIONS: Record<GoDecision, [string, string]> = {
  go: ["Go : on répond", "bg-pos-50 text-pos border-pos/30"],
  review: ["À arbitrer", "bg-warn-50 text-warn border-warn/30"],
  no_go: ["No-Go : on ne répond pas", "bg-neg-50 text-neg border-neg/30"],
};

/** Grille Go/No-Go : critères pondérés, pré-évaluations tirées des données, décision motivée. */
export function GoNoGoPanel({ appelId, editable, onDecision }: { appelId: string; editable: boolean; onDecision?: (d: GoDecision) => void }) {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [reasons, setReasons] = useState<Partial<Record<CriterionKey, string>>>({});
  const [scores, setScores] = useState<Scores>({});
  const [saved, setSaved] = useState<Saved | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiJson(`/api/appels/${appelId}/go-no-go`).then(d => {
      if (!d?.data) return;
      const { reasons: rs, ...sugg } = d.data.suggestions;
      setCriteria(d.data.criteria); setReasons(rs ?? {}); setSaved(d.data.saved);
      setScores(d.data.saved?.scores ?? sugg); setNote(d.data.saved?.note ?? "");
    });
  }, [appelId]);

  const complete = criteria.length > 0 && criteria.every(c => scores[c.key] !== undefined);
  const score = useMemo(() => goScore(scores), [scores]);
  const reco = recommend(scores);

  async function decide(decision: GoDecision) {
    setBusy(true);
    try {
      const res = await apiSend("PUT", `/api/appels/${appelId}/go-no-go`, { scores, decision, note });
      if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
      setSaved(res.data.data); onDecision?.(decision);
      showToast(`Décision enregistrée : ${DECISIONS[decision][0]}.`, "success");
    } finally { setBusy(false); }
  }

  if (!criteria.length) return null;
  return (
    <section className="surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><Gauge size={16} /> Go / No-Go</h2>
          <p className="text-xs text-ink2">Avant d&apos;engager dossier et caution : notez chaque critère de 0 à 5.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold num text-ink">{complete ? score : "—"}<span className="text-sm text-ink3">/100</span></p>
          {complete && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${DECISIONS[reco][1]}`}>Recommandé : {DECISIONS[reco][0]}</span>}
        </div>
      </div>
      {saved && <p className={`text-sm p-2 rounded-lg border ${DECISIONS[saved.decision][1]}`}>Décision du {new Date(saved.decidedAt).toLocaleDateString("fr-FR")} : <strong>{DECISIONS[saved.decision][0]}</strong> ({saved.score}/100){saved.note ? ` — ${saved.note}` : ""}</p>}
      <div className="space-y-3">
        {criteria.map(c => (
          <div key={c.key} className="grid sm:grid-cols-[1fr_auto] gap-2 items-center">
            <div>
              <p className="text-sm font-medium text-ink">{c.label} <span className="text-xs text-ink3">× {c.weight}</span></p>
              <p className="text-xs text-ink2">{c.hint}{reasons[c.key] && <span className="text-section inline-flex items-center gap-1 ml-1"><Sparkles size={11} /> {reasons[c.key]}</span>}</p>
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
              {[0, 1, 2, 3, 4, 5].map(v => (
                <button key={v} type="button" role="radio" aria-checked={scores[c.key] === v} disabled={!editable}
                  onClick={() => setScores(s => ({ ...s, [c.key]: v }))}
                  className={`w-8 h-8 rounded-md text-sm font-semibold border ${scores[c.key] === v ? "bg-section text-onink border-section" : "border-line text-ink2 hover:bg-surface2"} disabled:opacity-70`}>{v}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {editable && (
        <>
          <textarea className="w-full p-2 border border-line rounded-lg text-sm bg-surface" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Motif de la décision (concurrence, risques, conditions)…" />
          <div className="flex gap-2 flex-wrap">
            {(["go", "review", "no_go"] as GoDecision[]).map(d => (
              <button key={d} disabled={busy || !complete} onClick={() => decide(d)} className={buttonClass(d === reco ? "primary" : "secondary", "sm")}>{DECISIONS[d][0]}</button>
            ))}
            {!complete && <span className="text-xs text-ink3 self-center">Notez tous les critères pour décider.</span>}
          </div>
        </>
      )}
    </section>
  );
}
