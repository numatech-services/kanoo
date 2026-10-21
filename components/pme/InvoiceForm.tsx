"use client";

import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
export type UnitType = "unité" | "m³" | "L" | "kg" | "m²" | "Année" | "Mois";

interface InvoiceLine {
  description: string;
  quantity: number;
  unit: UnitType;
  unitPrice: number;
  tvaRate: number;
  discount: number;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
}

export interface InvoiceFormData {
  clientId: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  notes?: string;
  termsAndConditions?: string;
  projectId?: string | null;
  activityId?: string | null;
}

interface Client { 
  _id: string; 
  name: string; 
  code: string; 
  paymentTermDays: number; 
}

interface InvoiceFormProps {
  initial?: Partial<InvoiceFormData> & { _id?: string };
  onSave: (data: InvoiceFormData) => Promise<void>;
  onCancel: () => void;
}

const UNIT_OPTIONS: { value: UnitType; label: string }[] = [
  { value: "unité", label: "Unité (Unité/Pcs)" },
  { value: "m³", label: "Volume (m³)" },
  { value: "L", label: "Volume (Litres)" },
  { value: "kg", label: "Masse (Kg)" },
  { value: "m²", label: "Surface (m²)" },
  { value: "Année", label: "Année" },
  { value: "Mois", label: "Mois" },
];

function calcLine(line: Partial<InvoiceLine>): InvoiceLine {
  const qty = line.quantity || 0;
  const price = line.unitPrice || 0;
  const disc = line.discount || 0;
  const tva = line.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price * (1 - disc / 100));
  const tvaAmt = calculerTVA(ht, tva);
  
  return { 
    description: line.description || "", 
    quantity: qty, 
    unit: line.unit || "unité",
    unitPrice: price, 
    tvaRate: tva, 
    discount: disc, 
    totalHT: ht, 
    totalTVA: tvaAmt, 
    totalTTC: ht + tvaAmt 
  };
}

export function InvoiceForm({ initial, onSave, onCancel }: InvoiceFormProps) {
  // Dates par défaut figées au montage (un rendu doit rester pur).
  const [{ today, in30 }] = useState(() => ({
    today: new Date().toISOString().slice(0, 10),
    in30: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  }));

  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [clientId, setClientId] = useState(initial?.clientId || "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate?.slice(0, 10) || today);
  const [dueDate, setDueDate] = useState(initial?.dueDate?.slice(0, 10) || in30);
  const [notes, setNotes] = useState(initial?.notes || "");
  const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : v ? String(v) : undefined);
  const [imputation, setImputation] = useState<ImputationValue>({ projectId: idOf(initial?.projectId), activityId: idOf(initial?.activityId) });
  const [lines, setLines] = useState<InvoiceLine[]>(
    initial?.lines?.length ? initial.lines : [calcLine({ description: "", quantity: 1, unit: "unité", unitPrice: 0 })]
  );

  useEffect(() => {
    apiJson("/api/clients?limit=100&isActive=true")
      .then(d => setClients(d.data?.items || []));
  }, []);

  function handleClientChange(id: string) {
    setClientId(id);
    const client = clients.find(c => c._id === id);
    if (client) {
      const due = new Date(Date.now() + client.paymentTermDays * 86400000).toISOString().slice(0, 10);
      setDueDate(due);
    }
  }

  function updateLine(i: number, field: keyof InvoiceLine, value: string | number) {
    setLines(prev => prev.map((l, idx) => idx === i ? calcLine({ ...l, [field]: value }) : l));
  }

  function addLine() {
    setLines(prev => [...prev, calcLine({ description: "", quantity: 1, unit: "unité", unitPrice: 0 })]);
  }

  function removeLine(i: number) {
    if (lines.length === 1) return;
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.totalTVA, 0);
  const totalTTC = totalHT + totalTVA;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return setError("Sélectionnez un client");
    if (lines.some(l => !l.description.trim())) return setError("Toutes les lignes doivent avoir une description");
    
    setSaving(true); 
    setError("");
    
    try {
      await onSave({ clientId, issueDate, dueDate, lines, notes, projectId: imputation.projectId ?? null, activityId: imputation.activityId ?? null });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-ink">Lignes de facturation</p>
          <button type="button" onClick={addLine} className="text-xs text-section hover:underline">Ajouter une ligne</button>
        </div>
        <div className="bg-surface2 rounded-xl overflow-hidden border border-line">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-ink2 uppercase tracking-wide">
            <span className="col-span-3">Description</span>
            <span className="col-span-2 text-center">Volume</span>
            <span className="col-span-2 text-right">P.U. HT</span>
            <span className="col-span-1 text-right">TVA%</span>
            <span className="col-span-1 text-right">Rem%</span>
            <span className="col-span-2 text-right">Total TTC</span>
            <span className="col-span-1"></span>
          </div>
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-line bg-surface items-center">
              {/* Description */}
              <div className="col-span-3">
                <input className={inputCls} value={line.description} onChange={e => updateLine(i, "description", e.target.value)} placeholder="Description du produit/service" required />
              </div>

              {/* Quantité & Unité (Nombre ou Volume) */}
              <div className="col-span-2 flex gap-1">
                <input type="number" className={inputCls + " w-1/2 px-1 text-center"} value={line.quantity} onChange={e => updateLine(i, "quantity", parseFloat(e.target.value) || 0)} min={0} step="0.01" />
                <select className={selectCls + " w-1/2 px-1 text-xs"} value={line.unit} onChange={e => updateLine(i, "unit", e.target.value)}>
                  {UNIT_OPTIONS.map(u => (
                    <option key={u.value} value={u.value}>{u.value}</option>
                  ))}
                </select>
              </div>

              {/* Prix Unitaire HT */}
              <div className="col-span-2">
                <input type="number" className={inputCls + " text-right"} value={line.unitPrice} onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)} min={0} />
              </div>

              {/* TVA */}
              <div className="col-span-1">
                <select className={selectCls} value={line.tvaRate} onChange={e => updateLine(i, "tvaRate", parseFloat(e.target.value))}>
                  <option value={0.19}>19%</option>
                  <option value={0.10}>10%</option>
                  <option value={0}>0%</option>
                </select>
              </div>

              {/* Remise */}
              <div className="col-span-1">
                <input type="number" className={inputCls + " text-right"} value={line.discount} onChange={e => updateLine(i, "discount", parseFloat(e.target.value) || 0)} min={0} max={100} />
              </div>

              {/* Total TTC */}
              <div className="col-span-2 flex items-center justify-end">
                <span className="font-mono text-sm font-semibold text-ink">{line.totalTTC.toLocaleString("fr-FR")}</span>
              </div>

              {/* Suppression */}
              <div className="col-span-1 flex items-center justify-center">
                <button type="button" onClick={() => removeLine(i)} disabled={lines.length === 1} className="text-ink2 hover:text-neg disabled:opacity-30 text-lg">×</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-64 space-y-2 bg-surface rounded-xl border border-line p-4">
          {[
            ["Total HT", `${totalHT.toLocaleString("fr-FR")} FCFA`, "text-ink2"],
            ["TVA", `${totalTVA.toLocaleString("fr-FR")} FCFA`, "text-ink2"],
            ["Total TTC", `${totalTTC.toLocaleString("fr-FR")} FCFA`, "text-ink font-bold text-base"],
          ].map(([label, value, cls]) => (
            <div key={label} className="flex justify-between text-sm border-b border-line pb-1.5 last:border-0 last:pt-1">
              <span className="text-ink2">{label}</span>
              <span className={`font-mono ${cls}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">Imputation de la recette</p>
        <ImputationFields value={imputation} onChange={setImputation} hideCostCenter />
      </div>

      <FormField label="Notes internes">
        <textarea className={inputCls + " resize-y"} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Conditions de paiement, mentions spéciales..." />
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