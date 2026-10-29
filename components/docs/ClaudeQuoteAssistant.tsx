"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { textareaCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
import { confirmDialog } from "@/components/ui/Dialogs";
import type { EditLine, Mentions } from "@/components/docs/DocEditors";

type Fill = (p: { lines?: Partial<EditLine>[]; mentions?: Partial<Mentions>; terms?: string }) => void;
interface Status { configured: boolean; quota?: { remaining: number; quota: number } }

/**
 * « Préparer avec Claude » : le besoin décrit en quelques lignes devient
 * objet, postes, lignes et conditions (POST /api/ai/devis). La proposition
 * remplit le formulaire — rien n'est enregistré avant relecture.
 */
export function ClaudeQuoteAssistant({ fill, docKind, filledLines = 0 }: { fill: Fill; docKind: "devis" | "proforma"; filledLines?: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    apiJson("/api/ai/devis").then(d => setStatus(d?.data ?? { configured: false })).catch(() => setStatus({ configured: false }));
  }, []);
  if (!status) return null;

  if (!status.configured) {
    return (
      <p className="text-xs text-ink2 bg-surface2 rounded-xl px-3 py-2 inline-flex items-center gap-2">
        <Sparkles size={14} className="text-section" />
        Claude peut préparer ce document à partir de votre description. <Link href="/company/assistant" className="text-section font-semibold hover:underline">Activer Claude</Link>
      </p>
    );
  }

  async function run() {
    if (filledLines > 0 && !(await confirmDialog({
      title: `Remplacer les ${filledLines} ligne${filledLines > 1 ? "s" : ""} saisie${filledLines > 1 ? "s" : ""} ?`,
      message: "La proposition de Claude remplace les lignes, l'objet et les conditions du formulaire. Rien n'est enregistré avant votre validation.",
      confirmLabel: "Remplacer",
    }))) return;
    setBusy(true); setError(""); setWarnings([]);
    const res = await apiSend("POST", "/api/ai/devis", { brief, docKind });
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Préparation impossible."); return; }
    const d = res.data.data as { lines: Partial<EditLine>[]; mentions: Partial<Mentions>; terms: string; warnings: string[]; quota?: Status["quota"] };
    fill({ lines: d.lines, mentions: d.mentions, terms: d.terms });
    setWarnings(d.warnings ?? []);
    if (d.quota) setStatus(s => (s ? { ...s, quota: d.quota } : s));
    setOpen(false);
  }

  return (
    <div className="rounded-xl border border-section/25 bg-section-soft/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-2"><Sparkles size={15} className="text-section" /> Préparer avec Claude</p>
        {!open && <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>Décrire le besoin</button>}
      </div>
      {open && (
        <>
          <textarea className={textareaCls} rows={4} value={brief} onChange={e => setBrief(e.target.value)} maxLength={4000} autoFocus
            placeholder={"Ex. Équipement d'une salle de réunion : écran interactif 86 pouces, caméra PTZ, connectique de table, pose, mise en service et formation de 3 jours. Paiement 60 % à la commande."} />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-ink3">Prix repris du catalogue ; ce qui n&apos;y figure pas reste à chiffrer. La description et le catalogue sont transmis à Anthropic : n&apos;y mettez pas de données personnelles (noms, téléphones…).{status.quota ? ` ${status.quota.remaining} / ${status.quota.quota} ce mois-ci.` : ""}</p>
            <span className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>Fermer</button>
              <button type="button" onClick={run} disabled={busy || brief.trim().length < 10} className={buttonClass("primary", "sm")}>{busy ? "Claude prépare…" : "Préparer"}</button>
            </span>
          </div>
        </>
      )}
      {error && <p className="text-sm text-neg">{error}</p>}
      {warnings.length > 0 && (
        <div className="text-xs text-warn bg-warn-50 border border-warn/25 rounded-lg px-3 py-2">
          <p className="font-semibold mb-0.5">À vérifier avant envoi :</p>
          <ul className="list-disc pl-4 space-y-0.5">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
