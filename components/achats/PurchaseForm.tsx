"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";
import { EXPENSE_ACCOUNTS } from "@/lib/syscohada";

export interface PurchaseLine extends ImputationValue {
  description: string; accountCode: string; quantity: number; unitPrice: number; tvaRate: number;
}
export interface PurchaseFormValue {
  kind: "invoice" | "cash"; supplierId: string; payee: string; supplierRef: string; date: string; dueDate: string;
  notes: string; lines: PurchaseLine[]; commandeId?: string;
  pay: boolean; treasuryAccountId: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): PurchaseLine => ({ description: "", accountCode: "605500", quantity: 1, unitPrice: 0, tvaRate: 0 });
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

/**
 * Saisie d'un achat : facture fournisseur (à payer plus tard) ou dépense au
 * comptant (réglée tout de suite). Chaque ligne choisit son compte de charge
 * et son imputation (projet, secteur, service).
 */
export function PurchaseForm({ initial, onSubmit, submitLabel }: {
  initial?: Partial<PurchaseFormValue>;
  onSubmit: (v: PurchaseFormValue, validate: boolean) => Promise<void>;
  submitLabel?: string;
}) {
  const [f, setF] = useState<PurchaseFormValue>({
    kind: "invoice", supplierId: "", payee: "", supplierRef: "", date: today(), dueDate: "", notes: "",
    lines: [emptyLine()], pay: false, treasuryAccountId: "", ...initial,
  });
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string; paymentTermDays?: number }>>([]);
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string; type: string }>>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sameImputation, setSameImputation] = useState(true);
  const [imputation, setImputation] = useState<ImputationValue>(() => {
    const l = initial?.lines?.[0];
    return l ? { projectId: l.projectId, activityId: l.activityId, costCenter: l.costCenter } : {};
  });

  useEffect(() => {
    fetch("/api/suppliers?limit=100", { credentials: "include" }).then(r => r.json()).then(d => setSuppliers(d.data?.items ?? [])).catch(() => {});
    fetch("/api/treasury-accounts", { credentials: "include" }).then(r => r.json()).then(d => {
      const list = d.data?.items ?? [];
      setAccounts(list);
      if (list.length === 1) setF(p => ({ ...p, treasuryAccountId: p.treasuryAccountId || list[0]._id }));
    }).catch(() => {});
  }, []);

  const u = <K extends keyof PurchaseFormValue>(k: K, v: PurchaseFormValue[K]) => setF(p => ({ ...p, [k]: v }));
  const setLine = (i: number, patch: Partial<PurchaseLine>) => setF(p => ({ ...p, lines: p.lines.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const totals = useMemo(() => {
    const ht = f.lines.reduce((s, l) => s + Math.round((l.quantity || 0) * (l.unitPrice || 0)), 0);
    const tva = f.lines.reduce((s, l) => s + Math.round(Math.round((l.quantity || 0) * (l.unitPrice || 0)) * (l.tvaRate || 0)), 0);
    return { ht, tva, ttc: ht + tva };
  }, [f.lines]);

  async function submit(validate: boolean) {
    setError("");
    if (!f.supplierId && !f.payee.trim()) { setError("Choisissez le fournisseur ou indiquez le bénéficiaire."); return; }
    if (f.lines.some(l => !l.description.trim() || !(l.unitPrice > 0))) { setError("Chaque ligne a un libellé et un montant."); return; }
    if (f.kind === "cash" && f.pay && !f.treasuryAccountId) { setError("Choisissez la caisse ou le compte qui paie."); return; }
    setSaving(true);
    try {
      const lines = f.lines.map(l => sameImputation ? { ...l, ...imputation } : l);
      await onSubmit({ ...f, lines }, validate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
      <div className="flex gap-2">
        {([["invoice", "Facture fournisseur (à payer)"], ["cash", "Dépense au comptant"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF(p => ({ ...p, kind: k, pay: k === "cash" }))}
            className={`px-4 h-10 rounded-lg text-sm font-semibold border ${f.kind === k ? "bg-section text-white border-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>{l}</button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <FormField label="Fournisseur">
          <select className={selectCls} value={f.supplierId} onChange={e => {
            const s = suppliers.find(x => x._id === e.target.value);
            setF(p => ({ ...p, supplierId: e.target.value, payee: s?.name ?? p.payee,
              dueDate: p.dueDate || (s?.paymentTermDays ? new Date(Date.now() + s.paymentTermDays * 86400000).toISOString().slice(0, 10) : p.dueDate) }));
          }}>
            <option value="">— Sans fiche fournisseur —</option>
            {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </FormField>
        {!f.supplierId && <FormField label="Bénéficiaire" required><input className={inputCls} value={f.payee} onChange={e => u("payee", e.target.value)} placeholder="Ex. station Total, taxi, marché…" /></FormField>}
        {f.kind === "invoice" && <FormField label="N° de facture du fournisseur"><input className={inputCls} value={f.supplierRef} onChange={e => u("supplierRef", e.target.value)} /></FormField>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <FormField label="Date" required><input type="date" className={inputCls} value={f.date} onChange={e => u("date", e.target.value)} /></FormField>
        {f.kind === "invoice" && <FormField label="Échéance"><input type="date" className={inputCls} value={f.dueDate} onChange={e => u("dueDate", e.target.value)} /></FormField>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Lignes</p>
          <button type="button" onClick={() => u("lines", [...f.lines, emptyLine()])} className="text-xs text-section font-semibold hover:underline">+ Ajouter une ligne</button>
        </div>
        {f.lines.map((l, i) => (
          <div key={i} className="rounded-lg border border-line2 p-3 space-y-2">
            <div className="grid grid-cols-12 gap-2 items-center">
              <input className={`${inputCls} col-span-12 sm:col-span-4`} placeholder="Libellé" value={l.description} onChange={e => setLine(i, { description: e.target.value })} aria-label="Libellé" />
              <select className={`${selectCls} col-span-12 sm:col-span-4`} value={l.accountCode} onChange={e => setLine(i, { accountCode: e.target.value })} aria-label="Compte de charge">
                {EXPENSE_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
              </select>
              <input type="number" min={0} step="any" className={`${inputCls} col-span-3 sm:col-span-1`} value={l.quantity} onChange={e => setLine(i, { quantity: Number(e.target.value) })} aria-label="Quantité" />
              <input type="number" min={0} className={`${inputCls} col-span-5 sm:col-span-2`} placeholder="Prix HT" value={l.unitPrice || ""} onChange={e => setLine(i, { unitPrice: Number(e.target.value) })} aria-label="Prix unitaire HT" />
              <select className={`${selectCls} col-span-3 sm:col-span-1`} value={String(l.tvaRate)} onChange={e => setLine(i, { tvaRate: Number(e.target.value) })} aria-label="TVA">
                <option value="0">0 %</option><option value="0.19">19 %</option><option value="0.1">10 %</option><option value="0.05">5 %</option>
              </select>
              {f.lines.length > 1 && <button type="button" onClick={() => u("lines", f.lines.filter((_, j) => j !== i))} className="col-span-1 text-ink3 hover:text-neg justify-self-end" aria-label="Retirer"><X size={15} /></button>}
            </div>
            {!sameImputation && <ImputationFields compact value={l} onChange={v => setLine(i, v)} />}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line2 p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold text-ink">Imputation</p>
          <label className="flex items-center gap-2 text-xs text-ink2">
            <input type="checkbox" className="accent-section" checked={!sameImputation} onChange={e => setSameImputation(!e.target.checked)} />
            Imputation différente par ligne
          </label>
        </div>
        {sameImputation && <ImputationFields value={imputation} onChange={setImputation} />}
        <p className="text-[11px] text-ink3">Le projet reçoit le coût (coût réel du projet) ; le secteur, la rentabilité par activité ; le service, le centre de coût.</p>
      </div>

      {f.kind === "cash" && (
        <div className="rounded-lg border border-line2 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="accent-section" checked={f.pay} onChange={e => u("pay", e.target.checked)} />
            Payée maintenant
          </label>
          {f.pay && (
            <select className={selectCls} value={f.treasuryAccountId} onChange={e => u("treasuryAccountId", e.target.value)} aria-label="Compte qui paie">
              <option value="">— Caisse ou compte qui paie —</option>
              {accounts.map(a => <option key={a._id} value={a._id}>{a.label} ({a.type === "cash" ? "caisse" : a.type === "mobile_money" ? "mobile money" : "banque"})</option>)}
            </select>
          )}
        </div>
      )}

      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={f.notes} onChange={e => u("notes", e.target.value)} /></FormField>

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-line">
        <p className="text-sm text-ink2">HT {fmt(totals.ht)} · TVA {fmt(totals.tva)} · <b className="text-ink">TTC {fmt(totals.ttc)} FCFA</b></p>
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => submit(false)} className="px-4 h-10 rounded-lg border border-line2 text-sm font-semibold hover:bg-surface2 disabled:opacity-60">Enregistrer en brouillon</button>
          <button type="button" disabled={saving} onClick={() => submit(true)} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-60">
            {saving ? "Enregistrement…" : submitLabel ?? (f.kind === "cash" && f.pay ? "Valider et payer" : "Valider (comptabiliser)")}
          </button>
        </div>
      </div>
    </div>
  );
}
