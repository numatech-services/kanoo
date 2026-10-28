"use client";
import { useState } from "react";
import { FileText, Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { SALE_METHOD_LABEL } from "@/components/comptoir/SalesTab";

const MONEY = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const h = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Closing { day: string; theoreticalCash: number; countedCash: number; gap: number; notes?: string; closedBy?: { firstName?: string; lastName?: string } | null }
interface DayData {
  byMethod: Array<{ method: string; receipts: number; expenses: number }>;
  cashNet: number; salesCount: number; salesTTC: number; marginHT?: number;
  closing: Closing | null; locked: boolean;
}

/**
 * Arrêté de caisse ENREGISTRÉ : théorique par moyen de paiement, fonds de
 * caisse, espèces comptées, écart comptabilisé (658 / 758) et journée
 * verrouillée. Imprimable avec les visas.
 */
export function ClosingDialog({ deskId, deskName, onClose, onClosed }: { deskId: string; deskName: string; onClose: () => void; onClosed: () => void }) {
  const [day, setDay] = useState(localDay());
  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, reload } = useApi<{ day: DayData; lastClosedDay: string | null } | null>(
    day ? `/api/comptoir/closings?deskId=${deskId}&day=${day}` : null, d => d?.data ?? null, null);
  const d = data?.day;
  const closing = d?.closing ?? null;
  const theoretical = closing ? closing.theoreticalCash : (Number(float) || 0) + (d?.cashNet ?? 0);
  const gap = closing ? closing.gap : counted !== "" ? Number(counted) - theoretical : null;
  const receipts = d?.byMethod.reduce((t, m) => t + m.receipts, 0) ?? 0;
  const expenses = d?.byMethod.reduce((t, m) => t + m.expenses, 0) ?? 0;

  async function close() {
    if (counted === "") { showToast("Saisissez les espèces comptées.", "error"); return; }
    const ok = await confirmDialog({
      title: `Arrêter la caisse du ${new Date(day).toLocaleDateString("fr-FR")} ?`,
      message: gap ? `Écart de ${MONEY(gap)} comptabilisé en ${gap < 0 ? "manquant (658)" : "excédent (758)"}. La journée ne pourra plus être modifiée.` : "Caisse juste. La journée ne pourra plus être modifiée.",
      confirmLabel: "Arrêter la journée",
    });
    if (!ok) return;
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/closings", { deskId, day, countedCash: Number(counted), openingFloat: Number(float) || 0, notes: notes || undefined });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Arrêté refusé.", "error"); return; }
    showToast("Journée arrêtée.", "success"); reload(); onClosed();
  }

  function print() {
    if (!d) return;
    const rows = d.byMethod.map(m => `<tr><td>${h(SALE_METHOD_LABEL[m.method] || m.method)}</td><td class="r">${h(MONEY(m.receipts))}</td><td class="r">${h(MONEY(m.expenses))}</td><td class="r">${h(MONEY(m.receipts - m.expenses))}</td></tr>`).join("");
    const countedV = closing ? closing.countedCash : Number(counted) || 0;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Arrêté de caisse ${h(day)}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:32px;color:#111}h1{font-size:18px}
      table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px;text-align:left}.r{text-align:right}
      .tot{margin-top:16px;font-size:14px}.tot div{display:flex;justify-content:space-between;padding:4px 0}</style></head>
      <body><h1>Arrêté de caisse — ${h(deskName)} — ${h(new Date(day).toLocaleDateString("fr-FR"))}</h1>
      ${closing ? "<p><b>Journée arrêtée et verrouillée.</b></p>" : "<p><i>Projet : journée non encore arrêtée.</i></p>"}
      <table><thead><tr><th>Moyen</th><th class="r">Recettes</th><th class="r">Dépenses</th><th class="r">Net</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Tickets du jour</span><strong>${d.salesCount} — ${h(MONEY(d.salesTTC))}</strong></div>
        <div><span>Solde théorique espèces (fonds compris)</span><strong>${h(MONEY(theoretical))}</strong></div>
        <div><span>Espèces comptées</span><strong>${h(MONEY(countedV))}</strong></div>
        <div><span>Écart</span><strong>${h(MONEY(gap ?? 0))}</strong></div>
      </div>
      ${(closing?.notes || notes) ? `<p>Observations : ${h(closing?.notes || notes)}</p>` : ""}
      <p style="margin-top:32px;font-size:12px">Visa du caissier : ____________________  Visa du gestionnaire : ____________________  Visa du comptable : ____________________</p>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  return (
    <Modal open onClose={onClose} title="Arrêté de caisse" size="md">
      <div className="space-y-4">
        <FormField label="Journée" hint={data?.lastClosedDay ? `Dernière journée arrêtée : ${new Date(data.lastClosedDay).toLocaleDateString("fr-FR")}` : undefined}>
          <input className={inputCls} type="date" value={day} max={localDay()} onChange={e => setDay(e.target.value)} />
        </FormField>
        {d && (
          <div className="surface-card p-4 text-sm space-y-1">
            {d.byMethod.length === 0 && <p className="text-ink2">Aucune écriture ce jour-là.</p>}
            {d.byMethod.map(m => (
              <div key={m.method} className="flex justify-between"><span className="text-ink2">{SALE_METHOD_LABEL[m.method] || m.method}</span>
                <span className="font-mono">+{MONEY(m.receipts)}{m.expenses ? ` / −${MONEY(m.expenses)}` : ""}</span></div>
            ))}
            <div className="flex justify-between border-t border-line pt-1"><span className="text-ink2">Recettes / dépenses</span><span className="font-mono">{MONEY(receipts)} / {MONEY(expenses)}</span></div>
            <div className="flex justify-between"><span className="text-ink2">Tickets</span><span className="font-mono">{d.salesCount} — {MONEY(d.salesTTC)}</span></div>
            {d.marginHT !== undefined && <div className="flex justify-between"><span className="text-ink2">Marge brute HT des tickets</span><span className="font-mono">{MONEY(d.marginHT)}</span></div>}
            <div className="flex justify-between font-semibold border-t border-line pt-1"><span>Solde théorique espèces</span><span className="font-mono">{MONEY(theoretical)}</span></div>
          </div>
        )}
        {closing ? (
          <p className="px-4 py-3 rounded-xl text-sm bg-surface2 text-ink inline-flex gap-2"><Lock size={15} /> Arrêtée{closing.closedBy ? ` par ${closing.closedBy.firstName ?? ""} ${closing.closedBy.lastName ?? ""}` : ""} : {MONEY(closing.countedCash)} comptés, écart {MONEY(closing.gap)}.</p>
        ) : d?.locked ? (
          <p className="px-4 py-3 rounded-xl text-sm bg-surface2 text-ink2">Une journée postérieure est déjà arrêtée : celle-ci est verrouillée.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Fonds de caisse du matin"><input className={inputCls} type="number" min="0" value={float} onChange={e => setFloat(e.target.value)} /></FormField>
              <FormField label="Espèces comptées" required><input className={inputCls} type="number" min="0" value={counted} onChange={e => setCounted(e.target.value)} /></FormField>
            </div>
            <FormField label="Observations"><input className={inputCls} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></FormField>
          </>
        )}
        {gap !== null && (
          <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${gap === 0 ? "bg-pos-50 text-pos border border-pos/25" : "bg-warn-50 text-warn border border-warn/25"}`}>
            {gap === 0 ? "Caisse juste — aucun écart." : `Écart : ${gap > 0 ? "+" : ""}${MONEY(gap)} (${gap > 0 ? "excédent" : "manquant"}).`}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button>
          <button onClick={print} disabled={!d} className={buttonClass("secondary", "md")}><FileText size={15} /> Imprimer</button>
          {!closing && !d?.locked && <button onClick={close} disabled={busy || counted === ""} className={buttonClass("primary", "md")}><Lock size={15} /> Arrêter la journée</button>}
        </div>
      </div>
    </Modal>
  );
}
