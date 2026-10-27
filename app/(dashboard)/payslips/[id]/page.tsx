"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Printer, Banknote, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { useMe, meCanDo } from "@/lib/useMe";

import {apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { buttonClass } from "@/components/ui/button-class";
interface Payslip {
  _id: string; month: number; year: number;
  grossSalary: number; grossTotal?: number; seniorityRate?: number; seniorityAmount?: number;
  cnssEmployee: number; cnssEmployer: number; incomeTax?: number; netImposable?: number;
  otherDeductions: number; netSalary: number; employerCost?: number; isPaid: boolean; paidAt?: string;
  items?: Array<{ label: string; amount: number; type: "addition" | "deduction"; subject?: boolean }>;
  cnssBase?: number; cnssRates?: { employee: number; employer: number }; cnssCategory?: string;
  cnssBranches?: { pf: number; atmp: number; pensions: number; anpe: number };
  benefitsInKind?: number; benefitsDetail?: Array<{ label: string; amount: number }>; expatAllowance?: number;
  familyCharges?: number;
  itsDetail?: { bareme: string; tauxFamille: number; retraite: number; expatrie: number; assurance: number; fraisProfessionnels: number; chargesFamille: number };
  employeeId: {
    firstName: string; lastName: string; code: string; position?: string; department?: string; employeeType?: string;
    cnssNumber?: string; nif?: string; bankAccount?: string; bankName?: string; startDate?: string; contractNature?: string;
  } | null;
  employer?: { name?: string; nif?: string; rccm?: string; address?: string; phone?: string; email?: string; logo?: string } | null;
}

const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const pct = (t: number) => `${(t * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

export default function PayslipDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canPay = meCanDo(me, "payslips", "update");
  const canDelete = meCanDo(me, "payslips", "delete");
  // Squelette au premier chargement seulement : après un paiement, le bulletin reste affiché pendant la relecture.
  const { data: p, loaded, reload: load } = useApi<Payslip | null>(id ? `/api/payslips/${id}` : null, d => d?.data ?? null, null);
  const loading = !loaded;
  const [payOpen, setPayOpen] = useState(false);

  async function remove() {
    if (!(await confirmDialog({ title: "Supprimer ce bulletin ?", message: "Son écriture de paie sera extournée.", danger: true, confirmLabel: "Supprimer" }))) return;
    const res = await apiSend("DELETE", `/api/payslips/${id}`);
    if (!res.ok) { const d = res.data; showToast(d.error || "Suppression impossible", "error"); return; }
    router.push("/payslips");
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  if (!p) return <div className="p-6 text-ink2 text-center bg-surface rounded-xl border border-line">Bulletin introuvable</div>;

  const emp = p.employeeId;
  const er = p.employer ?? {};
  const additions = (p.items ?? []).filter(i => i.type === "addition");
  const deductions = (p.items ?? []).filter(i => i.type === "deduction");
  const isEmployee = (emp?.employeeType ?? "employee") === "employee";
  // Bulletins émis avant la mise à jour : ni taux enregistrés ni détail ITS ;
  // on affiche les taux que Kanoo appliquait alors.
  const cnssRate = p.cnssRates?.employee ?? 0.036;
  const itsNew = p.itsDetail?.bareme === "its";
  const rows: Array<[string, string, number, "gain" | "retenue" | "total"]> = [
    [isEmployee ? "Salaire de base" : emp?.employeeType === "intern" ? "Indemnité de stage" : "Honoraires", "", p.grossSalary, "gain"],
    // Taux d'ancienneté stocké en fraction (0,04 = 4 %).
    ...(p.seniorityAmount ? [["Prime d'ancienneté", pct(p.seniorityRate ?? 0), p.seniorityAmount, "gain"] as [string, string, number, "gain"]] : []),
    ...(p.expatAllowance ? [["Indemnité de dépaysement", "", p.expatAllowance, "gain"] as [string, string, number, "gain"]] : []),
    ...additions.map(i => [i.subject === false ? `${i.label} (non soumis)` : i.label, "", i.amount, "gain"] as [string, string, number, "gain"]),
    ["Salaire brut", "", p.grossTotal ?? p.grossSalary, "total"],
    ...(p.cnssEmployee ? [["Cotisation CNSS salariale", p.cnssBase ? `${pct(cnssRate)} × ${fmt(p.cnssBase)}` : pct(cnssRate), p.cnssEmployee, "retenue"] as [string, string, number, "retenue"]] : []),
    ...(p.incomeTax ? [[itsNew ? "Impôt sur les traitements et salaires (ITS)" : "Impôt sur le revenu (IR)", itsNew ? `base ${fmt(p.netImposable)}` : "barème", p.incomeTax, "retenue"] as [string, string, number, "retenue"]] : []),
    ...deductions.map(i => [i.label, "", i.amount, "retenue"] as [string, string, number, "retenue"]),
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <Link href="/payslips" className="text-xs font-semibold text-ink2 hover:text-section">← Bulletins de paie</Link>
          <h1 className="page-title mt-1">{emp ? `${emp.firstName} ${emp.lastName}` : "Bulletin"} — {MONTHS[p.month]} {p.year}</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => window.print()} className={buttonClass("secondary", "md")}>
            <Printer size={16} /> Imprimer / PDF
          </button>
          {!p.isPaid && canDelete && (
            <button onClick={remove} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">
              <Trash2 size={15} /> Supprimer
            </button>
          )}
          {!p.isPaid ? (canPay && (
            <button onClick={() => setPayOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-pos text-onink text-sm font-semibold hover:brightness-95">
              <Banknote size={16} /> Payer le salaire
            </button>
          )) : (
            <span className="px-4 h-10 inline-flex items-center rounded-lg bg-pos-50 border border-pos/25 text-pos text-sm font-semibold">
              Payé le {p.paidAt ? new Date(p.paidAt).toLocaleDateString("fr-FR") : "—"}
            </span>
          )}
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-line overflow-hidden print:border-none print:rounded-none">
        <div className="p-6 flex justify-between items-start gap-6 border-b border-line">
          <div className="flex gap-3 items-start">
            {er.logo && <img src={er.logo} alt="" className="h-14 w-14 object-contain" />}
            <div className="text-sm">
              <p className="font-bold text-ink text-base">{er.name || "Employeur"}</p>
              {er.address && <p className="text-ink2">{er.address}</p>}
              <p className="text-ink2">{[er.nif && `NIF ${er.nif}`, er.rccm && `RCCM ${er.rccm}`].filter(Boolean).join(" · ")}</p>
              {er.phone && <p className="text-ink2">{er.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-ink uppercase">Bulletin de paie</p>
            <p className="text-ink2 font-mono text-sm">{MONTHS[p.month]} {p.year}</p>
          </div>
        </div>

        {emp && (
          <div className="p-6 grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm border-b border-line bg-surface2/30">
            <p><span className="text-ink3">Salarié :</span> <b>{emp.firstName} {emp.lastName}</b></p>
            <p><span className="text-ink3">Matricule :</span> {emp.code}</p>
            <p><span className="text-ink3">Emploi :</span> {emp.position || "—"}</p>
            <p><span className="text-ink3">Entrée :</span> {emp.startDate ? new Date(emp.startDate).toLocaleDateString("fr-FR") : "—"}</p>
            <p><span className="text-ink3">N° CNSS :</span> {emp.cnssNumber || "—"}</p>
            <p><span className="text-ink3">NIF :</span> {emp.nif || "—"}</p>
            <p className="sm:col-span-2"><span className="text-ink3">Paiement :</span> {[emp.bankName, emp.bankAccount].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        )}

        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface2/60 text-ink2 text-xs uppercase">
              <th className="text-left px-6 py-2">Rubrique</th><th className="text-right px-3 py-2">Taux</th>
              <th className="text-right px-3 py-2">Gains</th><th className="text-right px-6 py-2">Retenues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, rate, amount, kind], i) => (
              <tr key={i} className={`border-t border-line ${kind === "total" ? "font-bold bg-surface2/30" : ""}`}>
                <td className="px-6 py-2">{label}</td>
                <td className="px-3 py-2 text-right text-ink2">{rate}</td>
                <td className="px-3 py-2 text-right font-mono">{kind !== "retenue" ? fmt(amount) : ""}</td>
                <td className="px-6 py-2 text-right font-mono">{kind === "retenue" ? fmt(amount) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <div className="p-6 grid sm:grid-cols-3 gap-4 border-t border-line">
          <div><p className="text-xs text-ink3">{itsNew ? "Base imposable ITS" : "Net imposable"}</p><p className="font-mono font-semibold">{fmt(p.netImposable ?? (p.grossTotal ?? p.grossSalary) - p.cnssEmployee)} FCFA</p></div>
          <div><p className="text-xs text-ink3">Charges patronales (CNSS{p.cnssRates?.employer ? ` ${pct(p.cnssRates.employer)}` : ""})</p><p className="font-mono font-semibold">{fmt(p.cnssEmployer)} FCFA</p></div>
          <div className="rounded-xl bg-pos-50 border border-pos/25 p-3 text-right">
            <p className="text-xs text-pos font-semibold uppercase">Net à payer</p>
            <p className="text-2xl font-bold text-pos font-mono">{fmt(p.netSalary)} FCFA</p>
          </div>
        </div>
        {(p.benefitsInKind || itsNew) ? (
          <div className="px-6 pb-4 text-xs text-ink2 space-y-1">
            {!!p.benefitsInKind && <p>Avantages en nature (forfaits CGI art. 144, soumis à la CNSS et à l&apos;ITS, non versés) : {(p.benefitsDetail ?? []).map(b => `${b.label} ${fmt(b.amount)}`).join(" · ")} — total {fmt(p.benefitsInKind)} FCFA.</p>}
            {itsNew && p.itsDetail && <p>Base ITS : retraite {fmt(p.itsDetail.retraite)}{p.itsDetail.expatrie ? `, abattement expatrié ${fmt(p.itsDetail.expatrie)}` : ""}{p.itsDetail.assurance ? `, assurance ${fmt(p.itsDetail.assurance)}` : ""}, frais professionnels 13 % {fmt(p.itsDetail.fraisProfessionnels)}, charges de famille ({p.familyCharges ?? 0}, {pct(p.itsDetail.tauxFamille)}) {fmt(p.itsDetail.chargesFamille)} ; arrondie au millier inférieur.</p>}
          </div>
        ) : null}
        <p className="px-6 pb-6 text-[11px] text-ink3">Coût total employeur : {fmt(p.employerCost ?? (p.grossTotal ?? p.grossSalary) + p.cnssEmployer)} FCFA. Pour faire valoir ce que de droit — à conserver sans limitation de durée.</p>
      </div>

      {payOpen && <PayDialog id={String(id)} net={p.netSalary} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); load(); }} />}
    </div>
  );
}

function PayDialog({ id, net, onClose, onPaid }: { id: string; net: number; onClose: () => void; onPaid: () => void }) {
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string; type: string; balance?: number }>>([]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiJson("/api/treasury-accounts").then(d => {
      const list = d.data?.items || [];
      setAccounts(list);
      if (list.length === 1) setAccountId(list[0]._id);
    }).catch(() => {});
  }, []);
  async function pay() {
    if (!accountId) { setError("Choisissez le compte qui paie."); return; }
    setSaving(true); setError("");
    const res = await apiSend("POST", `/api/payslips/${id}/pay`, { treasuryAccountId: accountId, date });
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Paiement impossible"); return; }
    onPaid();
  }
  return (
    <Modal open onClose={onClose} title="Payer le salaire">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Net à payer : <b className="text-ink">{fmt(net)} FCFA</b>. Le décaissement et l&apos;écriture comptable sont enregistrés sur le compte choisi.</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Compte de trésorerie" required>
          <select className={selectCls} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">— Choisir —</option>
            {accounts.map(a => <option key={a._id} value={a._id}>{a.label} ({a.type === "cash" ? "caisse" : a.type === "mobile_money" ? "mobile money" : "banque"}){a.balance !== undefined ? ` — solde ${fmt(a.balance)}` : ""}</option>)}
          </select>
        </FormField>
        <FormField label="Date du versement" required hint="Date à laquelle le virement ou le paiement a réellement eu lieu.">
          <input type="date" className={inputCls} value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} />
        </FormField>
        <button onClick={pay} disabled={saving} className="w-full h-10 rounded-lg bg-pos text-onink text-sm font-semibold disabled:opacity-60">{saving ? "Paiement…" : "Confirmer le paiement"}</button>
      </div>
    </Modal>
  );
}
