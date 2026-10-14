"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField, inputCls } from "@/components/ui/FormField";
import { showToast } from "@/components/ui/Toast";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

interface Preview { stockValue: number; ledgerBalance: number; variation: number; alreadyPosted: boolean }

/**
 * Écriture de variation de stock en fin de période (inventaire intermittent) :
 * le compte 31 rejoint la valeur réelle des marchandises en magasin.
 */
export function StockVariationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const d = new Date(); d.setDate(0); // dernier jour du mois précédent
    return d.toISOString().slice(0, 10);
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPreview(null);
    api.get<Preview>("/api/accounting/stock-variation", { query: { date } }).then(setPreview)
      .catch(e => showToast(apiErrorMessage(e, "Calcul impossible."), "error"));
  }, [date]);

  async function post() {
    setSaving(true);
    try {
      await api.post("/api/accounting/stock-variation", { date });
      showToast("Variation de stock comptabilisée.", "success");
      onDone();
    } catch (e) { showToast(apiErrorMessage(e, "Écriture impossible."), "error"); }
    finally { setSaving(false); }
  }

  const v = preview?.variation ?? 0;
  return (
    <Modal open onClose={onClose} title="Variation de stock" size="md"
      description="Fin de période : le compte de stock (31) est aligné sur la valeur des marchandises en magasin, au coût moyen pondéré."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
        <Button onClick={post} loading={saving} disabled={!preview || preview.alreadyPosted || v === 0}>Passer l&apos;écriture</Button>
      </>}>
      <div className="space-y-4">
        <FormField label="Date de l'inventaire"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></FormField>
        {!preview ? <div className="h-24 rounded-xl bg-surface2 animate-pulse" /> : (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-ink3">Valeur du stock</dt><dd className="num font-semibold">{formatMoney(preview.stockValue)}</dd></div>
            <div><dt className="text-xs text-ink3">Compte 31 au bilan</dt><dd className="num font-semibold">{formatMoney(preview.ledgerBalance)}</dd></div>
            <div><dt className="text-xs text-ink3">Variation</dt><dd className={`num font-semibold ${v > 0 ? "text-pos" : v < 0 ? "text-neg" : ""}`}>{v > 0 ? "+" : ""}{formatMoney(v)}</dd></div>
          </dl>
        )}
        {preview?.alreadyPosted && <p className="text-xs text-warn">Déjà passée à cette date : extournez l&apos;écriture pour la refaire.</p>}
        {preview && !preview.alreadyPosted && v !== 0 && (
          <p className="text-xs text-ink2">{v > 0 ? "Stock en hausse : 311000 au débit, 603100 au crédit (diminue les achats consommés)." : "Stock en baisse : 603100 au débit, 311000 au crédit."}</p>
        )}
      </div>
    </Modal>
  );
}
