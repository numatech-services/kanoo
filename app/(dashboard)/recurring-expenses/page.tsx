"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Banknote, Edit3, Trash2, Power } from "lucide-react";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";
import { EXPENSE_ACCOUNTS } from "@/lib/syscohada";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken, apiJson } from "@/lib/api-client";
type Ref = { _id: string; label?: string; name?: string } | null;
interface Expense {
  _id: string; label: string; category: string; amount: number; frequency: string; nextDueDate: string; accountCode?: string; tvaRate?: number;
  treasuryAccountId: Ref | string; supplierId?: Ref | string; isActive: boolean; description?: string;
  projectId?: string; activityId?: string; costCenter?: string; executions?: Array<{ executedAt: string; amount: number }>;
}
interface Account { _id: string; label: string; type: string }

const CATEGORIES: Record<string, string> = { loyer: "Loyer", electricite: "Électricité", eau: "Eau", internet: "Internet", telephone: "Téléphone", assurance: "Assurance", abonnement: "Abonnement", salaire: "Salaire", prestation: "Prestation", maintenance: "Maintenance", fourniture: "Fournitures", transport: "Transport", autre: "Autre" };
const FREQ: Record<string, string> = { monthly: "Mensuelle", quarterly: "Trimestrielle", biannual: "Semestrielle", annual: "Annuelle", weekly: "Hebdomadaire", daily: "Quotidienne" };
const DEFAULT_ACCOUNT: Record<string, string> = { loyer: "622100", electricite: "605200", eau: "605100", internet: "628300", telephone: "628100", assurance: "625000", abonnement: "634000", prestation: "632400", maintenance: "624100", fourniture: "605500", transport: "618000", salaire: "661000", autre: "658000" };
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const idOf = (v: Ref | string | undefined) => (v && typeof v === "object" ? v._id : v ? String(v) : "");
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Opération refusée");
  return d.data;
}

/** Charges récurrentes : loyers, abonnements, énergie… — payées à l'échéance, imputées. */
export default function RecurringExpensesPage() {
  const me = useMe();
  const canCreate = meCanDo(me, "recurringCharges", "create");
  const canEdit = meCanDo(me, "recurringCharges", "update");
  const canDelete = meCanDo(me, "recurringCharges", "delete");
  const [items, setItems] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [error, setError] = useState("");
  const LIMIT = 20;

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (!showInactive) q.set("isActive", "true");
    const d = await apiJson(`/api/recurring-expenses?${q}`).catch(() => null);
    setItems(d?.data?.items ?? []); setTotal(d?.data?.pagination?.total ?? 0); setMonthlyTotal(d?.data?.monthlyTotal ?? 0);
  }, [page, showInactive]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiJson("/api/treasury-accounts").then(d => setAccounts(d.data?.items ?? [])).catch(() => {}); }, []);
  async function run(fn: () => Promise<unknown>) { setError(""); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); } }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Charges récurrentes</h1>
          <p className="text-sm text-ink2">Engagement mensuel estimé : <b className="text-ink">{fmt(monthlyTotal)} FCFA</b></p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" className="accent-section" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Désactivées</label>
          {canCreate && <button onClick={() => setEditing("new")} className={buttonClass("primary", "md")}><Plus size={16} /> Nouvelle charge</button>}
        </div>
      </div>
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th>Charge</th><th>Fréquence</th><th className="text-right">Montant</th><th>Prochaine échéance</th><th>Compte payeur</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="text-center text-ink3 py-8">Aucune charge</td></tr>}
            {items.map(x => {
              const due = new Date(x.nextDueDate);
              const late = x.isActive && due < today;
              return (
                <tr key={x._id} className={`border-t border-line ${x.isActive ? "" : "opacity-50"}`}>
                  <td><span className="font-medium text-ink">{x.label}</span><span className="block text-[11px] text-ink3">{CATEGORIES[x.category] ?? x.category} · compte {x.accountCode}{typeof x.supplierId === "object" && x.supplierId?.name ? ` · ${x.supplierId.name}` : ""}</span></td>
                  <td className="text-xs">{FREQ[x.frequency] ?? x.frequency}</td>
                  <td className="text-right font-mono">{fmt(x.amount)}</td>
                  <td className={`text-xs ${late ? "text-neg font-semibold" : ""}`}>{due.toLocaleDateString("fr-FR")}{late ? " · en retard" : ""}</td>
                  <td className="text-xs">{typeof x.treasuryAccountId === "object" && x.treasuryAccountId ? x.treasuryAccountId.label : "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    {canEdit && x.isActive && <button onClick={() => setPaying(x)} className="px-2 h-8 inline-flex items-center gap-1 rounded-md bg-pos text-onink text-xs font-semibold"><Banknote size={13} /> Payer</button>}
                    {canEdit && <button onClick={() => setEditing(x)} className="ml-1 p-1.5 text-ink3 hover:text-ink" title="Modifier"><Edit3 size={14} /></button>}
                    {canEdit && <button onClick={() => run(() => send(`/api/recurring-expenses/${x._id}`, "PATCH", { isActive: !x.isActive }))} className="p-1.5 text-ink3 hover:text-warn" title={x.isActive ? "Désactiver" : "Réactiver"}><Power size={14} /></button>}
                    {canDelete && <button onClick={async () => { if (await confirmDialog({ title: "Supprimer cette charge ?", message: "(déjà payée : elle sera seulement désactivée)", danger: true })) run(() => send(`/api/recurring-expenses/${x._id}`, "DELETE")); }} className="p-1.5 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      {editing && <ChargeDialog charge={editing === "new" ? null : editing} accounts={accounts} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {paying && <PayDialog charge={paying} accounts={accounts} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load(); }} />}
    </div>
  );
}

function ChargeDialog({ charge, accounts, onClose, onDone }: { charge: Expense | null; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    label: charge?.label ?? "", category: charge?.category ?? "loyer", amount: charge?.amount ?? 0, frequency: charge?.frequency ?? "monthly",
    startDate: new Date().toISOString().slice(0, 10), nextDueDate: charge?.nextDueDate?.slice(0, 10) ?? "",
    accountCode: charge?.accountCode ?? "622100", tvaRate: charge?.tvaRate ?? 0, treasuryAccountId: idOf(charge?.treasuryAccountId), supplierId: idOf(charge?.supplierId), description: charge?.description ?? "",
  });
  const [imp, setImp] = useState<ImputationValue>({ projectId: charge?.projectId, activityId: charge?.activityId, costCenter: charge?.costCenter });
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string }>>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/suppliers?limit=100", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data?.items && setSuppliers(d.data.items)).catch(() => {}); }, []);
  const u = (k: keyof typeof f, v: string | number) => setF(p => ({ ...p, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, ...imp, projectId: imp.projectId ?? null, activityId: imp.activityId ?? null, costCenter: imp.costCenter ?? null, treasuryAccountId: f.treasuryAccountId || null, supplierId: f.supplierId || null };
    try {
      if (charge) { const { startDate: _s, ...rest } = body; await send(`/api/recurring-expenses/${charge._id}`, "PATCH", { ...rest, nextDueDate: f.nextDueDate || undefined }); }
      else await send("/api/recurring-expenses", "POST", body);
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Enregistrement impossible"); }
  }
  return (
    <Modal open onClose={onClose} title={charge ? `Modifier — ${charge.label}` : "Nouvelle charge récurrente"} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Libellé" required><input className={inputCls} value={f.label} onChange={e => u("label", e.target.value)} required /></FormField>
          <FormField label="Catégorie">
            <select className={selectCls} value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value, accountCode: DEFAULT_ACCOUNT[e.target.value] ?? p.accountCode }))}>
              {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="Montant (FCFA)" required><input type="number" min={1} className={inputCls} value={f.amount || ""} onChange={e => u("amount", Number(e.target.value))} /></FormField>
          <FormField label="TVA comprise dans le montant" hint="Récupérable : déduite de la TVA à reverser.">
            <select className={selectCls} value={f.tvaRate} onChange={e => u("tvaRate", Number(e.target.value))}>
              <option value={0}>Sans TVA</option><option value={0.19}>19 %</option><option value={0.1}>10 %</option>
            </select>
          </FormField>
          <FormField label="Fréquence">
            <select className={selectCls} value={f.frequency} onChange={e => u("frequency", e.target.value)}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </FormField>
          {charge
            ? <FormField label="Prochaine échéance"><input type="date" className={inputCls} value={f.nextDueDate} onChange={e => u("nextDueDate", e.target.value)} /></FormField>
            : <FormField label="Première échéance" required><input type="date" className={inputCls} value={f.startDate} onChange={e => u("startDate", e.target.value)} /></FormField>}
          <FormField label="Compte de charge">
            <select className={selectCls} value={f.accountCode} onChange={e => u("accountCode", e.target.value)}>
              {EXPENSE_ACCOUNTS.filter(a => a.code.startsWith("6")).map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
            </select>
          </FormField>
          <FormField label="Compte qui paie (par défaut)">
            <select className={selectCls} value={f.treasuryAccountId} onChange={e => u("treasuryAccountId", e.target.value)}>
              <option value="">—</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
            </select>
          </FormField>
          <FormField label="Fournisseur">
            <select className={selectCls} value={f.supplierId} onChange={e => u("supplierId", e.target.value)}>
              <option value="">—</option>{suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </FormField>
        </div>
        <div><p className="text-sm font-semibold text-ink mb-1">Imputation</p><ImputationFields value={imp} onChange={setImp} /></div>
        <button type="submit" className={buttonClass("primary", "md", "w-full")}>Enregistrer</button>
      </form>
    </Modal>
  );
}

function PayDialog({ charge, accounts, onClose, onDone }: { charge: Expense; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ treasuryAccountId: idOf(charge.treasuryAccountId), amount: charge.amount, date: new Date().toISOString().slice(0, 10), reference: "" });
  const [error, setError] = useState("");
  async function submit() {
    try { await send(`/api/recurring-expenses/${charge._id}`, "POST", f); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Paiement impossible"); }
  }
  return (
    <Modal open onClose={onClose} title={`Payer — ${charge.label}`}>
      <div className="space-y-4">
        <p className="text-sm text-ink2">Échéance du {new Date(charge.nextDueDate).toLocaleDateString("fr-FR")}. Le décaissement et l&apos;écriture sont enregistrés ; l&apos;échéance suivante est calculée.</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Compte qui paie" required>
          <select className={selectCls} value={f.treasuryAccountId} onChange={e => setF(p => ({ ...p, treasuryAccountId: e.target.value }))}>
            <option value="">—</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant"><input type="number" min={1} className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: Number(e.target.value) }))} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
        </div>
        <FormField label="Référence"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></FormField>
        <button onClick={submit} className="w-full h-10 rounded-lg bg-pos text-onink text-sm font-semibold">Payer</button>
      </div>
    </Modal>
  );
}
