"use client";
import { useState, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
import { localDay, todayLocal } from "@/lib/format";
import { useFormDraft } from "@/lib/use-draft";
import { DraftBanner } from "@/components/ui/DraftBanner";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";
import { LinesEditor, MentionsFields, calcDocLine, emptyLine, emptyMentions, linesForApi, type EditLine, type Mentions } from "@/components/docs/DocEditors";
interface Client { _id: string; name: string; code: string; }
interface DevisFormProps {
  initial?: Record<string, unknown> & { _id?: string };
  draftKey?: string;
  onSave: (d: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  /**
   * Zone d'assistance (Claude) : reçoit de quoi remplir le formulaire avec
   * une proposition (lignes, mentions, conditions), relue avant enregistrement.
   */
  assistant?: (fill: (p: { lines?: Partial<EditLine>[]; mentions?: Partial<Mentions>; terms?: string }) => void, ctx: { clientName?: string; docKind: "devis" | "proforma"; filledLines: number }) => ReactNode;
}

// Faux au rendu serveur et pendant l'hydratation (rien n'est affiché), vrai ensuite.
const noSubscribe = () => () => {};

export function DevisForm({ initial, draftKey, onSave, onCancel, assistant }: DevisFormProps) {
  // Dates par défaut figées au montage (un rendu doit rester pur).
  const [{ today, in30 }] = useState(() => ({
    today: todayLocal(),
    in30: localDay(new Date(Date.now() + 30 * 86400000)),
  }));
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(String(initial?.clientId || ""));
  const [issueDate, setIssueDate] = useState(String(initial?.issueDate || today).slice(0, 10));
  const [validUntil, setValidUntil] = useState(String(initial?.validUntil || in30).slice(0, 10));
  const [docKind, setDocKind] = useState<"devis" | "proforma">(initial?.docKind === "proforma" ? "proforma" : "devis");
  const [mentions, setMentions] = useState<Mentions>(emptyMentions(initial));
  const [terms, setTerms] = useState(String(initial?.termsAndConditions || ""));
  const [notes, setNotes] = useState(String(initial?.notes || ""));
  // Secteur d'activité et projet : la vente arrive imputée en comptabilité (rentabilité par activité).
  const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : v ? String(v) : undefined);
  const [imputation, setImputation] = useState<ImputationValue>({ projectId: idOf(initial?.projectId), activityId: idOf(initial?.activityId) });
  const [lines, setLines] = useState<EditLine[]>(() => {
    const init = initial?.lines as Partial<EditLine>[] | undefined;
    return init?.length ? init.map(calcDocLine) : [emptyLine()];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Saisie gardée sur l'appareil (déconnexion pour inactivité, rechargement…).
  const draft = useFormDraft(draftKey ?? null, { clientId, issueDate, validUntil, docKind, mentions, terms, notes, lines });
  function restoreDraft() {
    const d = draft.restore();
    if (!d) return;
    setClientId(d.clientId); setIssueDate(d.issueDate); setValidUntil(d.validUntil); setNotes(d.notes);
    if (d.docKind) setDocKind(d.docKind);
    if (d.mentions) setMentions(d.mentions);
    if (d.terms !== undefined) setTerms(d.terms);
    if (d.lines.length) setLines(d.lines.map(calcDocLine));
  }
  function fill(p: { lines?: Partial<EditLine>[]; mentions?: Partial<Mentions>; terms?: string }) {
    if (p.lines?.length) setLines(p.lines.map(calcDocLine));
    if (p.mentions) setMentions(m => ({ ...m, ...Object.fromEntries(Object.entries(p.mentions!).filter(([, v]) => v)) }));
    if (p.terms) setTerms(p.terms);
  }

  useEffect(() => { apiJson("/api/clients?picker=1&isActive=true").then(d=>setClients(d.data?.items||[])); }, []);

  if (!mounted) return null;

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.totalTVA, 0);
  const totalTTC = totalHT + totalTVA;

  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setSaving(true); setError("");
      // Un refus du serveur s'affiche ; le bouton ne reste pas bloqué sur « Enregistrement… ».
      try {
        await onSave({ clientId, issueDate, validUntil, docKind, ...mentions, termsAndConditions: terms, lines: linesForApi(lines), notes, totalHT, totalTVA, totalTTC,
          projectId: imputation.projectId ?? null, activityId: imputation.activityId ?? null });
        draft.clear();
      }
      catch (err) { setError(err instanceof Error ? err.message : "Enregistrement impossible"); }
      finally { setSaving(false); }
    }} className="space-y-5">
      {draft.pending && <DraftBanner savedAt={draft.pending.savedAt} onRestore={restoreDraft} onDiscard={draft.discard} />}
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>}
      {assistant?.(fill, { clientName: clients.find(c => c._id === clientId)?.name, docKind, filledLines: lines.filter(l => l.description.trim()).length })}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <FormField label="Document" required>
          <select className={selectCls} value={docKind} onChange={e => setDocKind(e.target.value as "devis" | "proforma")}>
            <option value="devis">Devis</option>
            <option value="proforma">Facture proforma</option>
          </select>
        </FormField>
        <FormField label="Client" required>
          <select className={selectCls} value={clientId} onChange={e=>setClientId(e.target.value)} required>
            <option value="">Choisir…</option>
            {clients.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Date d'émission" required>
          <input type="date" className={inputCls} value={issueDate} onChange={e=>setIssueDate(e.target.value)} required />
        </FormField>
        <FormField label="Valide jusqu'au" required>
          <input type="date" className={inputCls} value={validUntil} onChange={e=>setValidUntil(e.target.value)} required />
        </FormField>
      </div>

      <MentionsFields value={mentions} onChange={setMentions} />

      <LinesEditor lines={lines} onChange={setLines} />

      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">Imputation</p>
        <ImputationFields value={imputation} onChange={setImputation} hideCostCenter />
      </div>

      <FormField label="Conditions (imprimées)" hint="Une condition par ligne ; « Titre — texte » met le titre en gras. Vide : les conditions par défaut de l'organisation.">
        <textarea className={textareaCls} rows={4} value={terms} onChange={e => setTerms(e.target.value)}
          placeholder={"Validité — offre valable trente (30) jours.\nRèglement — 50 % à la commande, solde à la livraison."} />
      </FormField>
      <FormField label="Notes internes" hint="Jamais imprimées">
        <textarea className={textareaCls} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
      </FormField>

      <div className="flex justify-end gap-3 pt-3 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : docKind === "proforma" ? "Enregistrer la proforma" : "Enregistrer le devis"}</button>
      </div>
    </form>
  );
}
