"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { FREQUENCIES, LENDER_TYPES, METHODS, type Frequency, type LenderType, type Method } from "@/lib/loan-schedule";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";

interface Inst { _id: string; n: number; dueDate: string; principal: number; interest: number; insurance: number; status: "due" | "paid" | "prior"; paidAt?: string; adjusted?: boolean }
interface Loan {
  _id: string; label: string; lender: string; lenderType?: string; capitalAccountCode?: string; reference?: string; principal: number; annualRate: number; durationMonths: number; frequency: Frequency; method: Method;
  fees: number; collateral?: string; purpose?: string; status: string; startDate: string; disbursedAt?: string; postedFrom?: string; treasuryAccountId?: { label: string };
  installments: Inst[]; state: { remaining: number; next: { dueDate: string; total: number } | null; overdue: { count: number; amount: number }; interestLeft: number };
  totals: { principal: number; interest: number; insurance: number };
}

export default function EmpruntPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const res = useApi<Loan | null>(id ? `/api/loans/${id}` : null, d => d?.data ?? null, null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Inst | null>(null);
  const [repay, setRepay] = useState(false);
  const loan = res.data;
  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const r = await apiSend("POST", `/api/loans/${id}`, body);
    setBusy(false);
    if (!r.ok) { showToast(r.data?.error || "Action refusée.", "error"); return; }
    showToast(okText, "success"); res.reload();
  }
  if (!loan) return <div className="p-6">Chargement…</div>;
  const firstDue = loan.installments.find(i => i.status === "due");
  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <Link href="/emprunts" className="text-xs text-ink2 hover:text-ink">← Emprunts</Link>
          <h1 className="page-title">{loan.label}</h1>
          <p className="text-sm text-ink2">{loan.lender} ({LENDER_TYPES[(loan.lenderType ?? "bank") as LenderType].label.toLowerCase()}, compte {loan.capitalAccountCode ?? "162000"}){loan.reference ? ` · contrat ${loan.reference}` : ""} · {formatMoney(loan.principal)} à {(loan.annualRate * 100).toLocaleString("fr-FR")} %{loan.method === "free" ? "" : ` sur ${loan.durationMonths} mois · ${FREQUENCIES[loan.frequency].label.toLowerCase()}`} · {METHODS[loan.method].toLowerCase()} · {loan.treasuryAccountId?.label}</p>
          {loan.collateral && <p className="text-xs text-ink3">Garanties : {loan.collateral}</p>}
          {loan.postedFrom && <p className="text-xs text-ink3">Suivi comptable à partir du {formatDate(loan.postedFrom)} : échéances antérieures payées hors Kanoo.</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {loan.status === "draft" && <button disabled={busy} onClick={async () => { const d = await promptDialog({ title: "Déblocage des fonds", label: "Date (AAAA-MM-JJ)", defaultValue: loan.startDate.slice(0, 10), confirmLabel: "Comptabiliser" }); if (d) act({ action: "disburse", date: d }, "Déblocage comptabilisé."); }} className={buttonClass("primary", "md")}>Débloquer les fonds</button>}
          {loan.method === "free" && loan.status === "active" && <button disabled={busy} onClick={() => setRepay(true)} className={buttonClass("primary", "md")}>Enregistrer un remboursement</button>}
          {loan.status === "active" && loan.disbursedAt && !loan.installments.some(i => i.status === "paid") && <button disabled={busy} onClick={async () => { const r = await promptDialog({ title: "Annuler le déblocage ?", message: "L'écriture est extournée et la trésorerie corrigée.", label: "Motif", required: true, confirmLabel: "Annuler le déblocage" }); if (r) act({ action: "undisburse", reason: r }, "Déblocage annulé."); }} className={buttonClass("secondary", "md")}>Annuler le déblocage</button>}
          {loan.status === "draft" && <button disabled={busy} onClick={async () => { if (await confirmDialog({ title: "Supprimer cet emprunt ?", danger: true })) { const r = await apiSend("DELETE", `/api/loans/${id}`); if (r.ok) router.push("/emprunts"); else showToast(r.data?.error || "Suppression refusée.", "error"); } }} className={buttonClass("secondary", "md")}>Supprimer</button>}
        </div>
      </div>
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Capital restant dû</p><p className="text-xl font-bold">{formatMoney(loan.state.remaining)}</p></div>
        <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Prochaine échéance</p><p className="text-xl font-bold">{loan.state.next ? formatMoney(loan.state.next.total) : "—"}</p><p className="text-[11px] text-ink3">{loan.state.next ? formatDate(loan.state.next.dueDate) : ""}</p></div>
        <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Coût total du crédit</p><p className="text-xl font-bold">{formatMoney(loan.totals.interest + loan.totals.insurance + loan.fees)}</p><p className="text-[11px] text-ink3">intérêts, assurance, frais</p></div>
        <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">En retard</p><p className={`text-xl font-bold ${loan.state.overdue.count ? "text-neg" : ""}`}>{formatMoney(loan.state.overdue.amount)}</p></div>
      </div>
      <section className="surface-card overflow-hidden">
        <h2 className="font-semibold text-ink px-5 py-3 border-b border-line">Tableau d&apos;amortissement</h2>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>N°</th><th>Échéance</th><th className="text-right">Capital</th><th className="text-right">Intérêts</th><th className="text-right">Assurance</th><th className="text-right">Total</th><th>État</th><th /></tr></thead>
            <tbody>{loan.installments.map(i => (
              <tr key={i._id} className="border-t border-line">
                <td>{i.n}</td>
                <td className="text-xs">{formatDate(i.dueDate)}{i.adjusted && <span className="block text-ink3">ajustée</span>}</td>
                <td className="text-right font-mono">{formatMoney(i.principal)}</td>
                <td className="text-right font-mono">{formatMoney(i.interest)}</td>
                <td className="text-right font-mono">{i.insurance ? formatMoney(i.insurance) : "—"}</td>
                <td className="text-right font-mono font-semibold">{formatMoney(i.principal + i.interest + i.insurance)}</td>
                <td>{i.status === "paid" ? <Pill tone="pos">Payée {i.paidAt ? formatDate(i.paidAt) : ""}</Pill> : i.status === "prior" ? <Pill tone="mute">Avant reprise</Pill> : new Date(i.dueDate) < new Date() ? <Pill tone="neg">En retard</Pill> : <Pill tone="info">À venir</Pill>}</td>
                <td className="text-right whitespace-nowrap">
                  {i.status === "due" && loan.status === "active" && loan.method !== "free" && firstDue?._id === i._id && <button disabled={busy} onClick={async () => { const d = await promptDialog({ title: `Payer l'échéance n° ${i.n}`, message: `${formatMoney(i.principal + i.interest + i.insurance)} débités du compte de l'emprunt.`, label: "Date du prélèvement (AAAA-MM-JJ)", defaultValue: i.dueDate.slice(0, 10) > todayLocal() ? todayLocal() : i.dueDate.slice(0, 10), confirmLabel: "Comptabiliser" }); if (d) act({ action: "pay", installmentId: i._id, date: d }, `Échéance n° ${i.n} payée.`); }} className="px-2 h-7 rounded border border-line2 text-xs font-semibold hover:bg-surface2">Payer</button>}
                  {i.status === "due" && loan.method !== "free" && <button disabled={busy} onClick={() => setEdit(i)} className="ml-1 px-2 h-7 rounded border border-line2 text-xs hover:bg-surface2">Ajuster</button>}
                  {i.status === "paid" && <button disabled={busy} onClick={async () => { const r = await promptDialog({ title: `Annuler le paiement n° ${i.n} ?`, label: "Motif", required: true, confirmLabel: "Annuler le paiement" }); if (r) act({ action: "cancel", installmentId: i._id, reason: r }, "Paiement annulé."); }} className="px-2 h-7 rounded border border-line2 text-xs hover:bg-surface2">Annuler</button>}
                </td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="border-t border-line font-semibold"><td colSpan={2}>Total</td><td className="text-right font-mono">{formatMoney(loan.totals.principal)}</td><td className="text-right font-mono">{formatMoney(loan.totals.interest)}</td><td className="text-right font-mono">{formatMoney(loan.totals.insurance)}</td><td className="text-right font-mono">{formatMoney(loan.totals.principal + loan.totals.interest + loan.totals.insurance)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      </section>
      {repay && <RepayDialog onClose={() => setRepay(false)} onSave={b => { setRepay(false); act({ action: "repay", ...b }, "Remboursement enregistré."); }} />}
      {edit && <AdjustDialog inst={edit} onClose={() => setEdit(null)} onSave={body => { setEdit(null); act({ action: "adjust", installmentId: edit._id, ...body }, "Échéance ajustée."); }} />}
    </div>
  );
}

function RepayDialog({ onClose, onSave }: { onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ principal: "", interest: "", date: todayLocal(), treasuryAccountId: "" });
  const u = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title="Remboursement" size="sm">
      <div className="space-y-3">
        <FormField label="Capital remboursé (FCFA)"><input type="number" min={0} className={inputCls} value={v.principal} onChange={u("principal")} /></FormField>
        <FormField label="Intérêts payés (FCFA)" hint="0 pour un prêt sans intérêt"><input type="number" min={0} className={inputCls} value={v.interest} onChange={u("interest")} /></FormField>
        <FormField label="Date"><input type="date" className={inputCls} value={v.date} max={todayLocal()} onChange={u("date")} /></FormField>
        <FormField label="Payé depuis" hint="Vide : le compte de l'emprunt"><TreasuryAccountSelect value={v.treasuryAccountId} onChange={x => setV(p => ({ ...p, treasuryAccountId: x }))} autoSelect={false} /></FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={!(Number(v.principal) + Number(v.interest) > 0)} onClick={() => onSave({ principal: Number(v.principal) || 0, interest: Number(v.interest) || 0, date: v.date, treasuryAccountId: v.treasuryAccountId || undefined })} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}

function AdjustDialog({ inst, onClose, onSave }: { inst: Inst; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ dueDate: inst.dueDate.slice(0, 10), principal: String(inst.principal), interest: String(inst.interest), insurance: String(inst.insurance) });
  const u = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={`Ajuster l'échéance n° ${inst.n}`} size="sm">
      <div className="space-y-3">
        <p className="text-xs text-ink2">Reprenez les montants du tableau remis par la banque. Si le capital change, la dernière échéance absorbe l&apos;écart pour que le total reste égal au capital emprunté.</p>
        <FormField label="Date"><input type="date" className={inputCls} value={v.dueDate} onChange={u("dueDate")} /></FormField>
        <FormField label="Capital"><input type="number" min={0} className={inputCls} value={v.principal} onChange={u("principal")} /></FormField>
        <FormField label="Intérêts"><input type="number" min={0} className={inputCls} value={v.interest} onChange={u("interest")} /></FormField>
        <FormField label="Assurance"><input type="number" min={0} className={inputCls} value={v.insurance} onChange={u("insurance")} /></FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={() => onSave({ dueDate: v.dueDate, principal: Number(v.principal), interest: Number(v.interest), insurance: Number(v.insurance) })} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
