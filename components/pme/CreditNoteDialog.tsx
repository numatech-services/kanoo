"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fullXof } from "@/components/ui/charts/geometry";

export interface CreditableLine {
  description: string;
  quantity: number;
  unitPrice: number;
  totalTTC: number;
}

interface CreditNoteDialogProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  totalTTC: number;
  creditedAmount: number;
  lines: CreditableLine[];
  onIssued: () => void;
}

/**
 * Émission d'une facture d'avoir.
 *
 * Le dialogue impose ce que la réglementation impose : un motif écrit, et un
 * choix explicite entre avoir total et avoir partiel. Il refuse de laisser
 * l'utilisateur croire qu'il « supprime » une facture — une facture émise ne
 * se supprime pas, elle se corrige par un avoir qui la référence.
 */
export function CreditNoteDialog({
  open, onClose, invoiceId, invoiceNumber, totalTTC, creditedAmount, lines, onIssued,
}: CreditNoteDialogProps) {
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, totalTTC - creditedAmount);
  const partiallyCredited = creditedAmount > 0;

  // Estimation locale, à titre indicatif : le serveur recalcule et fait foi.
  const estimate = mode === "full"
    ? remaining
    : lines.reduce((sum, line, i) => {
        const q = quantities[i] || 0;
        if (q <= 0) return sum;
        return sum + Math.round((line.totalTTC / Math.max(1, line.quantity)) * q);
      }, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const selected = Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([index, q]) => ({ lineIndex: Number(index), quantity: q }));

      if (mode === "partial" && selected.length === 0) {
        throw new Error("Sélectionnez au moins une ligne à créditer.");
      }

      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/invoices/${invoiceId}/credit-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(
          mode === "full"
            ? { mode: "full", reason }
            : { lines: selected, reason }
        ),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Émission refusée");
      onIssued();
      onClose();
      setReason("");
      setQuantities({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Émission impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Avoir sur la facture ${invoiceNumber}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink2 bg-surface2 border border-line rounded-lg px-3 py-2.5">
          Une facture émise ne se supprime pas. L&apos;avoir est le seul moyen de la
          corriger&nbsp;: il porte son propre numéro, sa propre écriture d&apos;extourne,
          et référence la facture d&apos;origine.
        </p>

        {error && (
          <p className="px-3 py-2 bg-neg-50 border border-neg/25 rounded-lg text-sm text-neg">{error}</p>
        )}

        {partiallyCredited && (
          <p className="px-3 py-2 bg-warn-50 border border-warn/25 rounded-lg text-sm text-warn">
            Cette facture a déjà fait l&apos;objet d&apos;avoirs pour{" "}
            <strong className="num">{fullXof(creditedAmount)}</strong>. Restant créditable&nbsp;:{" "}
            <strong className="num">{fullXof(remaining)}</strong>.
          </p>
        )}

        <SegmentedControl
          ariaLabel="Étendue de l'avoir"
          segments={[
            { value: "full", label: "Avoir total" },
            { value: "partial", label: "Avoir partiel" },
          ]}
          value={mode}
          onChange={v => setMode(v as "full" | "partial")}
          size="sm"
        />

        {mode === "partial" && (
          <div className="border border-line rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface2/60 border-b border-line">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-ink3 font-bold">Ligne</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-ink3 font-bold">Facturé</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-ink3 font-bold">À créditer</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <p className="text-ink">{line.description}</p>
                      <p className="text-[11px] text-ink3 num">
                        {line.unitPrice.toLocaleString("fr-FR")} XOF l&apos;unité
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right num text-ink2">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number" min={0} max={line.quantity}
                        className={`${inputCls} w-24 text-right`}
                        value={quantities[i] ?? 0}
                        onChange={e => setQuantities(prev => ({
                          ...prev,
                          // Borné à la quantité facturée : le serveur refuserait
                          // de toute façon, autant l'empêcher à la saisie.
                          [i]: Math.min(line.quantity, Math.max(0, Number(e.target.value) || 0)),
                        }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FormField label="Motif de l'avoir" required
          hint="Il figure sur le document et justifie la correction devant l'administration.">
          <textarea className={textareaCls} rows={2} value={reason} required
            placeholder="Retour de marchandise, erreur de facturation, remise accordée…"
            onChange={e => setReason(e.target.value)} />
        </FormField>

        <div className="rounded-lg bg-section-soft border border-section/20 px-4 py-3">
          <p className="text-xs text-ink2">Montant de l&apos;avoir (estimation)</p>
          <p className="text-lg font-bold text-ink num">{fullXof(estimate)}</p>
          <p className="text-[11px] text-ink2 mt-1">
            Le serveur recalcule les totaux ligne par ligne&nbsp;: c&apos;est son calcul qui fait foi.
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-line">
          <button type="button" onClick={onClose}
            className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            Annuler
          </button>
          <button type="submit" disabled={saving || !reason.trim()}
            className="px-5 h-10 rounded-lg bg-neg text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Émission…" : "Émettre l'avoir"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
