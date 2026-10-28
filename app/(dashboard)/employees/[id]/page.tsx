"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit3, LogOut, UserCheck, Link2, CalendarClock, FileSpreadsheet, RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { confirmDialog } from "@/components/ui/Dialogs";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { EmployeeForm, type EmployeeFormData } from "@/components/pme/EmployeeForm";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";
import { RequestDialog } from "@/components/hr/LeaveRequestDialog";
import { useMe, meCan, meCanDo } from "@/lib/useMe";
import { useCostCenters } from "@/components/shared/ImputationFields";
import { LEAVE_TYPES } from "@/lib/leave-types";

import {apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { buttonClass } from "@/components/ui/button-class";
interface Employee {
  _id: string; code: string; firstName: string; lastName: string; position: string; department?: string; costCenter?: string;
  employeeType: string; contractNature: string; startDate: string; endDate?: string; contractEndDate?: string; exitReason?: string;
  cnssNumber?: string; nif?: string; phone?: string; email?: string; isActive: boolean; notes?: string;
  grossSalary?: number; indemnity?: number; indemnityPeriod?: string; bankName?: string; bankAccount?: string; includeCnss?: boolean; includeIr?: boolean;
  otherDeductionLabel?: string; otherDeductionAmount?: number; payrollHidden?: boolean; leaveOpeningBalance?: number;
  userId?: { _id: string; firstName?: string; lastName?: string; email?: string } | null;
}
const TYPE: Record<string, string> = { employee: "Salarié", intern: "Stagiaire", freelance: "Freelance / consultant" };
const CONTRACT: Record<string, string> = { cdi: "CDI", cdd: "CDD", stage: "Convention de stage", freelance: "Contrat freelance", consultant: "Contrat de consultant" };
const MONTHS = ["", "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const d = (s?: string) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");
async function patch(id: string, body: Record<string, unknown>) {
  const res = await apiSend("PATCH", `/api/employees/${id}`, body);
  const x = res.data;
  if (!res.ok) throw new Error(x.error || "Enregistrement impossible.");
  return x.data;
}

function seniority(start: string) {
  const s = new Date(start), n = new Date();
  let m = (n.getFullYear() - s.getFullYear()) * 12 + n.getMonth() - s.getMonth();
  if (n.getDate() < s.getDate()) m--;
  m = Math.max(0, m);
  return m >= 12 ? `${Math.floor(m / 12)} an${m >= 24 ? "s" : ""}${m % 12 ? ` ${m % 12} mois` : ""}` : `${m} mois`;
}

/** Fiche salarié : identité, contrat, paie (accès paie), compte lié, départ, bulletins, congés, documents. */
export default function EmployeeDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const payroll = meCan(me.resources, "payslips");
  const canEdit = meCanDo(me, "employees", "update");
  const canUsers = meCan(me.resources, "users");
  const centers = useCostCenters();
  const [slips, setSlips] = useState<Array<{ _id: string; month: number; year: number; netSalary: number; isPaid: boolean }>>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [error, setError] = useState("");

  const { data: e, reload: reloadEmployee } = useApi<Employee | null>(`/api/employees/${id}`, x => x?.data ?? null, null);
  // Congés lus « au cas où » : un refus masque simplement la section, sans message.
  const { data: leaves, reload: reloadLeaves } = useApi<{ items: Array<{ _id: string; type: string; startDate: string; endDate: string; days: number; status: string }>; balance: { acquired: number; taken: number; pending: number; available: number } | null } | null>(
    `/api/leaves?employeeId=${id}`, l => (l?.success === false ? null : l?.data ?? null), null, { quiet: true });
  const load = () => { reloadEmployee(); reloadLeaves(); };
  useEffect(() => {
    if (!payroll) return;
    fetch(`/api/payslips?employeeId=${id}&limit=24`, { credentials: "include" }).then(r => r.ok ? r.json() : null).then(x => setSlips(x?.data?.items ?? [])).catch(() => {});
  }, [id, payroll]);

  async function run(fn: () => Promise<unknown>) { setError(""); try { await fn(); load(); } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); } }

  if (!e) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  const rows = (items: Array<[string, React.ReactNode]>) => items.map(([k, v]) => (
    <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-line last:border-0 text-sm"><span className="text-ink2">{k}</span><span className="text-ink text-right">{v || "—"}</span></div>
  ));

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/employees" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Collaborateurs</Link>
          <h1 className="page-title mt-1">{e.firstName} {e.lastName}</h1>
          <p className="text-sm text-ink2">{e.position} · {TYPE[e.employeeType] ?? e.employeeType} · <span className="font-mono">{e.code}</span>
            {" · "}<span className={e.isActive ? "text-pos" : "text-neg"}>{e.isActive ? "en poste" : `sorti le ${d(e.endDate)}`}</span></p>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setLeaveOpen(true)} className={buttonClass("secondary", "md")}><CalendarClock size={15} /> Saisir un congé</button>
            {canUsers && <button onClick={() => setLinkOpen(true)} className={buttonClass("secondary", "md")}><Link2 size={15} /> Compte utilisateur</button>}
            {e.isActive
              ? <button onClick={() => setExitOpen(true)} className="px-3 h-10 inline-flex items-center gap-2 rounded-lg border border-warn/30 text-warn text-sm hover:bg-warn-50"><LogOut size={15} /> Enregistrer le départ</button>
              : <button onClick={async () => { if (await confirmDialog({ title: "Réintégrer ce collaborateur ?", confirmLabel: "Réintégrer" })) run(() => patch(String(id), { isActive: true, endDate: null, exitReason: null })); }} className={buttonClass("secondary", "md")}><RotateCcw size={15} /> Réintégrer</button>}
            <button onClick={() => setEditOpen(true)} className={buttonClass("primary", "md")}><Edit3 size={15} /> Modifier</button>
          </div>
        )}
      </div>
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-surface rounded-xl border border-line p-4"><h2 className="font-semibold text-ink mb-2">Identité</h2>
          {rows([["Téléphone", e.phone], ["E-mail", e.email], ["N° CNSS", e.cnssNumber], ["NIF", e.nif],
            ["Compte de connexion", e.userId ? <span className="inline-flex items-center gap-1"><UserCheck size={13} className="text-pos" /> {e.userId.email}</span> : "non rattaché"]])}
        </section>
        <section className="bg-surface rounded-xl border border-line p-4"><h2 className="font-semibold text-ink mb-2">Contrat</h2>
          {rows([["Nature", CONTRACT[e.contractNature] ?? e.contractNature], ["Service", e.costCenter ? centers.find(c => c.value === e.costCenter)?.label ?? e.costCenter : e.department],
            ["Entrée", `${d(e.startDate)} (${seniority(e.startDate)})`], ["Fin de contrat", d(e.contractEndDate)],
            ...(!e.isActive ? [["Départ", `${d(e.endDate)}${e.exitReason ? ` — ${e.exitReason}` : ""}`] as [string, string]] : [])])}
        </section>
        {payroll && !e.payrollHidden && (
          <section className="bg-surface rounded-xl border border-line p-4"><h2 className="font-semibold text-ink mb-2">Rémunération</h2>
            {rows([[e.employeeType === "employee" ? "Salaire de base" : "Indemnité", `${fmt(e.employeeType === "employee" ? e.grossSalary : e.indemnity)} FCFA${e.employeeType !== "employee" && e.indemnityPeriod ? ` / ${e.indemnityPeriod}` : ""}`],
              ["CNSS / IR", `${e.includeCnss !== false ? "CNSS" : "sans CNSS"} · ${e.includeIr !== false ? "IR" : "sans IR"}`],
              ["Retenue permanente", e.otherDeductionAmount ? `${e.otherDeductionLabel ?? "Retenue"} : ${fmt(e.otherDeductionAmount)} FCFA` : "—"],
              ["Paiement", [e.bankName, e.bankAccount].filter(Boolean).join(" · ")]])}
          </section>
        )}
        {leaves && (
          <section className="bg-surface rounded-xl border border-line p-4"><h2 className="font-semibold text-ink mb-2">Congés</h2>
            {leaves.balance && <p className="text-sm mb-2">Solde disponible : <b className={leaves.balance.available >= 0 ? "text-pos" : "text-neg"}>{leaves.balance.available} j</b> <span className="text-ink3">(acquis {leaves.balance.acquired}, pris {leaves.balance.taken}, en attente {leaves.balance.pending})</span></p>}
            <ul className="text-xs divide-y divide-line">
              {leaves.items.slice(0, 6).map(l => <li key={l._id} className="py-1 flex justify-between"><span>{LEAVE_TYPES[l.type] ?? l.type} · {d(l.startDate)} → {d(l.endDate)}</span><span>{l.days} j · {l.status === "approved" ? "approuvé" : l.status === "pending" ? "en attente" : l.status === "rejected" ? "refusé" : "annulé"}</span></li>)}
              {leaves.items.length === 0 && <li className="py-1 text-ink3">Aucun congé enregistré.</li>}
            </ul>
          </section>
        )}
      </div>

      {payroll && (
        <section className="bg-surface rounded-xl border border-line p-4">
          <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-ink flex items-center gap-2"><FileSpreadsheet size={16} /> Bulletins de paie</h2><Link href="/payslips" className="text-xs text-section hover:underline">Générer →</Link></div>
          {slips.length === 0 ? <p className="text-sm text-ink3">Aucun bulletin.</p> : (
            <div className="flex flex-wrap gap-2">
              {slips.map(s => <Link key={s._id} href={`/payslips/${s._id}`} className={`px-3 py-1.5 rounded-lg border text-xs ${s.isPaid ? "border-pos/25 bg-pos-50 text-pos" : "border-warn/30 bg-warn-50 text-warn"}`}>{MONTHS[s.month]} {s.year} · {fmt(s.netSalary)}</Link>)}
            </div>
          )}
        </section>
      )}

      <AttachmentPanel host="employees" hostId={e._id} title="Dossier du collaborateur (contrat, diplômes, pièces)" defaultCategory="contrat" readOnly={!canEdit} />

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le collaborateur" size="lg">
        <EmployeeForm initial={e as unknown as Partial<EmployeeFormData>} payroll={payroll && !e.payrollHidden}
          onSave={async body => { await patch(String(id), body as unknown as Record<string, unknown>); setEditOpen(false); load(); }} onCancel={() => setEditOpen(false)} />
      </Modal>
      {exitOpen && <ExitDialog employeeId={String(id)} payroll={payroll && !e.payrollHidden} onClose={() => setExitOpen(false)} onDone={() => { setExitOpen(false); load(); }} />}
      {linkOpen && <LinkUserDialog current={e.userId?._id} onClose={() => setLinkOpen(false)} onSave={async userId => { await patch(String(id), { userId }); setLinkOpen(false); load(); }} />}
      {leaveOpen && <RequestDialog employeeId={e._id} onClose={() => setLeaveOpen(false)} onDone={() => { setLeaveOpen(false); load(); }} />}
    </div>
  );
}

const EXIT_REASONS = ["Fin de contrat (CDD)", "Démission", "Licenciement", "Rupture d'un commun accord", "Fin de stage", "Retraite", "Décès", "Autre"];

interface Settlement { month: number; year: number; daysPresent: number; fullMonth: boolean; proratedBase: number; leaveDays: number; leaveIndemnity: number; totalGross: number }

/** Départ : motif, solde de tout compte prévisionnel et, au choix, bulletin de sortie. */
function ExitDialog({ employeeId, payroll, onClose, onDone }: { employeeId: string; payroll: boolean; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(EXIT_REASONS[0]);
  const [slip, setSlip] = useState(payroll);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data } = useApi<{ settlement: Settlement; leave: { available: number; forfeited?: number }; existingPayslipId: string | null } | null>(
    payroll && date ? `/api/employees/${employeeId}/exit?date=${date}` : null, x => x?.data ?? null, null, { quiet: true });
  const s = data?.settlement;
  async function save() {
    setBusy(true); setError("");
    const res = await apiSend("POST", `/api/employees/${employeeId}/exit`, { date, reason, payslip: payroll && slip && !data?.existingPayslipId });
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement impossible."); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Départ du collaborateur">
      <div className="space-y-4">
        <p className="text-sm text-ink2">La fiche passe « sortie » : plus de bulletin généré ni de congé demandé. L&apos;historique (paie, congés, documents) est conservé. Pensez à désactiver son compte de connexion.</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Date de sortie" required><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></FormField>
        <FormField label="Motif">
          <select className={selectCls} value={reason} onChange={e => setReason(e.target.value)}>{EXIT_REASONS.map(r => <option key={r}>{r}</option>)}</select>
        </FormField>
        {s && (
          <div className="surface-card p-4 text-sm space-y-1">
            <p className="font-semibold text-ink">Solde de tout compte (prévisionnel, brut)</p>
            <div className="flex justify-between"><span className="text-ink2">Salaire de {MONTHS[s.month]} {s.year} {s.fullMonth ? "(mois complet)" : `(${s.daysPresent} j / 30)`}</span><span className="font-mono">{fmt(s.proratedBase)} FCFA</span></div>
            <div className="flex justify-between"><span className="text-ink2">Indemnité compensatrice de congés ({s.leaveDays} j)</span><span className="font-mono">{fmt(s.leaveIndemnity)} FCFA</span></div>
            <div className="flex justify-between font-semibold border-t border-line pt-1"><span>Total brut</span><span className="font-mono">{fmt(s.totalGross)} FCFA</span></div>
            {(data?.leave.forfeited ?? 0) > 0 && <p className="text-xs text-warn">{data?.leave.forfeited} j au-delà du plafond de report ne sont pas indemnisés.</p>}
            <p className="text-xs text-ink3">Préavis, indemnité de licenciement ou de fin de CDD prévues par la convention collective : à ajouter en prime sur le bulletin.</p>
            {data?.existingPayslipId
              ? <p className="text-xs text-warn">Le bulletin de ce mois existe déjà : l&apos;indemnité de congés se porte sur un bulletin rectificatif.</p>
              : <label className="flex items-center gap-2 cursor-pointer pt-1"><input type="checkbox" checked={slip} onChange={e => setSlip(e.target.checked)} className="accent-section" /> Générer le bulletin de sortie</label>}
          </div>
        )}
        <button disabled={busy} onClick={save} className="w-full h-10 rounded-lg bg-warn text-onink text-sm font-semibold">Enregistrer le départ</button>
      </div>
    </Modal>
  );
}

function LinkUserDialog({ current, onClose, onSave }: { current?: string; onClose: () => void; onSave: (userId: string | null) => Promise<void> }) {
  const [users, setUsers] = useState<Array<{ _id: string; firstName?: string; lastName?: string; email: string }>>([]);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState("");
  useEffect(() => { apiJson("/api/users?limit=100").then(x => setUsers(x.data?.items ?? [])).catch(() => {}); }, []);
  return (
    <Modal open onClose={onClose} title="Compte de connexion lié">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Le lien permet au collaborateur de voir ses notes de frais, ses congés et à son chef de les valider.</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <select className={selectCls} value={value} onChange={e => setValue(e.target.value)} aria-label="Compte">
          <option value="">— Aucun compte —</option>
          {users.map(u => <option key={u._id} value={u._id}>{u.firstName} {u.lastName} — {u.email}</option>)}
        </select>
        <button onClick={async () => { try { await onSave(value || null); } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); } }} className={buttonClass("primary", "md", "w-full")}>Enregistrer</button>
      </div>
    </Modal>
  );
}
