"use client";

import { useCallback, useEffect, useState } from "react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/Toast";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { useMe, meCanDo } from "@/lib/useMe";

interface RefundState { refundable: number; refunded: number; refunds: Array<{ date: string; amount: number; reference?: string }> }

/** Remboursement au client d'un avoir émis sur une facture déjà réglée. */
export function RefundPanel({ creditNoteId, onDone }: { creditNoteId: string; onDone?: () => void }) {
  const me = useMe();
  const canRefund = meCanDo(me, "payments", "create");
  const [state, setState] = useState<RefundState | null>(null);
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [date, setDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get<RefundState>(`/api/invoices/${creditNoteId}/refund`).then(s => { setState(s); setAmount(s.refundable || ""); }).catch(() => setState(null));
  }, [creditNoteId]);
  useEffect(() => { load(); }, [load]);

  if (!state || (state.refundable <= 0 && state.refunded <= 0)) return null;

  async function refund() {
    setSaving(true);
    try {
      const r = await api.post<{ amount: number }>(`/api/invoices/${creditNoteId}/refund`, { treasuryAccountId: account, amount: amount || undefined, date });
      showToast(`${formatMoney(r.amount)} remboursés au client.`, "success");
      load(); onDone?.();
    } catch (e) { showToast(apiErrorMessage(e, "Remboursement impossible."), "error"); }
    finally { setSaving(false); }
  }

  return (
    <section className="surface-card p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-ink text-sm">Remboursement au client</h2>
        <p className="text-xs text-ink2 mt-0.5">
          {state.refundable > 0
            ? <>La facture d&apos;origine a été payée : <strong className="num">{formatMoney(state.refundable)}</strong> restent dus au client.</>
            : "Avoir intégralement remboursé."}
        </p>
      </div>
      {state.refunds.length > 0 && (
        <ul className="text-xs text-ink2 space-y-0.5">
          {state.refunds.map((r, i) => <li key={i}>{formatDate(r.date)} — <span className="num">{formatMoney(r.amount)}</span>{r.reference ? ` · ${r.reference}` : ""}</li>)}
        </ul>
      )}
      {state.refundable > 0 && canRefund && (
        <div className="grid sm:grid-cols-[1fr_10rem_10rem_auto] gap-3 items-end">
          <FormField label="Compte qui rembourse" required><TreasuryAccountSelect value={account} onChange={setAccount} required /></FormField>
          <FormField label="Montant"><input type="number" min={1} max={state.refundable} className={inputCls} value={amount} onChange={e => setAmount(e.target.value ? Number(e.target.value) : "")} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></FormField>
          <Button onClick={refund} loading={saving} disabled={!account}>Rembourser</Button>
        </div>
      )}
    </section>
  );
}
