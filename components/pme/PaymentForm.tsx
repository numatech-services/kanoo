"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
interface TreasuryAccountOption { _id: string; label: string; type: string }

interface PaymentFormProps {
  invoiceId: string;
  remainingAmount: number;
  onSave: (d: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

const METHODS: Array<[string, string]> = [
  ["bank_transfer", "Virement bancaire"],
  ["cash", "Espèces"],
  ["cheque", "Chèque"],
  ["mobile_money", "Mobile Money"],
  ["other", "Autre"],
];

/** Le mode de règlement suggère le type de compte, il ne le décide pas. */
const METHOD_ACCOUNT_TYPE: Record<string, string> = {
  bank_transfer: "bank",
  cheque: "bank",
  cash: "cash",
  mobile_money: "mobile_money",
};

export function PaymentForm({ invoiceId, remainingAmount, onSave, onCancel }: PaymentFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(remainingAmount);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [status, setStatus] = useState("effective");
  const [accounts, setAccounts] = useState<TreasuryAccountOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiJson("/api/treasury-accounts")
      .then(d => {
        const items: TreasuryAccountOption[] = d.data?.items || [];
        setAccounts(items);
        // Un seul compte : le choix est sans ambiguïté, on le pose.
        // Plusieurs : ne rien pré-remplir, un encaissement imputé au mauvais
        // compte se paie au rapprochement du mois suivant.
        if (items.length === 1) setTreasuryAccountId(items[0]._id);
      })
      .catch(() => { /* la trésorerie n'est pas indispensable pour encaisser */ });
  }, []);

  const suggested = METHOD_ACCOUNT_TYPE[method];
  const sorted = [...accounts].sort((a, b) =>
    (a.type === suggested ? 0 : 1) - (b.type === suggested ? 0 : 1)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "effective" && !treasuryAccountId) {
      setError("Choisissez le compte qui a reçu l'argent : il alimente le solde de trésorerie.");
      return;
    }
    if (amount <= 0 || amount > remainingAmount + 1) {
      setError(`Montant entre 1 et ${remainingAmount.toLocaleString("fr-FR")} FCFA`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        invoiceId, amount, method, reference, date, notes, status,
        ...(treasuryAccountId ? { treasuryAccountId } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paiement refusé");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>
      )}

      <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-sm">
        <span className="font-semibold text-warn">Reste à payer&nbsp;: </span>
        <span className="num font-bold text-warn">{remainingAmount.toLocaleString("fr-FR")} FCFA</span>
      </div>

      <FormField label="Montant encaissé (FCFA)" required>
        <input type="number" className={inputCls} value={amount} min={1} max={remainingAmount} required
          onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mode de paiement" required>
          <select className={selectCls} value={method} onChange={e => setMethod(e.target.value)}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormField>
        <FormField label={status === "pending" ? "Date prévue" : "Date réelle de réception"} required>
          <input type="date" className={inputCls} value={date} required max={status === "pending" ? undefined : today}
            onChange={e => setDate(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Compte bancaire / caisse crédité"
        hint="Ce qui alimente le solde de trésorerie et le rapprochement bancaire.">
        {accounts.length === 0 ? (
          <p className="text-xs text-ink2 px-3 py-2 border border-line2 rounded-lg bg-surface2">
            Aucun compte de trésorerie.{" "}
            <Link href="/treasury" className="text-section hover:underline">Créez votre banque, caisse ou compte mobile money</Link>{" "}
            pour enregistrer un encaissement (ou notez-le « en attente »).
          </p>
        ) : (
          <select className={selectCls} value={treasuryAccountId}
            onChange={e => setTreasuryAccountId(e.target.value)}>
            <option value="">{status === "pending" ? "— À préciser à l'encaissement —" : "— Choisir le compte —"}</option>
            {sorted.map(a => (
              <option key={a._id} value={a._id}>{a.label}</option>
            ))}
          </select>
        )}
      </FormField>



      <FormField label="État du règlement"
        hint="« En attente » n'impacte ni la facture ni la comptabilité tant qu'il n'est pas confirmé encaissé.">
        <select className={selectCls} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="effective">Encaissé (effectif)</option>
          <option value="pending">En attente</option>
        </select>
      </FormField>

      <FormField label="Référence (n° virement, chèque…)">
        <input className={inputCls} value={reference} placeholder="Optionnel"
          onChange={e => setReference(e.target.value)} />
      </FormField>

      <FormField label="Notes">
        <textarea className={inputCls + " resize-y"} rows={2} value={notes}
          onChange={e => setNotes(e.target.value)} />
      </FormField>

      <div className="flex justify-end gap-3 pt-3 border-t border-line">
        <button type="button" onClick={onCancel}
          className={buttonClass("secondary", "md")}>
          Annuler
        </button>
        <button type="submit" disabled={saving}
          className="px-6 py-2 bg-pos text-white rounded-xl text-sm font-medium hover:brightness-95 disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer le paiement"}
        </button>
      </div>
    </form>
  );
}
