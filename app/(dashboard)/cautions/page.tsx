"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, ShieldCheck, ShieldOff, AlertTriangle, CalendarClock, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useMe, meCanDo } from "@/lib/useMe";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { CHARGE_KINDS, FEE_PERIODS, GUARANTEE_TYPES } from "@/lib/guarantees";

type GType = keyof typeof GUARANTEE_TYPES;
interface Guarantee {
  _id: string; type: GType; reference?: string; bankName?: string; beneficiary: string; amount: number; issueDate: string; expiryDate?: string;
  status: "active" | "released" | "called"; fee: number; collateral: number; calledAmount?: number; releasedAt?: string; calledAt?: string;
  appelId?: { _id: string; title: string; reference?: string } | null; contractId?: { _id: string; reference: string; title: string } | null;
  treasuryAccountId?: { _id: string; label: string } | null; alert?: "expired" | "expiring" | null;
  direction?: "issued" | "received"; guaranteeForm?: string; loanId?: { _id: string; label: string; lender: string } | null; feeRate?: number; feePeriod?: string;
  cost: number; nextCommission: { date: string; amount: number; period: number } | null; charges?: Array<{ date: string; amount: number; kind: keyof typeof CHARGE_KINDS }>;
}
interface Commitments { total: number; collateral: number; count: number; received: number; receivedCount: number; byType: Record<GType, number> }

const STATUS: Record<Guarantee["status"], [string, string]> = {
  active: ["En cours", "bg-info-50 text-info"], released: ["Mainlevée", "bg-pos-50 text-pos"], called: ["Appelée", "bg-neg-50 text-neg"],
};

/**
 * Cautions bancaires : soumission, bonne exécution, restitution d'avance,
 * retenue de garantie. Engagements hors bilan suivis jusqu'à la mainlevée ;
 * commission, dépôt bloqué et appel éventuel passent en comptabilité.
 */
function CautionsScreen() {
  const sp = useSearchParams();
  const me = useMe();
  const canCreate = meCanDo(me, "appels", "create");
  const canPost = meCanDo(me, "accountingEntries", "read");
  const [status, setStatus] = useState("active");
  const [creating, setCreating] = useState(sp.get("new") === "1");

  const list = useApi<{ items?: Guarantee[]; commitments?: Commitments; banks?: Array<{ _id: string; label: string; limit: number | null; used: number }> } | null>(`/api/cautions${status ? `?status=${status}` : ""}`, d => d?.data ?? null, null);
  const items = list.data?.items ?? [];
  const com = list.data?.commitments ?? null;
  const load = list.reload;

  async function act(g: Guarantee, kind: "release" | "call" | "extend" | "delete" | "commission" | "fees") {
    let res;
    if (kind === "release") {
      if (!(await confirmDialog({ title: "Mainlevée obtenue ?", message: g.collateral ? `Le dépôt de ${formatMoney(g.collateral)} revient sur ${g.treasuryAccountId?.label ?? "la banque"}.` : "L'engagement est levé.", confirmLabel: "Enregistrer la mainlevée" }))) return;
      res = await apiSend("POST", `/api/cautions/${g._id}/release`, {});
    } else if (kind === "call") {
      const v = await promptDialog({ title: "Caution appelée par le bénéficiaire", message: "La somme payée par la banque devient une charge ; elle s'impute d'abord sur le dépôt bloqué.", label: "Montant appelé (FCFA)", defaultValue: String(g.amount), required: true, confirmLabel: "Enregistrer l'appel" });
      if (!v) return;
      res = await apiSend("POST", `/api/cautions/${g._id}/call`, { amount: Math.round(Number(v.replace(/\s/g, "")) || 0) });
    } else if (kind === "extend") {
      const v = await promptDialog({ title: "Proroger la caution", label: "Nouvelle échéance (AAAA-MM-JJ)", defaultValue: g.expiryDate?.slice(0, 10) ?? "", required: true, confirmLabel: "Suivant" });
      if (!v) return;
      const fee = g.direction === "received" || !canPost ? "0" : await promptDialog({ title: "Frais de prorogation", message: "Prélevés par la banque (631). 0 s'il n'y en a pas.", label: "Montant (FCFA)", defaultValue: "0", confirmLabel: "Proroger" });
      if (fee === null) return;
      res = await apiSend("POST", `/api/cautions/${g._id}/extend`, { expiryDate: v, fee: Math.round(Number(fee.replace(/\s/g, "")) || 0) });
    } else if (kind === "commission") {
      if (!g.nextCommission || !(await confirmDialog({ title: "Passer la commission ?", message: `Période ${g.nextCommission.period} : ${formatMoney(g.nextCommission.amount)} débités de ${g.treasuryAccountId?.label ?? "la banque"} (631, imputé au marché).`, confirmLabel: "Comptabiliser" }))) return;
      res = await apiSend("POST", `/api/cautions/${g._id}/charge`, { kind: "commission" });
    } else if (kind === "fees") {
      const v = await promptDialog({ title: "Frais de la caution", message: "Frais de dossier ou autres frais prélevés par la banque (631).", label: "Montant (FCFA)", required: true, confirmLabel: "Comptabiliser" });
      if (!v) return;
      res = await apiSend("POST", `/api/cautions/${g._id}/charge`, { kind: "dossier", amount: Math.round(Number(v.replace(/\s/g, "")) || 0) });
    } else {
      if (!(await confirmDialog({ title: "Supprimer cette caution ?", message: "À réserver à une saisie erronée : commission et dépôt sont extournés.", danger: true, confirmLabel: "Supprimer" }))) return;
      res = await apiSend("DELETE", `/api/cautions/${g._id}`);
    }
    if (!res.ok) { showToast(res.data?.error || "Opération refusée.", "error"); return; }
    showToast("Caution mise à jour.", "success"); load();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Cautions et garanties" subtitle="Cautions données (soumission, bonne exécution, avance, retenue, garanties d'emprunt) et reçues des fournisseurs : frais, commissions périodiques, plafonds par banque, mainlevée."
        actions={canCreate && <button onClick={() => setCreating(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouvelle caution</button>} />

      {com && (
        <section className="surface-card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><p className="text-xs text-ink3">Engagements hors bilan</p><p className="text-xl font-bold num text-ink">{formatMoney(com.total)}</p><p className="text-xs text-ink2">{com.count} caution{com.count > 1 ? "s" : ""} en cours</p></div>
          <div><p className="text-xs text-ink3">Cautions reçues</p><p className="text-xl font-bold num text-ink">{formatMoney(com.received ?? 0)}</p><p className="text-xs text-ink2">{com.receivedCount ?? 0} en cours</p></div>
          <div><p className="text-xs text-ink3">Dépôts bloqués (275)</p><p className="text-xl font-bold num text-ink">{formatMoney(com.collateral)}</p></div>
          {(["soumission", "bonne_execution"] as GType[]).map(t => <div key={t}><p className="text-xs text-ink3">{GUARANTEE_TYPES[t]}</p><p className="text-lg font-semibold num text-ink">{formatMoney(com.byType[t] ?? 0)}</p></div>)}
        </section>
      )}

      {(list.data?.banks ?? []).length > 0 && (
        <section className="surface-card p-4">
          <p className="text-sm font-semibold text-ink mb-2">Lignes de cautions par banque</p>
          {(list.data?.banks ?? []).map(b => (
            <div key={b._id} className="flex justify-between text-sm py-1 border-t border-line">
              <span className="text-ink2">{b.label}</span>
              <span className={`num ${b.limit !== null && b.used > b.limit ? "text-neg font-semibold" : "text-ink"}`}>{formatMoney(b.used)}{b.limit !== null ? ` / ${formatMoney(b.limit)}${b.used > b.limit ? " · plafond dépassé" : ` · disponible ${formatMoney(b.limit - b.used)}`}` : " · plafond à renseigner (Trésorerie → Modifier)"}</span>
            </div>
          ))}
        </section>
      )}

      <div className="flex gap-2">
        {[["active", "En cours"], ["released", "Mainlevée"], ["called", "Appelées"], ["", "Toutes"]].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={buttonClass(status === v ? "primary" : "secondary", "sm")}>{l}</button>
        ))}
      </div>

      {items.length === 0 ? <p className="text-sm text-ink3">Aucune caution.</p> : (
        <div className="space-y-2">
          {items.map(g => {
            const [label, cls] = STATUS[g.status];
            return (
              <article key={g._id} className="surface-card p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <p className="font-semibold text-ink">{g.direction === "received" ? "Reçue · " : ""}{GUARANTEE_TYPES[g.type]}{g.guaranteeForm ? ` (${g.guaranteeForm})` : ""} <span className="font-normal text-ink2">— {g.beneficiary}</span></p>
                  {g.loanId && <p className="text-xs text-ink2">Garantit l&apos;emprunt <Link href={`/emprunts/${g.loanId._id}`} className="text-section hover:underline">{g.loanId.label} ({g.loanId.lender})</Link></p>}
                  <p className="text-xs text-ink2">
                    {g.bankName || g.treasuryAccountId?.label || "Banque non précisée"}{g.reference ? ` · ${g.reference}` : ""} · émise le {formatDate(g.issueDate)}{g.expiryDate ? ` · échéance ${formatDate(g.expiryDate)}` : ""}
                    {g.appelId && <> · <Link href={`/appels/${g.appelId._id}`} className="text-section hover:underline">{g.appelId.reference || g.appelId.title}</Link></>}
                    {g.contractId && <> · <Link href={`/contracts/${g.contractId._id}`} className="text-section hover:underline font-mono">{g.contractId.reference}</Link></>}
                  </p>
                  {g.direction !== "received" && (g.cost > 0 || g.nextCommission) && <p className="text-xs text-ink2">Coût à ce jour : <b className="num">{formatMoney(g.cost)}</b>{g.nextCommission ? ` · prochaine commission ${formatMoney(g.nextCommission.amount)} le ${formatDate(g.nextCommission.date)}` : ""}</p>}
                  {(g.fee > 0 || g.collateral > 0) && <p className="text-xs text-ink3">Commission {formatMoney(g.fee)} · dépôt bloqué {formatMoney(g.collateral)}{g.calledAmount ? ` · appelée pour ${formatMoney(g.calledAmount)}` : ""}</p>}
                </div>
                {g.alert && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${g.alert === "expired" ? "bg-neg-50 text-neg" : "bg-warn-50 text-warn"}`}><AlertTriangle size={11} /> {g.alert === "expired" ? "Échue : mainlevée à demander" : "Bientôt échue"}</span>}
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                <p className="num font-semibold text-ink w-32 text-right">{formatMoney(g.amount)}</p>
                {g.status === "active" && (
                  <div className="flex gap-1 w-full sm:w-auto justify-end">
                    <button onClick={() => act(g, "extend")} className={buttonClass("secondary", "sm")} title="Proroger"><CalendarClock size={13} /></button>
                    {canPost && g.nextCommission && <button onClick={() => act(g, "commission")} className={buttonClass("secondary", "sm")}>Commission</button>}
                    {canPost && g.direction !== "received" && <button onClick={() => act(g, "fees")} className={buttonClass("secondary", "sm")}>Frais</button>}
                    {canPost && <button onClick={() => act(g, "release")} className={buttonClass("secondary", "sm")}><ShieldCheck size={13} /> Mainlevée</button>}
                    {canPost && <button onClick={() => act(g, "call")} className={buttonClass("secondary", "sm")}><ShieldOff size={13} /> Appelée</button>}
                    {canPost && <button onClick={() => act(g, "delete")} className="p-2 text-ink3 hover:text-neg" aria-label="Supprimer"><Trash2 size={14} /></button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {creating && <CreateDialog canPost={canPost} appelId={sp.get("appelId") ?? ""} contractId={sp.get("contractId") ?? ""} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setStatus("active"); load(); }} />}
    </div>
  );
}

function CreateDialog({ canPost, appelId: a0, contractId: c0, onClose, onDone }: { canPost: boolean; appelId: string; contractId: string; onClose: () => void; onDone: () => void }) {
  const [loans, setLoans] = useState<Array<{ _id: string; label: string; lender: string }>>([]);
  const [x, setX] = useState({ direction: "issued", loanId: "", guaranteeForm: "", feeRatePct: "", feePeriod: "once" });
  const [f, setF] = useState({ type: (c0 ? "bonne_execution" : "soumission") as GType, appelId: a0, contractId: c0, beneficiary: "", amount: "", issueDate: todayLocal(), expiryDate: "", treasuryAccountId: "", bankName: "", reference: "", fee: "", collateral: "", notes: "" });
  const [appels, setAppels] = useState<Array<{ _id: string; title: string; organism?: string }>>([]);
  const [contracts, setContracts] = useState<Array<{ _id: string; reference: string; title: string }>>([]);
  const [banks, setBanks] = useState<Array<{ _id: string; label: string; type: string }>>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  useEffect(() => {
    apiJson("/api/appels?limit=100").then(d => setAppels(d?.data?.items ?? []));
    apiJson("/api/contracts?type=client&limit=100").then(d => setContracts(d?.data?.items ?? []));
    apiJson("/api/loans").then(d => setLoans(d?.data?.items ?? [])).catch(() => {});
    apiJson("/api/treasury-accounts?limit=100").then(d => setBanks((d?.data?.items ?? []).filter((b: { type: string; isActive?: boolean }) => b.type === "bank" && b.isActive !== false)));
  }, []);
  async function submit() {
    setSaving(true);
    try {
      const n = (v: string) => Math.round(Number(v.replace(/\s/g, "")) || 0);
      const res = await apiSend("POST", "/api/cautions", {
        ...f, ...x, loanId: x.loanId || undefined, amount: n(f.amount), fee: x.direction === "received" ? 0 : n(f.fee), collateral: x.direction === "received" ? 0 : n(f.collateral),
        appelId: f.appelId || undefined, contractId: f.contractId || undefined, treasuryAccountId: f.treasuryAccountId || undefined, expiryDate: f.expiryDate || undefined,
      });
      if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
      showToast("Caution enregistrée.", "success"); onDone();
    } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nouvelle caution ou garantie" size="lg">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Sens"><select className={selectCls} value={x.direction} onChange={e => setX(p => ({ ...p, direction: e.target.value }))}><option value="issued">Donnée par nous (banque émettrice)</option><option value="received">Reçue d&apos;un fournisseur ou sous-traitant</option></select></FormField>
          {f.type === "garantie_emprunt" && <FormField label="Emprunt garanti"><select className={selectCls} value={x.loanId} onChange={e => setX(p => ({ ...p, loanId: e.target.value }))}><option value="">—</option>{loans.map(l => <option key={l._id} value={l._id}>{l.label} ({l.lender})</option>)}</select></FormField>}
          {f.type === "garantie_emprunt" && <FormField label="Forme" hint="Hypothèque, nantissement, aval, caution personnelle…"><input className={inputCls} value={x.guaranteeForm} onChange={e => setX(p => ({ ...p, guaranteeForm: e.target.value }))} /></FormField>}
          {canPost && x.direction === "issued" && <FormField label="Commission périodique (% par an)" hint="Facturée par la banque sur le montant garanti"><input inputMode="decimal" className={inputCls} value={x.feeRatePct} onChange={e => setX(p => ({ ...p, feeRatePct: e.target.value }))} placeholder="2" /></FormField>}
          {canPost && x.direction === "issued" && <FormField label="Rythme de la commission"><select className={selectCls} value={x.feePeriod} onChange={e => setX(p => ({ ...p, feePeriod: e.target.value }))}>{Object.entries(FEE_PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></FormField>}
          <FormField label="Type"><select className={selectCls} value={f.type} onChange={e => set("type", e.target.value)}>{(Object.keys(GUARANTEE_TYPES) as GType[]).map(t => <option key={t} value={t}>{GUARANTEE_TYPES[t]}</option>)}</select></FormField>
          <FormField label="Montant garanti (FCFA)" required><input inputMode="numeric" className={inputCls} value={f.amount} onChange={e => set("amount", e.target.value)} /></FormField>
          <FormField label="Appel d'offres"><select className={selectCls} value={f.appelId} onChange={e => set("appelId", e.target.value)}><option value="">—</option>{appels.map(a => <option key={a._id} value={a._id}>{a.title}</option>)}</select></FormField>
          <FormField label="Marché"><select className={selectCls} value={f.contractId} onChange={e => set("contractId", e.target.value)}><option value="">—</option>{contracts.map(c => <option key={c._id} value={c._id}>{c.reference} — {c.title}</option>)}</select></FormField>
          <FormField label={x.direction === "received" ? "Fournisseur ou sous-traitant" : "Bénéficiaire"} hint={x.direction === "received" ? "Qui nous a remis la caution" : "Par défaut : l'organisme de l'appel ou le client du marché"}><input className={inputCls} value={f.beneficiary} onChange={e => set("beneficiary", e.target.value)} /></FormField>
          <FormField label="Référence de la caution"><input className={inputCls} value={f.reference} onChange={e => set("reference", e.target.value)} /></FormField>
          <FormField label="Émise le"><input type="date" className={inputCls} value={f.issueDate} onChange={e => set("issueDate", e.target.value)} /></FormField>
          <FormField label="Échéance"><input type="date" className={inputCls} value={f.expiryDate} onChange={e => set("expiryDate", e.target.value)} /></FormField>
          <FormField label="Banque émettrice"><select className={selectCls} value={f.treasuryAccountId} onChange={e => set("treasuryAccountId", e.target.value)}><option value="">— Non précisée —</option>{banks.map(b => <option key={b._id} value={b._id}>{b.label}</option>)}</select></FormField>
          {canPost && x.direction === "issued" && <FormField label="Commission d'émission (FCFA)" hint="Frais bancaires (631), débités de la banque"><input inputMode="numeric" className={inputCls} value={f.fee} onChange={e => set("fee", e.target.value)} /></FormField>}
          {canPost && x.direction === "issued" && <FormField label="Dépôt bloqué par la banque (FCFA)" hint="Compte 275, rendu à la mainlevée"><input inputMode="numeric" className={inputCls} value={f.collateral} onChange={e => set("collateral", e.target.value)} /></FormField>}
        </div>
        <FormField label="Notes"><textarea className={textareaCls} rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} /></FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function CautionsPage() {
  return <Suspense fallback={<div className="surface-card h-40 animate-pulse" />}><CautionsScreen /></Suspense>;
}
