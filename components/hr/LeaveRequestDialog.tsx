"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { LEAVE_TYPES } from "@/lib/leave-types";

import { buttonClass } from "@/components/ui/button-class";

import { csrfToken as getCsrfToken } from "@/lib/api-client";
/** Demande (ou saisie pour un salarié, depuis sa fiche) d'un congé / absence. */
export function RequestDialog({ onClose, onDone, employeeId }: { onClose: () => void; onDone: () => void; employeeId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: "annual", startDate: today, endDate: today, halfDayStart: false, halfDayEnd: false, reason: "" });
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/leaves", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: JSON.stringify({ ...f, employeeId }) });
    const x = await res.json().catch(() => ({}));
    if (!res.ok) { setError(x.error || "Demande refusée"); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={employeeId ? "Saisir un congé" : "Demander un congé"}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Type">
          <select className={selectCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>
            {Object.entries(LEAVE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Du" required><input type="date" className={inputCls} value={f.startDate} onChange={e => setF(p => ({ ...p, startDate: e.target.value, endDate: p.endDate < e.target.value ? e.target.value : p.endDate }))} /></FormField>
          <FormField label="Au" required><input type="date" className={inputCls} value={f.endDate} min={f.startDate} onChange={e => setF(p => ({ ...p, endDate: e.target.value }))} /></FormField>
        </div>
        <div className="flex gap-4 text-sm text-ink2">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-section" checked={f.halfDayStart} onChange={e => setF(p => ({ ...p, halfDayStart: e.target.checked }))} /> Demi-journée le premier jour</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-section" checked={f.halfDayEnd} onChange={e => setF(p => ({ ...p, halfDayEnd: e.target.checked }))} /> Demi-journée le dernier jour</label>
        </div>
        <FormField label="Motif / commentaire"><textarea className={textareaCls} rows={2} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} /></FormField>
        <button type="submit" className={buttonClass("primary", "md", "w-full")}>Envoyer la demande</button>
      </form>
    </Modal>
  );
}
