"use client";

import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
import { localDay, todayLocal } from "@/lib/format";
import { useFormDraft } from "@/lib/use-draft";
import { DraftBanner } from "@/components/ui/DraftBanner";
import { LinesEditor, MentionsFields, calcDocLine, emptyLine, emptyMentions, linesForApi, type EditLine, type Mentions } from "@/components/docs/DocEditors";
/** Unité libre (u, m², forfait, h/j…) : imprimée sur la facture. */
export type UnitType = string;
type InvoiceLine = EditLine;
export interface InvoiceFormData {
  clientId: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  notes?: string;
  termsAndConditions?: string;
  projectId?: string | null;
  activityId?: string | null;
  object?: string; reference?: string; period?: string; attention?: string;
}

interface Client { 
  _id: string; 
  name: string; 
  code: string; 
  paymentTermDays: number; 
}

interface InvoiceFormProps {
  initial?: Partial<InvoiceFormData> & { _id?: string };
  /** Nom du brouillon gardé sur l'appareil (création seulement : « invoice-new »). */
  draftKey?: string;
  onSave: (data: InvoiceFormData) => Promise<void>;
  onCancel: () => void;
}

export function InvoiceForm({ initial, draftKey, onSave, onCancel }: InvoiceFormProps) {
  // Dates par défaut figées au montage (un rendu doit rester pur).
  const [{ today, in30 }] = useState(() => ({
    today: todayLocal(),
    in30: localDay(new Date(Date.now() + 30 * 86400000)),
  }));

  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [clientId, setClientId] = useState(initial?.clientId || "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate?.slice(0, 10) || today);
  const [dueDate, setDueDate] = useState(initial?.dueDate?.slice(0, 10) || in30);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [terms, setTerms] = useState(initial?.termsAndConditions || "");
  const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : v ? String(v) : undefined);
  const [imputation, setImputation] = useState<ImputationValue>({ projectId: idOf(initial?.projectId), activityId: idOf(initial?.activityId) });
  const [lines, setLines] = useState<InvoiceLine[]>(
    initial?.lines?.length ? initial.lines.map(calcDocLine) : [emptyLine()]
  );
  const [mentions, setMentions] = useState<Mentions>(emptyMentions(initial));

  // Saisie gardée sur l'appareil (déconnexion pour inactivité, rechargement…).
  const draft = useFormDraft(draftKey ?? null, { clientId, issueDate, dueDate, notes, terms, imputation, mentions, lines });
  function restoreDraft() {
    const d = draft.restore();
    if (!d) return;
    setClientId(d.clientId); setIssueDate(d.issueDate); setDueDate(d.dueDate); setNotes(d.notes); setTerms(d.terms);
    setImputation(d.imputation); setLines(d.lines.length ? d.lines.map(calcDocLine) : lines);
    if (d.mentions) setMentions(d.mentions);
  }

  useEffect(() => {
    apiJson("/api/clients?picker=1&isActive=true")
      .then(d => setClients(d.data?.items || []));
  }, []);

  function handleClientChange(id: string) {
    setClientId(id);
    const client = clients.find(c => c._id === id);
    if (client) {
      const due = localDay(new Date(Date.now() + client.paymentTermDays * 86400000));
      setDueDate(due);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return setError("Sélectionnez un client");
    if (lines.some(l => !l.description.trim())) return setError("Toutes les lignes doivent avoir une description");
    
    setSaving(true); 
    setError("");
    
    try {
      await onSave({ clientId, issueDate, dueDate, lines: linesForApi(lines) as InvoiceLine[], notes, termsAndConditions: terms, ...mentions, projectId: imputation.projectId ?? null, activityId: imputation.activityId ?? null });
      draft.clear();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {draft.pending && <DraftBanner savedAt={draft.pending.savedAt} onRestore={restoreDraft} onDiscard={draft.discard} />}
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Client" required className="md:col-span-1">
          <select className={selectCls} value={clientId} onChange={e => handleClientChange(e.target.value)} required>
            <option value="">Sélectionner un client...</option>
            {clients.map(c => <option key={c._id} value={c._id}>{c.name} ({c.code})</option>)}
          </select>
        </FormField>
        <FormField label="Date d'émission" required>
          <input type="date" className={inputCls} value={issueDate} onChange={e => setIssueDate(e.target.value)} required />
        </FormField>
        <FormField label="Date d'échéance" required>
          <input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} required />
        </FormField>
      </div>

      <MentionsFields value={mentions} onChange={setMentions} />

      <LinesEditor lines={lines} onChange={setLines} title="Lignes de facturation" />

      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">Imputation de la recette</p>
        <ImputationFields value={imputation} onChange={setImputation} hideCostCenter />
      </div>

      <FormField label="Conditions (imprimées sur la facture)" hint="Vide : les conditions par défaut de l'organisation">
        <textarea className={inputCls + " resize-y"} rows={2} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Paiement à 30 jours, pénalités de retard, mentions spéciales…" />
      </FormField>
      <FormField label="Notes internes" hint="Jamais imprimées">
        <textarea className={inputCls + " resize-y"} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="À usage interne" />
      </FormField>

      <div className="flex justify-end gap-3 pt-4 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>
          {saving ? "Enregistrement..." : "Enregistrer la facture"}
        </button>
      </div>
    </form>
  );
}