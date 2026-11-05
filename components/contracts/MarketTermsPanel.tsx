"use client";
import { useState } from "react";
import { CalendarClock, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";
import type { MarketFinance } from "@/lib/market-finance";

export interface TermsSettings {
  amount: number; amountTTC?: number; paymentDays?: number; serviceOrderDate?: string; executionDelay?: number; executionUnit?: string; deliveredAt?: string;
  penaltyDivisor?: number; penaltyCapRate?: number; regulationRate?: number; regulationThreshold?: number; lateInterestRate?: number;
}

const day = (d?: string) => (d ? d.slice(0, 10) : "");
const percent = (v?: number) => (v === undefined || v === null ? "" : String(Math.round(v * 1e6) / 1e4));
const showRate = (v: number) => `${(Math.round(v * 1e6) / 1e4).toLocaleString("fr-FR")} %`;

function Line({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "neg" }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink2">{label}{hint && <span className="block text-[11px] text-ink3">{hint}</span>}</span>
      <span className={`font-mono text-right ${tone === "neg" ? "text-neg font-semibold" : "text-ink"}`}>{value}</span>
    </div>
  );
}

/** Ce que le marché prévoit (délais, redevance, pénalités, intérêts) et ce que cela donne aujourd'hui. */
export function MarketTermsPanel({ contractId, settings, f, canEdit, onChange }: { contractId: string; settings: TermsSettings; f: MarketFinance; canEdit: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const t = f.terms, reg = t.regulation, pen = t.penalty;
  const interest = t.lateInterest;
  return (
    <section className="surface-card p-5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2"><CalendarClock size={16} /> Conditions du marché</h2>
          <p className="text-xs text-ink2">Reprises du contrat. Les montants calculés entrent dans la marge ; ce qui est saisi s&apos;en déduit.</p>
        </div>
        {canEdit && <button onClick={() => setEditing(true)} className="px-3 h-8 rounded-lg border border-line2 text-xs font-semibold hover:bg-surface2 inline-flex items-center gap-1 shrink-0"><Pencil size={13} /> Renseigner</button>}
      </div>
      <div className="grid lg:grid-cols-2 gap-x-8 divide-y lg:divide-y-0 divide-line">
        <div className="divide-y divide-line">
          <Line label="Montant de référence" value={`${formatMoney(t.base)} ${t.baseKind}`} hint={t.baseKind === "HT" ? "Renseignez le TTC ou la TVA si le contrat le fixe en TTC" : "Base de la redevance et des pénalités"} />
          <Line label="Délai de paiement" value={`${t.paymentDays} jours`} hint="À compter de la réception de la déclaration de créance" />
          <Line label="Redevance de régulation et FSSP"
            value={reg.applicable ? formatMoney(reg.estimate) : "Sans objet"}
            hint={reg.rate > 0 ? `${showRate(reg.rate)} à partir de ${formatMoney(reg.threshold)}${reg.recorded ? ` · ${formatMoney(reg.recorded)} saisis` : ""}` : "Marché privé, ou taux à 0"} />
        </div>
        <div className="divide-y divide-line">
          {pen ? (
            <>
              <Line label="Date limite de livraison" value={formatDate(pen.deadline)} hint={pen.delivered ? "Livraison enregistrée" : "Livraison non encore enregistrée"} />
              <Line label="Pénalités de retard" tone={pen.estimate > 0 ? "neg" : undefined}
                value={pen.perDay ? formatMoney(pen.estimate) : "Taux à renseigner"}
                hint={pen.perDay ? `${pen.daysLate} jour(s) de retard × ${formatMoney(pen.perDay)}${pen.capped ? " · plafonnées" : ""}${pen.recorded ? ` · ${formatMoney(pen.recorded)} saisis` : ""}` : undefined} />
            </>
          ) : <Line label="Pénalités de retard" value="—" hint="Renseignez la date de départ de l'ordre de service et le délai d'exécution" />}
          <Line label="Intérêts moratoires estimés" value={interest.rate === null ? "Taux à renseigner" : formatMoney(interest.total)}
            hint={interest.rate === null ? "Taux à vérifier dans le Code des marchés publics" : `Non vérifié : ${showRate(interest.rate)} par an sur 365 jours, à confirmer avec le texte · hors marge`} />
        </div>
      </div>
      {t.alerts.map(a => <p key={a} className="mt-2 p-2 rounded-lg bg-warn-50 text-warn text-xs">{a}</p>)}
      {pen && pen.estimate > 0 && !pen.delivered && <p className="mt-2"><Pill tone="warn">Retard en cours</Pill> <span className="text-xs text-ink2">Le montant augmente chaque jour jusqu&apos;à la livraison.</span></p>}
      {editing && <TermsDialog contractId={contractId} settings={settings} onClose={() => setEditing(false)} onDone={() => { setEditing(false); showToast("Conditions du marché enregistrées.", "success"); onChange(); }} />}
    </section>
  );
}

function TermsDialog({ contractId, settings: s, onClose, onDone }: { contractId: string; settings: TermsSettings; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    amountTTC: s.amountTTC ? String(s.amountTTC) : "", paymentDays: s.paymentDays !== undefined ? String(s.paymentDays) : "",
    serviceOrderDate: day(s.serviceOrderDate), executionDelay: s.executionDelay ? String(s.executionDelay) : "", executionUnit: s.executionUnit ?? "days", deliveredAt: day(s.deliveredAt),
    penaltyDivisor: s.penaltyDivisor ? String(s.penaltyDivisor) : "", penaltyCapRate: percent(s.penaltyCapRate),
    regulationRate: percent(s.regulationRate), regulationThreshold: s.regulationThreshold !== undefined ? String(s.regulationThreshold) : "", lateInterestRate: percent(s.lateInterestRate),
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const u = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  const num = (x: string) => (x.trim() === "" ? null : Number(x.replace(",", ".")));
  const frac = (x: string) => { const n = num(x); return n === null ? null : n / 100; };
  async function submit() {
    setSaving(true); setError("");
    const res = await apiSend("PATCH", `/api/contracts/${contractId}`, {
      amountTTC: num(v.amountTTC), paymentDays: num(v.paymentDays), serviceOrderDate: v.serviceOrderDate || null, executionDelay: num(v.executionDelay), executionUnit: v.executionUnit,
      deliveredAt: v.deliveredAt || null, penaltyDivisor: num(v.penaltyDivisor), penaltyCapRate: frac(v.penaltyCapRate),
      regulationRate: frac(v.regulationRate), regulationThreshold: num(v.regulationThreshold), lateInterestRate: frac(v.lateInterestRate),
    });
    setSaving(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement refusé."); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Conditions du marché" size="lg">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Montant du marché TTC (FCFA)" hint={`Montant HT : ${formatMoney(s.amount)}`}><input type="number" min={0} className={inputCls} value={v.amountTTC} onChange={u("amountTTC")} /></FormField>
          <FormField label="Délai de paiement (jours)" hint="Vide : 30 jours"><input type="number" min={0} max={365} className={inputCls} value={v.paymentDays} onChange={u("paymentDays")} placeholder="60" /></FormField>
          <FormField label="Date de départ de l'ordre de service"><input type="date" className={inputCls} value={v.serviceOrderDate} onChange={u("serviceOrderDate")} /></FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Délai d'exécution"><input type="number" min={0} className={inputCls} value={v.executionDelay} onChange={u("executionDelay")} placeholder="1" /></FormField>
            <FormField label="Unité"><select className={selectCls} value={v.executionUnit} onChange={u("executionUnit")}><option value="days">Jours</option><option value="months">Mois</option></select></FormField>
          </div>
          <FormField label="Livraison effective le" hint="Arrête le décompte des pénalités"><input type="date" className={inputCls} value={v.deliveredAt} onChange={u("deliveredAt")} /></FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Pénalité par jour : 1 /" hint="2000 pour 1/2000e"><input type="number" min={1} className={inputCls} value={v.penaltyDivisor} onChange={u("penaltyDivisor")} placeholder="2000" /></FormField>
            <FormField label="Plafond (%)" hint="Si le contrat en fixe un"><input inputMode="decimal" className={inputCls} value={v.penaltyCapRate} onChange={u("penaltyCapRate")} /></FormField>
          </div>
          <FormField label="Redevance et FSSP (%)" hint="Vide : 1,05 % sur un marché public. 0 : aucune."><input inputMode="decimal" className={inputCls} value={v.regulationRate} onChange={u("regulationRate")} placeholder="1,05" /></FormField>
          <FormField label="Seuil de la redevance (FCFA)" hint="Vide : 5 000 000"><input type="number" min={0} className={inputCls} value={v.regulationThreshold} onChange={u("regulationThreshold")} /></FormField>
          <FormField label="Intérêts moratoires (% par an)" hint="À reprendre du texte applicable. Vide : pas de calcul."><input inputMode="decimal" className={inputCls} value={v.lateInterestRate} onChange={u("lateInterestRate")} /></FormField>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}
