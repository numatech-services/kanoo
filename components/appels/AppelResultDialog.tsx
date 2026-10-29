"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";

/** Motifs de rejet (models/AppelCandidature, LOSS_REASONS). */
export const LOSS_LABEL: Record<string, string> = {
  prix: "Prix plus élevé", technique: "Offre technique insuffisante", administratif: "Pièce administrative manquante ou non conforme",
  hors_delai: "Déposé hors délai", non_conforme: "Offre non conforme", infructueux: "Appel déclaré infructueux", autre: "Autre motif",
};

export interface AppelResultInput { offerAmount: string; winnerName: string; winnerAmount: string; rank: string; lossReason: string; notes: string }

/**
 * Décision sur une offre (obtenue / non retenue), saisie avec son contexte :
 * montant offert, rang, et — si elle est perdue — motif, attributaire et son
 * prix. Le motif est exigé par l'API : il alimente les statistiques.
 */
export function AppelResultDialog({ outcome, title, onClose, onSave }: {
  outcome: "won" | "lost"; title?: string; onClose: () => void;
  onSave: (result: AppelResultInput) => Promise<void> | void;
}) {
  const [r, setR] = useState<AppelResultInput>({ offerAmount: "", winnerName: "", winnerAmount: "", rank: "", lossReason: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof AppelResultInput) => (e: { target: { value: string } }) => setR(x => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={outcome === "won" ? `Offre retenue${title ? ` — ${title}` : ""}` : `Offre non retenue${title ? ` — ${title}` : ""}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant de notre offre (FCFA)"><input type="number" min={0} className={inputCls} value={r.offerAmount} onChange={set("offerAmount")} /></FormField>
          <FormField label="Rang obtenu"><input type="number" min={1} className={inputCls} value={r.rank} onChange={set("rank")} /></FormField>
        </div>
        {outcome === "lost" && (<>
          <FormField label="Motif du rejet" required>
            <select className={selectCls} value={r.lossReason} onChange={set("lossReason")}>
              <option value="">Choisir…</option>
              {Object.entries(LOSS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Attributaire"><input className={inputCls} value={r.winnerName} onChange={set("winnerName")} /></FormField>
            <FormField label="Son prix (FCFA)"><input type="number" min={0} className={inputCls} value={r.winnerAmount} onChange={set("winnerAmount")} /></FormField>
          </div>
        </>)}
        <FormField label="Observations"><textarea className={textareaCls} rows={2} value={r.notes} onChange={set("notes")} /></FormField>
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={saving || (outcome === "lost" && !r.lossReason)}
            onClick={async () => { setSaving(true); try { await onSave(r); } finally { setSaving(false); } }}
            className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : "Enregistrer le résultat"}</button>
        </div>
      </div>
    </Modal>
  );
}
