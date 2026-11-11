"use client";
import { useState } from "react";
import Link from "next/link";
import { HandCoins, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { buildSchedule, FREQUENCIES, LENDER_TYPES, METHODS, periodsOf, scheduleTotals, type Frequency, type LenderType, type Method } from "@/lib/loan-schedule";

interface LoanRow {
  _id: string; label: string; lender: string; principal: number; annualRate: number; durationMonths: number; status: string;
  treasuryAccountId?: { label: string }; state: { remaining: number; next: { n: number; dueDate: string; total: number } | null; overdue: { count: number; amount: number } };
}

/** Emprunts et crédits : capital restant dû, prochaine échéance, retards. */
export default function EmpruntsPage() {
  const res = useApi<{ items: LoanRow[]; openingCheck: Array<{ accountCode: string; loans: number; opening: number | null; gap: number | null }>; totals: { remaining: number; overdue: number; interestLeft: number } } | null>("/api/loans", d => d?.data ?? null, null);
  const [open, setOpen] = useState(false);
  const d = res.data;
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title inline-flex items-center gap-2"><HandCoins size={22} /> Emprunts et crédits</h1>
          <p className="text-sm text-ink2">Crédits souscrits auprès des banques, des associés ou de particuliers, avec ou sans intérêts : tableau d&apos;amortissement, échéances payées en un clic (capital, intérêts, assurance), prévision de trésorerie.</p>
        </div>
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouvel emprunt</button>
      </div>
      {d && (
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Capital restant dû</p><p className="text-xl font-bold">{formatMoney(d.totals.remaining)}</p></div>
          <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Intérêts restant à payer</p><p className="text-xl font-bold">{formatMoney(d.totals.interestLeft)}</p></div>
          <div className="surface-card p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">Échéances en retard</p><p className={`text-xl font-bold ${d.totals.overdue ? "text-neg" : ""}`}>{formatMoney(d.totals.overdue)}</p></div>
        </div>
      )}
      {d && d.openingCheck.some(c => c.gap !== 0) && (
        <div className="p-3 rounded-lg bg-warn-50 text-warn text-sm space-y-1">
          <p className="font-semibold">Contrôle de la reprise : emprunts antérieurs comparés aux soldes d&apos;ouverture</p>
          {d.openingCheck.map(c => <p key={c.accountCode} className="text-xs">Compte {c.accountCode} : capital restant des emprunts {formatMoney(c.loans)} · solde d&apos;ouverture {c.opening === null ? "pas encore saisi" : formatMoney(c.opening)}{c.gap ? ` · écart ${formatMoney(c.gap)}` : ""}</p>)}
        </div>
      )}
      <section className="surface-card overflow-hidden">
        {!d ? <div className="h-32 animate-pulse" /> : d.items.length === 0 ? <p className="p-5 text-sm text-ink3">Aucun emprunt. Ajoutez les crédits en cours, même anciens : seul le capital restant compte à la reprise.</p> : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr className="text-left text-ink2"><th>Emprunt</th><th>Prêteur</th><th className="text-right">Capital</th><th className="text-right">Taux</th><th className="text-right">Restant dû</th><th>Prochaine échéance</th><th>État</th></tr></thead>
              <tbody>{d.items.map(l => (
                <tr key={l._id} className="border-t border-line">
                  <td><Link href={`/emprunts/${l._id}`} className="text-section font-semibold hover:underline">{l.label}</Link></td>
                  <td className="text-sm">{l.lender}</td>
                  <td className="text-right font-mono">{formatMoney(l.principal)}</td>
                  <td className="text-right font-mono">{(l.annualRate * 100).toLocaleString("fr-FR")} %</td>
                  <td className="text-right font-mono font-semibold">{formatMoney(l.state.remaining)}</td>
                  <td className="text-xs">{l.state.next ? `${formatDate(l.state.next.dueDate)} · ${formatMoney(l.state.next.total)}` : "—"}{l.state.overdue.count > 0 && <span className="block text-neg">{l.state.overdue.count} en retard</span>}</td>
                  <td>{l.status === "draft" ? <Pill tone="warn">À débloquer</Pill> : l.status === "closed" ? <Pill tone="mute">Soldé</Pill> : <Pill tone="info">En cours</Pill>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {open && <LoanDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); res.reload(); }} />}
    </div>
  );
}

function LoanDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ lenderType: "bank", capitalAccountCode: "162000", openingRemaining: "", label: "", lender: "", reference: "", treasuryAccountId: "", principal: "", rate: "", durationMonths: "12", frequency: "monthly", method: "annuity", deferral: "0", startDate: todayLocal(), firstDueDate: "", fees: "", insurance: "", collateral: "", purpose: "", prior: false, wh: "" });
  const free = v.method === "free";
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const u = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  const freq = v.frequency as Frequency;
  let preview: ReturnType<typeof buildSchedule> = [];
  try {
    const p = Number(v.principal), n = Number(v.durationMonths);
    if (!free && p > 0 && n > 0 && n % FREQUENCIES[freq].months === 0) {
      const start = new Date(`${v.startDate}T00:00:00Z`);
      const first = v.firstDueDate ? new Date(`${v.firstDueDate}T00:00:00Z`) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + FREQUENCIES[freq].months, start.getUTCDate()));
      preview = buildSchedule({ principal: p, annualRate: Number(String(v.rate).replace(",", ".")) / 100 || 0, durationMonths: n, frequency: freq, method: v.method as Method, deferralPeriods: Number(v.deferral) || 0, firstDueDate: first, insurancePerPeriod: Number(v.insurance) || 0 });
    }
  } catch { preview = []; }
  const tot = scheduleTotals(preview);
  async function submit() {
    setSaving(true); setError("");
    const res = await apiSend("POST", "/api/loans", {
      lenderType: v.lenderType, capitalAccountCode: v.capitalAccountCode, openingRemaining: v.prior && free ? Number(v.openingRemaining) : undefined,
      label: v.label, lender: v.lender, reference: v.reference, treasuryAccountId: v.treasuryAccountId, principal: Number(v.principal),
      annualRatePct: Number(String(v.rate).replace(",", ".")), durationMonths: Number(v.durationMonths), frequency: v.frequency, method: v.method,
      deferralPeriods: Number(v.deferral) || 0, startDate: v.startDate, firstDueDate: v.firstDueDate || undefined, fees: Number(v.fees) || 0,
      insurancePerPeriod: Number(v.insurance) || 0, interestWithholdingPct: v.wh || undefined, collateral: v.collateral, purpose: v.purpose, prior: v.prior,
    });
    setSaving(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement refusé."); return; }
    showToast("Emprunt enregistré.", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Nouvel emprunt" size="lg">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Objet" required><input className={inputCls} value={v.label} onChange={u("label")} placeholder="Équipement The Spot, préfinancement marché…" /></FormField>
          <FormField label="Type de prêteur"><select className={selectCls} value={v.lenderType} onChange={e => { const t = e.target.value as LenderType; setV(p => ({ ...p, lenderType: t, capitalAccountCode: LENDER_TYPES[t].accountCode })); }}>{Object.entries(LENDER_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></FormField>
          <FormField label="Prêteur" required><input className={inputCls} value={v.lender} onChange={u("lender")} placeholder="Orabank, M. Issoufou, associé…" /></FormField>
          <FormField label="Compte de la dette" hint="Proposé selon le prêteur, à valider par le comptable"><input className={inputCls} value={v.capitalAccountCode} onChange={u("capitalAccountCode")} /></FormField>
          <FormField label="Fonds reçus sur (banque ou caisse)" required><TreasuryAccountSelect value={v.treasuryAccountId} onChange={x => setV(p => ({ ...p, treasuryAccountId: x }))} /></FormField>
          <FormField label="N° de contrat"><input className={inputCls} value={v.reference} onChange={u("reference")} /></FormField>
          <FormField label="Capital emprunté (FCFA)" required><input type="number" min={0} className={inputCls} value={v.principal} onChange={u("principal")} /></FormField>
          <FormField label="Taux annuel (%)" required><input inputMode="decimal" className={inputCls} value={v.rate} onChange={u("rate")} placeholder="9,5" /></FormField>
          <FormField label="Remboursement"><select className={selectCls} value={v.method} onChange={u("method")}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormField>
          {!free && <FormField label="Durée (mois)" required><input type="number" min={1} className={inputCls} value={v.durationMonths} onChange={u("durationMonths")} /></FormField>}
          {!free && <FormField label="Périodicité"><select className={selectCls} value={v.frequency} onChange={u("frequency")}>{Object.entries(FREQUENCIES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select></FormField>}
          {!free && <FormField label="Différé (échéances d'intérêts seuls)"><input type="number" min={0} className={inputCls} value={v.deferral} onChange={u("deferral")} /></FormField>}
          <FormField label="Date de déblocage" required><input type="date" className={inputCls} value={v.startDate} onChange={u("startDate")} /></FormField>
          <FormField label={free ? "Remboursement prévu le" : "Première échéance"} hint={free ? "Facultatif" : "Vide : une période après le déblocage"}><input type="date" className={inputCls} value={v.firstDueDate} onChange={u("firstDueDate")} /></FormField>
          <FormField label="Frais de dossier (FCFA)"><input type="number" min={0} className={inputCls} value={v.fees} onChange={u("fees")} /></FormField>
          {!free && <FormField label="Assurance par échéance (FCFA)"><input type="number" min={0} className={inputCls} value={v.insurance} onChange={u("insurance")} /></FormField>}
          {v.lenderType !== "bank" && Number(String(v.rate).replace(",", ".")) > 0 && <FormField label="Retenue sur intérêts (%)" hint="Retenue à la source sur les intérêts versés à un prêteur non bancaire : taux à confirmer par le comptable"><input inputMode="decimal" className={inputCls} value={v.wh} onChange={u("wh")} /></FormField>}
          <FormField label="Garanties données" hint="Hypothèque, nantissement, caution…"><input className={inputCls} value={v.collateral} onChange={u("collateral")} /></FormField>
          <FormField label="Destination des fonds"><input className={inputCls} value={v.purpose} onChange={u("purpose")} /></FormField>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-section mt-1" checked={v.prior} onChange={e => setV(p => ({ ...p, prior: e.target.checked }))} />
          <span>Emprunt reçu avant la reprise de la comptabilité : rien n&apos;est comptabilisé avant la date de reprise ; son capital restant à cette date se reprend dans les soldes d&apos;ouverture (compte de la dette).</span></label>
        {v.prior && free && <FormField label="Capital restant dû à la date de reprise (FCFA)" required><input type="number" min={0} className={inputCls} value={v.openingRemaining} onChange={u("openingRemaining")} /></FormField>}
        {preview.length > 0 && (
          <p className="text-xs text-ink2">{preview.length} échéances ({periodsOf(Number(v.durationMonths), freq)}) · première {formatMoney(preview[0].total)} · intérêts totaux {formatMoney(tot.interest)}{tot.insurance ? ` · assurance ${formatMoney(tot.insurance)}` : ""} · coût du crédit {formatMoney(tot.interest + tot.insurance + (Number(v.fees) || 0))}. À comparer au tableau de la banque : chaque échéance s&apos;ajuste ensuite.</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !v.label || !v.lender || !v.treasuryAccountId || !(Number(v.principal) > 0)} className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}
