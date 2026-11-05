"use client";
import { useEffect, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
import { apiJson, apiSend } from "@/lib/api-client";
import { useOpKey } from "@/lib/use-op-key";
import { formatMoney, todayLocal } from "@/lib/format";
import { EXPENSE_ACCOUNTS } from "@/lib/syscohada";
import type { MarketFinance } from "@/lib/market-finance";

interface CostType { _id: string; key?: string; label: string; accountCode: string; accountLabel?: string; isActive: boolean }

const CHARGE_ACCOUNTS = EXPENSE_ACCOUNTS.filter(a => /^6/.test(a.code) && !/^646/.test(a.code));
const NEW_TYPE = "__new";

function AccountSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = CHARGE_ACCOUNTS.some(a => a.code === value);
  return (
    <select className={selectCls} value={value} onChange={e => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {CHARGE_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
    </select>
  );
}

/** Dépenses du marché par type : redevance, frais bancaires, livraison… et les types que l'organisation ajoute. */
export function MarketCostsPanel({ contractId, f, projectId, canAdd, canManage, onChange }: { contractId: string; f: MarketFinance; projectId?: string; canAdd: boolean; canManage: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const rows = f.costs.byType;
  const committed = rows.reduce((t, r) => t + r.committed, 0), actual = rows.reduce((t, r) => t + r.actual, 0);
  return (
    <section className="surface-card overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Frais du marché</h2>
          <p className="text-xs text-ink2">Une ligne par type de dépense. Calculé : montant prévu par le contrat, dont la dépense saisie se déduit.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <button onClick={() => setManaging(true)} className="px-3 h-8 rounded-lg border border-line2 text-xs font-semibold hover:bg-surface2 inline-flex items-center gap-1"><Settings2 size={13} /> Types de dépenses</button>}
          {canAdd && <button onClick={() => setAdding(true)} className={buttonClass("primary", "sm")}><Plus size={14} /> Ajouter une dépense</button>}
        </div>
      </div>
      {rows.length === 0 ? <p className="px-5 py-5 text-sm text-ink3">Aucune dépense pour l&apos;instant. Exemple : frais bancaires, livraison, achat des fournitures.</p> : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>Type de dépense</th><th className="text-right">Engagé</th><th className="text-right">Réalisé</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.typeId ?? r.key} className="border-t border-line">
                  <td className="text-sm">{r.label} {r.estimated > 0 && <Pill tone="info">Calculé</Pill>}{r.accountCode && <span className="block text-[11px] text-ink3">Compte {r.accountCode}</span>}</td>
                  <td className="text-right font-mono">{r.committed ? formatMoney(r.committed) : "—"}</td>
                  <td className="text-right font-mono">{r.actual ? formatMoney(r.actual) : "—"}</td>
                  <td className="text-right font-mono font-semibold">{formatMoney(r.committed + r.actual)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line font-semibold"><td>Total</td><td className="text-right font-mono">{formatMoney(committed)}</td><td className="text-right font-mono">{formatMoney(actual)}</td><td className="text-right font-mono">{formatMoney(committed + actual)}</td></tr></tfoot>
          </table>
        </div>
      )}
      {projectId && <p className="px-5 py-2 border-t border-line text-[11px] text-ink3">Pour corriger ou annuler une dépense saisie : ouvrez-la dans « Recettes et dépenses imputées », plus bas. Une pénalité retenue s&apos;annule depuis la facture.</p>}
      {adding && <AddCostDialog contractId={contractId} f={f} onClose={() => setAdding(false)} onDone={text => { setAdding(false); showToast(text, "success"); onChange(); }} />}
      {managing && <TypesDialog onClose={() => { setManaging(false); onChange(); }} />}
    </section>
  );
}

function AddCostDialog({ contractId, f, onClose, onDone }: { contractId: string; f: MarketFinance; onClose: () => void; onDone: (text: string) => void }) {
  const [types, setTypes] = useState<CostType[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string }>>([]);
  const [v, setV] = useState({ typeId: "", newLabel: "", newAccount: "638000", amountHT: "", tvaRate: "0", date: todayLocal(), state: "paid", treasuryAccountId: "", invoiceId: "", supplierId: "", payee: "", supplierRef: "", description: "", dueDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const op = useOpKey();
  useEffect(() => {
    apiJson("/api/contracts/cost-types").then(d => setTypes((d?.data?.items ?? []).filter((t: CostType) => t.isActive))).catch(() => {});
    apiJson("/api/suppliers?picker=1").then(d => setSuppliers(d?.data?.items ?? [])).catch(() => {});
  }, []);
  const u = <K extends keyof typeof v>(k: K, x: string) => setV(p => ({ ...p, [k]: x }));
  const type = types.find(t => t._id === v.typeId);
  const fresh = v.typeId === NEW_TYPE;
  // Le montant calculé par le contrat se reprend d'un clic.
  function chooseType(id: string) {
    const t = types.find(x => x._id === id);
    const expected = t?.key === "regulation" ? f.terms.regulation.estimate - f.terms.regulation.recorded : t?.key === "penalty" ? (f.terms.penalty?.estimate ?? 0) - (f.terms.penalty?.recorded ?? 0) : 0;
    setV(p => ({ ...p, typeId: id, amountHT: expected > 0 ? String(expected) : p.amountHT, state: t?.key !== "penalty" && p.state === "withheld" ? "paid" : p.state }));
  }
  const amount = Number(v.amountHT || 0), ttc = Math.round(amount) + Math.round(amount * Number(v.tvaRate));
  const ready = amount > 0 && (type || (fresh && v.newLabel.trim())) && (v.state !== "paid" || v.treasuryAccountId) && (v.state !== "withheld" || v.invoiceId);
  const open = f.invoices.filter(i => i.documentType === "invoice" && ["sent", "partial", "overdue"].includes(i.status));
  async function submit() {
    setSaving(true); setError("");
    const res = await apiSend("POST", `/api/contracts/${contractId}/costs`, {
      ...(fresh ? { newType: { label: v.newLabel, accountCode: v.newAccount } } : { costTypeId: v.typeId }),
      amountHT: amount, tvaRate: Number(v.tvaRate), date: v.date, state: v.state, treasuryAccountId: v.treasuryAccountId || undefined, invoiceId: v.invoiceId || undefined,
      supplierId: v.supplierId || undefined, payee: v.payee || undefined, supplierRef: v.supplierRef || undefined, description: v.description || undefined, dueDate: v.dueDate || undefined,
    }, op.headers());
    setSaving(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement refusé."); return; }
    op.done();
    onDone(`Dépense ${res.data?.data?.number ?? ""} enregistrée.`);
  }
  return (
    <Modal open onClose={onClose} title="Ajouter une dépense du marché" size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Type de dépense" required hint={type ? `Compte ${type.accountCode}` : "Droits d'enregistrement et timbres : voir le panneau Enregistrement."}>
          <select className={selectCls} value={v.typeId} onChange={e => chooseType(e.target.value)}>
            <option value="">— Choisir —</option>
            {types.map(t => <option key={t._id} value={t._id}>{t.label}</option>)}
            <option value={NEW_TYPE}>+ Nouveau type de dépense…</option>
          </select>
        </FormField>
        {fresh && (
          <div className="grid sm:grid-cols-2 gap-3 p-3 rounded-lg bg-surface2">
            <FormField label="Nom du nouveau type" required><input className={inputCls} value={v.newLabel} onChange={e => u("newLabel", e.target.value)} placeholder="Frais de dédouanement, assurance…" /></FormField>
            <FormField label="Compte de charge" required hint="À défaut, laissez le compte proposé : le comptable pourra le changer."><AccountSelect value={v.newAccount} onChange={x => u("newAccount", x)} /></FormField>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant HT (FCFA)" required><input type="number" min={0} className={inputCls} value={v.amountHT} onChange={e => u("amountHT", e.target.value)} /></FormField>
          <FormField label="TVA récupérable">
            <select className={selectCls} value={v.tvaRate} onChange={e => u("tvaRate", e.target.value)}><option value="0">Sans TVA</option><option value="0.19">19 %</option></select>
          </FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={v.date} onChange={e => u("date", e.target.value)} /></FormField>
          <FormField label="État">
            <select className={selectCls} value={v.state} onChange={e => u("state", e.target.value)}><option value="paid">Payée</option><option value="due">À payer</option><option value="planned">Prévue (pas encore facturée)</option>{type?.key === "penalty" && <option value="withheld">Retenue par le client sur une facture</option>}</select>
          </FormField>
        </div>
        {v.state === "paid" && <FormField label="Payée depuis" required><TreasuryAccountSelect value={v.treasuryAccountId} onChange={x => u("treasuryAccountId", x)} /></FormField>}
        {v.state === "withheld" && (
          <FormField label="Facture concernée" required hint="Aucune sortie d'argent : la retenue réduit ce que le client doit sur cette facture.">
            <select className={selectCls} value={v.invoiceId} onChange={e => u("invoiceId", e.target.value)}><option value="">— Choisir —</option>{open.map(i => <option key={i._id} value={i._id}>{i.number} — reste {formatMoney(i.totalTTC - i.paidAmount)}</option>)}</select>
          </FormField>
        )}
        {v.state === "due" && <FormField label="À payer avant le"><input type="date" className={inputCls} value={v.dueDate} onChange={e => u("dueDate", e.target.value)} /></FormField>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Fournisseur">
            <select className={selectCls} value={v.supplierId} onChange={e => u("supplierId", e.target.value)}><option value="">— Sans fiche —</option>{suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
          </FormField>
          {!v.supplierId && <FormField label="Bénéficiaire"><input className={inputCls} value={v.payee} onChange={e => u("payee", e.target.value)} placeholder="Banque, Trésor, transporteur…" /></FormField>}
          <FormField label="N° de pièce"><input className={inputCls} value={v.supplierRef} onChange={e => u("supplierRef", e.target.value)} placeholder="Quittance, facture…" /></FormField>
          <FormField label="Libellé (facultatif)"><input className={inputCls} value={v.description} onChange={e => u("description", e.target.value)} /></FormField>
        </div>
        {Number(v.tvaRate) > 0 && amount > 0 && <p className="text-xs text-ink2">Total TTC : <b className="font-mono">{formatMoney(ttc)}</b>. Seul le HT compte dans la marge.</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !ready} className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Liste des types : nom, compte, activation. Une modification vaut pour les prochaines dépenses. */
function TypesDialog({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<CostType[]>([]);
  const [draft, setDraft] = useState({ label: "", accountCode: "638000" });
  const [error, setError] = useState("");
  const load = () => apiJson("/api/contracts/cost-types").then(d => setTypes(d?.data?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function patch(t: CostType, body: Record<string, unknown>) {
    setError("");
    const res = await apiSend("PATCH", `/api/contracts/cost-types/${t._id}`, body);
    if (!res.ok) setError(res.data?.error || "Modification refusée.");
    load();
  }
  async function add() {
    setError("");
    const res = await apiSend("POST", "/api/contracts/cost-types", draft);
    if (!res.ok) { setError(res.data?.error || "Création refusée."); return; }
    setDraft({ label: "", accountCode: "638000" });
    load();
  }
  return (
    <Modal open onClose={onClose} title="Types de dépenses des marchés" size="lg">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <p className="text-xs text-ink2">Les comptes proposés sont à valider par le comptable. Un changement s&apos;applique aux prochaines dépenses, pas à celles déjà comptabilisées.</p>
        <div className="divide-y divide-line">
          {types.map(t => (
            <div key={t._id} className="py-2 grid sm:grid-cols-12 gap-2 items-center">
              <input className={`${inputCls} sm:col-span-5`} defaultValue={t.label} aria-label="Nom du type" onBlur={e => { if (e.target.value.trim() && e.target.value !== t.label) patch(t, { label: e.target.value }); }} />
              <div className="sm:col-span-5"><AccountSelect value={t.accountCode} onChange={x => patch(t, { accountCode: x })} /></div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-ink2"><input type="checkbox" className="accent-section" checked={t.isActive} onChange={e => patch(t, { isActive: e.target.checked })} /> Actif</label>
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-12 gap-2 items-end pt-2 border-t border-line">
          <div className="sm:col-span-5"><FormField label="Nouveau type"><input className={inputCls} value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Frais de dédouanement…" /></FormField></div>
          <div className="sm:col-span-5"><FormField label="Compte de charge"><AccountSelect value={draft.accountCode} onChange={x => setDraft(d => ({ ...d, accountCode: x }))} /></FormField></div>
          <button onClick={add} disabled={!draft.label.trim()} className={`${buttonClass("secondary", "md")} sm:col-span-2`}><Plus size={14} /> Ajouter</button>
        </div>
        <div className="flex justify-end"><button onClick={onClose} className={buttonClass("primary", "md")}>Fermer</button></div>
      </div>
    </Modal>
  );
}
