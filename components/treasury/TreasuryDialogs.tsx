"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";

export interface TreasuryAccountLite { _id: string; label: string; type: string; balance: number; openingBalance: number; movementCount: number; isActive: boolean; bankName?: string; accountNumber?: string }

async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Opération refusée");
  return d.data;
}
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("fr-FR");

export function EditAccountDialog({ account, onClose, onDone }: { account: TreasuryAccountLite; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ label: account.label, bankName: account.bankName ?? "", accountNumber: account.accountNumber ?? "", openingBalance: account.openingBalance, type: account.type });
  const [error, setError] = useState("");
  const locked = account.movementCount > 0;
  async function save() {
    try {
      await send(`/api/treasury-accounts/${account._id}`, "PATCH", locked ? { label: f.label, bankName: f.bankName, accountNumber: f.accountNumber } : f);
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Modification impossible"); }
  }
  async function toggle() {
    try { await send(`/api/treasury-accounts/${account._id}`, "PATCH", { isActive: !account.isActive }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Opération impossible"); }
  }
  async function remove() {
    if (!confirm("Supprimer ce compte ?")) return;
    try { await send(`/api/treasury-accounts/${account._id}`, "DELETE"); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); }
  }
  return (
    <Modal open onClose={onClose} title={`Compte — ${account.label}`}>
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Libellé" required><input className={inputCls} value={f.label} onChange={e => setF(p => ({ ...p, label: e.target.value }))} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Banque / opérateur"><input className={inputCls} value={f.bankName} onChange={e => setF(p => ({ ...p, bankName: e.target.value }))} /></FormField>
          <FormField label="N° de compte"><input className={inputCls} value={f.accountNumber} onChange={e => setF(p => ({ ...p, accountNumber: e.target.value }))} /></FormField>
        </div>
        {!locked && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select className={selectCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>
                <option value="bank">Banque</option><option value="cash">Caisse</option><option value="mobile_money">Mobile Money</option>
              </select>
            </FormField>
            <FormField label="Solde d'ouverture"><input type="number" className={inputCls} value={f.openingBalance} onChange={e => setF(p => ({ ...p, openingBalance: Number(e.target.value) }))} /></FormField>
          </div>
        )}
        {locked && <p className="text-xs text-ink3">Des mouvements existent : type et solde d&apos;ouverture sont figés.</p>}
        <div className="flex justify-between gap-2 pt-2 border-t border-line">
          <div className="flex gap-2">
            <button onClick={toggle} className="px-3 h-10 rounded-lg border border-line2 text-sm hover:bg-surface2">{account.isActive ? "Désactiver" : "Réactiver"}</button>
            {!locked && <button onClick={remove} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">Supprimer</button>}
          </div>
          <button onClick={save} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold">Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}

export function TransferDialog({ accounts, onClose, onDone }: { accounts: TreasuryAccountLite[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fromAccountId: "", toAccountId: "", amount: 0, date: today(), label: "", reference: "" });
  const [error, setError] = useState("");
  async function submit() {
    try { await send("/api/treasury-accounts/movements", "POST", { kind: "transfer", ...f }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Virement impossible"); }
  }
  return (
    <Modal open onClose={onClose} title="Virement interne">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Retrait à la banque pour alimenter la caisse, dépôt d&apos;espèces, transfert vers le mobile money…</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Depuis" required>
            <select className={selectCls} value={f.fromAccountId} onChange={e => setF(p => ({ ...p, fromAccountId: e.target.value }))}>
              <option value="">—</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label} ({fmt(a.balance)})</option>)}
            </select>
          </FormField>
          <FormField label="Vers" required>
            <select className={selectCls} value={f.toAccountId} onChange={e => setF(p => ({ ...p, toAccountId: e.target.value }))}>
              <option value="">—</option>{accounts.filter(a => a._id !== f.fromAccountId).map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
            </select>
          </FormField>
          <FormField label="Montant" required><input type="number" min={1} className={inputCls} value={f.amount || ""} onChange={e => setF(p => ({ ...p, amount: Number(e.target.value) }))} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
        </div>
        <FormField label="Libellé"><input className={inputCls} value={f.label} onChange={e => setF(p => ({ ...p, label: e.target.value }))} placeholder="Retrait pour la caisse" /></FormField>
        <FormField label="Référence (bordereau, chèque…)"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></FormField>
        <button onClick={submit} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold">Enregistrer le virement</button>
      </div>
    </Modal>
  );
}

const COUNTER_PRESETS = [
  ["627000", "Frais bancaires (sortie)"], ["631000", "Frais bancaires — services"], ["758000", "Produits divers (entrée)"],
  ["771000", "Intérêts reçus (entrée)"], ["101000", "Apport en capital (entrée)"], ["162000", "Emprunt reçu (entrée)"], ["471000", "Débiteurs / créditeurs divers"],
];

export function ManualMovementDialog({ accounts, onClose, onDone }: { accounts: TreasuryAccountLite[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ accountId: accounts.length === 1 ? accounts[0]._id : "", direction: "out", amount: 0, date: today(), label: "", counterAccount: "627000", reference: "" });
  const [imp, setImp] = useState<ImputationValue>({});
  const [error, setError] = useState("");
  async function submit() {
    try { await send("/api/treasury-accounts/movements", "POST", { kind: "manual", ...f, ...imp }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Opération refusée"); }
  }
  return (
    <Modal open onClose={onClose} title="Opération de trésorerie">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Pour une entrée ou sortie sans document (frais bancaires, apport, intérêts…). Une dépense fournisseur se saisit dans « Achats & dépenses ».</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Compte" required>
            <select className={selectCls} value={f.accountId} onChange={e => setF(p => ({ ...p, accountId: e.target.value }))}>
              <option value="">—</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
            </select>
          </FormField>
          <FormField label="Sens">
            <select className={selectCls} value={f.direction} onChange={e => setF(p => ({ ...p, direction: e.target.value }))}>
              <option value="in">Entrée</option><option value="out">Sortie</option>
            </select>
          </FormField>
          <FormField label="Montant" required><input type="number" min={1} className={inputCls} value={f.amount || ""} onChange={e => setF(p => ({ ...p, amount: Number(e.target.value) }))} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
        </div>
        <FormField label="Libellé" required><input className={inputCls} value={f.label} onChange={e => setF(p => ({ ...p, label: e.target.value }))} /></FormField>
        <FormField label="Compte de contrepartie" hint="Numéro du plan comptable">
          <input className={inputCls} list="counter-presets" value={f.counterAccount} onChange={e => setF(p => ({ ...p, counterAccount: e.target.value.replace(/\D/g, "") }))} />
          <datalist id="counter-presets">{COUNTER_PRESETS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</datalist>
        </FormField>
        {/^[67]/.test(f.counterAccount) && <ImputationFields value={imp} onChange={setImp} />}
        <FormField label="Référence"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></FormField>
        <button onClick={submit} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold">Enregistrer</button>
      </div>
    </Modal>
  );
}

interface Movement { _id: string; date: string; amount: number; label: string; reference?: string; source: string; statementLineId?: string }

export function MovementsDialog({ account, onClose }: { account: TreasuryAccountLite; onClose: () => void }) {
  const [items, setItems] = useState<Movement[]>([]);
  useEffect(() => {
    fetch(`/api/treasury-accounts/movements?accountId=${account._id}&limit=100`, { credentials: "include" }).then(r => r.json()).then(d => setItems(d.data?.items ?? [])).catch(() => {});
  }, [account._id]);
  const SRC: Record<string, string> = { payment: "Encaissement", expense: "Dépense", payroll: "Salaire", transfer: "Virement", manual: "Manuel", import: "Import" };
  return (
    <Modal open onClose={onClose} title={`Mouvements — ${account.label}`} size="lg">
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="table-dense w-full">
          <thead><tr className="text-left text-ink2"><th>Date</th><th>Libellé</th><th>Origine</th><th className="text-right">Montant</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={4} className="text-center text-ink3 py-6">Aucun mouvement</td></tr>}
            {items.map(m => (
              <tr key={m._id} className="border-t border-line">
                <td className="text-xs whitespace-nowrap">{new Date(m.date).toLocaleDateString("fr-FR")}</td>
                <td className="text-xs">{m.label}{m.reference && <span className="text-ink3"> · {m.reference}</span>}</td>
                <td className="text-xs text-ink2">{SRC[m.source] ?? m.source}{m.statementLineId ? " · rapproché" : ""}</td>
                <td className={`text-right font-mono ${m.amount >= 0 ? "text-pos" : "text-neg"}`}>{m.amount >= 0 ? "+" : ""}{fmt(m.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
