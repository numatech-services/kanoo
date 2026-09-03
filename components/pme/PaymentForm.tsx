"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

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
  const [accounts, setAccounts] = useState<TreasuryAccountOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" })
      .then(r => r.json())
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
    if (amount <= 0 || amount > remainingAmount + 1) {
      setError(`Montant entre 1 et ${remainingAmount.toLocaleString("fr-FR")} XOF`);
      return;
    }
    setSaving(true);
    setError("");
    await onSave({
      invoiceId, amount, method, reference, date, notes,
      ...(treasuryAccountId ? { treasuryAccountId } : {}),
    });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>
      )}

      <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-sm">
        <span className="font-semibold text-warn">Reste à payer&nbsp;: </span>
        <span className="num font-bold text-warn">{remainingAmount.toLocaleString("fr-FR")} XOF</span>
      </div>

      <FormField label="Montant encaissé (XOF)" required>
        <input type="number" className={inputCls} value={amount} min={1} max={remainingAmount} required
          onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mode de paiement" required>
          <select className={selectCls} value={method} onChange={e => setMethod(e.target.value)}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormField>
        <FormField label="Date de réception" required>
          <input type="date" className={inputCls} value={date} required
            onChange={e => setDate(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Compte encaissé"
        hint="Ce qui alimente le solde de trésorerie et le rapprochement bancaire.">
        {accounts.length === 0 ? (
          <p className="text-xs text-ink2 px-3 py-2 border border-line2 rounded-lg bg-surface2">
            Aucun compte de trésorerie.{" "}
            <Link href="/treasury" className="text-section hover:underline">En créer un</Link>{" "}
            — sans compte, le règlement est enregistré mais n&apos;apparaît sur aucun solde.
          </p>
        ) : (
          <select className={selectCls} value={treasuryAccountId}
            onChange={e => setTreasuryAccountId(e.target.value)}>
            <option value="">— Ne pas imputer —</option>
            {sorted.map(a => (
              <option key={a._id} value={a._id}>{a.label}</option>
            ))}
          </select>
        )}
      </FormField>

      {accounts.length > 0 && !treasuryAccountId && (
        <p className="text-xs text-warn">
          Sans compte désigné, ce règlement ne remontera dans aucun solde et
          restera introuvable au rapprochement.
        </p>
      )}

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
          className="px-4 py-2 border border-line2 rounded-xl text-sm text-ink2 hover:bg-surface2">
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
