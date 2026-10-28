"use client";
import { useState } from "react";
import { CalendarRange, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { scheduleBase, scheduleState, splitEvenly, validateSchedule, type InstallmentLike } from "@/lib/installments";

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: "réglé", cls: "text-pos" }, partial: { label: "en partie réglé", cls: "text-warn" },
  due: { label: "à venir", cls: "text-ink2" }, late: { label: "en retard", cls: "text-neg" },
};

/**
 * Échéancier de paiement de la facture : versements datés convenus avec le
 * client. Les règlements s'imputent dans l'ordre ; relances et retards
 * suivent le versement en cours.
 */
export function SchedulePanel({ invoiceId, invoice, canEdit, onChange }: {
  invoiceId: string; invoice: InstallmentLike & { status: string }; canEdit: boolean; onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const base = scheduleBase(invoice);
  const state = scheduleState(invoice);
  const editable = canEdit && !["cancelled", "paid", "written_off"].includes(invoice.status);
  if (!invoice.installments?.length && !editable) return null;

  return (
    <section className="surface-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><CalendarRange size={16} /> Échéancier de paiement</h2>
        {editable && <button onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>{invoice.installments?.length ? "Modifier" : "Étaler le paiement"}</button>}
      </div>
      {invoice.installments?.length ? (
        <>
          <ul className="divide-y divide-line text-sm">
            {state.rows.map((r, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between gap-3">
                <span className="text-ink">{r.label || `Versement ${i + 1}`} · {new Date(r.dueDate).toLocaleDateString("fr-FR")}</span>
                <span className="inline-flex items-center gap-3"><span className="font-mono">{formatMoney(r.amount)}</span><span className={`text-xs ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></span>
              </li>
            ))}
          </ul>
          {state.dueNow > 0 && <p className="text-sm text-neg">Exigible à ce jour : <b>{formatMoney(state.dueNow)}</b></p>}
        </>
      ) : <p className="text-sm text-ink3">Paiement en une fois, à l&apos;échéance. Un échéancier étale le montant dû ({formatMoney(base)}) en versements datés.</p>}
      {open && <ScheduleDialog invoiceId={invoiceId} base={base} current={invoice.installments ?? []} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChange(); }} />}
    </section>
  );
}

function ScheduleDialog({ invoiceId, base, current, onClose, onSaved }: {
  invoiceId: string; base: number; current: NonNullable<InstallmentLike["installments"]>; onClose: () => void; onSaved: () => void;
}) {
  const [rows, setRows] = useState(current.length ? current.map(r => ({ dueDate: day(r.dueDate), amount: String(r.amount), label: r.label ?? "" }))
    : splitEvenly(base, 3, new Date()).map(r => ({ dueDate: day(r.dueDate), amount: String(r.amount), label: r.label ?? "" })));
  const [n, setN] = useState(String(current.length || 3));
  const [busy, setBusy] = useState(false);
  const list = rows.map(r => ({ dueDate: r.dueDate, amount: Number(r.amount) || 0, label: r.label || undefined }));
  const total = list.reduce((t, r) => t + r.amount, 0);
  const err = validateSchedule(base, list);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(installments: typeof list) {
    setBusy(true);
    const res = await apiSend("PUT", `/api/invoices/${invoiceId}/schedule`, { installments });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Échéancier refusé.", "error"); return; }
    showToast(installments.length ? "Échéancier enregistré." : "Échéancier retiré.", "success");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Échéancier de paiement" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Montant à étaler : <b className="text-ink">{formatMoney(base)}</b> (TTC, avoirs et retenue de garantie déduits). Les règlements déjà reçus s&apos;imputent sur les premiers versements.</p>
        <div className="flex items-end gap-2">
          <FormField label="Versements égaux"><input type="number" min={1} max={36} className={inputCls} value={n} onChange={e => setN(e.target.value)} /></FormField>
          <button onClick={() => setRows(splitEvenly(base, Number(n) || 1, new Date(rows[0]?.dueDate || new Date())).map(r => ({ dueDate: day(r.dueDate), amount: String(r.amount), label: r.label ?? "" })))} className={buttonClass("secondary", "md")}>Répartir chaque mois</button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={`${inputCls} col-span-4`} value={r.label} maxLength={80} placeholder={`Versement ${i + 1}`} onChange={e => set(i, { label: e.target.value })} aria-label="Libellé" />
              <input type="date" className={`${inputCls} col-span-4`} value={r.dueDate} onChange={e => set(i, { dueDate: e.target.value })} aria-label="Date" />
              <input type="number" min={1} className={`${inputCls} col-span-3`} value={r.amount} onChange={e => set(i, { amount: e.target.value })} aria-label="Montant" />
              <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="col-span-1 p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setRows(rs => [...rs, { dueDate: day(new Date()), amount: "", label: "" }])} className={buttonClass("ghost", "sm")}><Plus size={14} /> Ajouter un versement</button>
        </div>
        <p className={`text-sm ${err ? "text-neg" : "text-pos"}`}>Total : {formatMoney(total)}{err ? ` — ${err}` : " — conforme"}</p>
        <div className="flex justify-between gap-2">
          {current.length > 0 ? <button disabled={busy} onClick={() => save([])} className={buttonClass("ghost", "md")}>Retirer l&apos;échéancier</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
            <button disabled={busy || !!err} onClick={() => save(list)} className={buttonClass("primary", "md")}>Enregistrer</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
