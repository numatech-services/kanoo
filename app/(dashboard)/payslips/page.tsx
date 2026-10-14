"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Users, X } from "lucide-react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { useMe, meCanDo } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
interface Employee {
  _id: string; firstName: string; lastName: string; code: string;
  employeeType?: string; indemnityPeriod?: string; grossSalary?: number;
}
interface Payslip {
  _id: string; employeeId: { firstName: string; lastName: string; code: string } | string;
  month: number; year: number; grossSalary: number; grossTotal?: number; cnssEmployee: number; cnssEmployer: number;
  incomeTax?: number; netSalary: number; isPaid: boolean;
}
interface Item { label: string; amount: number; type: "addition" | "deduction" }
interface BatchResult {
  created: Array<{ name: string; netSalary: number; alerts: string[] }>;
  skipped: Array<{ name: string; reason: string }>;
  totalNet: number;
}

const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");


export default function PayslipsPage() {
  const router = useRouter();
  const me = useMe();
  const canCreate = meCanDo(me, "payslips", "create");
  const canDelete = meCanDo(me, "payslips", "delete");
  const now = new Date();
  const [filter, setFilter] = useState({ year: now.getFullYear(), month: 0 });
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [single, setSingle] = useState(false);
  const [batch, setBatch] = useState(false);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), year: String(filter.year) });
    if (filter.month) params.set("month", String(filter.month));
    const d = await apiJson(`/api/payslips?${params}`).catch(() => null);
    setPayslips(d?.data?.items || []);
    setTotal(d?.data?.pagination?.total || 0);
    setLoading(false);
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Seuls les salariés actifs peuvent recevoir un bulletin.
    apiJson("/api/employees?limit=100&isActive=true").then(d => setEmployees(d.data?.items || [])).catch(() => {});
  }, []);

  async function remove(p: Payslip) {
    if (!(await confirmDialog({ title: "Supprimer ce bulletin non payé ?", message: "Son écriture de paie sera extournée.", danger: true, confirmLabel: "Supprimer" }))) return;
    const res = await apiSend("DELETE", `/api/payslips/${p._id}`);
    if (!res.ok) { const d = res.data; showToast(d.error || "Suppression impossible", "error"); return; }
    load();
  }

  const columns: Column<Payslip>[] = [
    {
      key: "employeeId", label: "Salarié",
      render: (v, row) => (
        <button onClick={() => router.push(`/payslips/${row._id}`)} className="text-section font-semibold hover:underline text-left">
          {typeof v === "object" && v ? `${(v as { firstName: string }).firstName} ${(v as { lastName: string }).lastName}` : "—"}
        </button>
      ),
    },
    { key: "month", label: "Période", render: (v, row) => `${MONTHS[Number(v)]} ${row.year}` },
    { key: "grossTotal", label: "Brut total", className: "text-right font-mono", render: (v, row) => fmt(v ?? row.grossSalary) },
    { key: "cnssEmployee", label: "CNSS sal.", className: "text-right font-mono text-warn", render: v => `−${fmt(v)}` },
    { key: "incomeTax", label: "IR", className: "text-right font-mono text-warn", render: v => `−${fmt(v)}` },
    { key: "netSalary", label: "Net à payer", className: "text-right font-mono font-bold text-pos", render: v => fmt(v) },
    { key: "cnssEmployer", label: "CNSS pat.", className: "text-right font-mono text-ink2", render: v => fmt(v) },
    {
      key: "isPaid", label: "Statut",
      render: (v, row) => (
        <span className="inline-flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${v ? "bg-pos-50 text-pos" : "bg-warn-50 text-warn"}`}>{v ? "Payé" : "À payer"}</span>
          {!v && canDelete && (
            <button onClick={() => remove(row)} title="Supprimer ce bulletin" className="p-1 rounded text-ink3 hover:text-neg hover:bg-neg-50"><Trash2 size={14} /></button>
          )}
        </span>
      ),
    },
  ];

  const pageNet = payslips.reduce((s, p) => s + (p.netSalary || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Bulletins de paie</h1>
          <p className="text-sm text-ink2">{total} bulletin{total > 1 ? "s" : ""} · net affiché : {fmt(pageNet)} FCFA</p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <button onClick={() => setBatch(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink hover:bg-surface2">
              <Users size={16} /> Paie du mois (tous)
            </button>
            <button onClick={() => setSingle(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
              <Plus size={16} /> Un bulletin
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <select className={`${selectCls} w-auto`} value={filter.month} onChange={e => { setPage(1); setFilter(f => ({ ...f, month: Number(e.target.value) })); }} aria-label="Mois">
          <option value={0}>Tous les mois</option>
          {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" className={`${inputCls} w-28`} value={filter.year} aria-label="Année"
          onChange={e => { setPage(1); setFilter(f => ({ ...f, year: Number(e.target.value) })); }} />
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <DataTable columns={columns} data={payslips} loading={loading} keyExtractor={p => p._id} emptyMessage="Aucun bulletin pour cette période" />
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      {single && <SingleDialog employees={employees} onClose={() => setSingle(false)} onDone={() => { setSingle(false); load(); }} />}
      {batch && <BatchDialog onClose={() => { setBatch(false); load(); }} />}
    </div>
  );
}

function ItemsEditor({ items, onChange }: { items: Item[]; onChange: (i: Item[]) => void }) {
  const set = (i: number, patch: Partial<Item>) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink2">Primes et retenues du mois</p>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select className={`${selectCls} w-32`} value={it.type} onChange={e => set(i, { type: e.target.value as Item["type"] })} aria-label="Sens">
            <option value="addition">Prime</option>
            <option value="deduction">Retenue</option>
          </select>
          <input className={inputCls} placeholder="Libellé (ex. prime de rendement, avance)" value={it.label} onChange={e => set(i, { label: e.target.value })} />
          <input type="number" min={0} className={`${inputCls} w-32`} placeholder="Montant" value={it.amount || ""} onChange={e => set(i, { amount: Number(e.target.value) })} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-2 text-ink3 hover:text-neg" aria-label="Retirer"><X size={15} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { label: "", amount: 0, type: "addition" }])} className="text-xs text-section font-semibold hover:underline">
        + Ajouter une prime ou une retenue
      </button>
      <p className="text-[11px] text-ink3">La retenue permanente de la fiche (avance, prêt…) s&apos;ajoute automatiquement.</p>
    </div>
  );
}

function SingleDialog({ employees, onClose, onDone }: { employees: Employee[]; onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const [f, setF] = useState({ employeeId: "", month: now.getMonth() + 1, year: now.getFullYear(), grossSalary: 0, units: 0 });
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const emp = employees.find(e => e._id === f.employeeId);
  const needsUnits = emp && emp.employeeType !== "employee" && (emp.indemnityPeriod === "daily" || emp.indemnityPeriod === "hourly");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.employeeId) { setError("Choisissez un salarié."); return; }
    setSaving(true); setError("");
    const res = await apiSend("POST", "/api/payslips", {
        employeeId: f.employeeId, month: f.month, year: f.year,
        ...(f.grossSalary > 0 ? { grossSalary: f.grossSalary } : {}),
        ...(needsUnits ? { units: f.units } : {}),
        items: items.filter(i => i.label && i.amount > 0),
      });
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Génération impossible"); return; }
    if (d.data?.alerts?.length) { setAlerts(d.data.alerts); return; }
    onDone();
  }

  return (
    <Modal open onClose={alerts.length ? onDone : onClose} title="Générer un bulletin" size="lg">
      {alerts.length ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">Bulletin généré, avec des points à vérifier :</p>
          <ul className="list-disc pl-5 text-sm text-warn">{alerts.map(a => <li key={a}>{a}</li>)}</ul>
          <button onClick={onDone} className={buttonClass("primary", "md")}>Fermer</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
          <FormField label="Salarié" required>
            <select className={selectCls} value={f.employeeId} onChange={e => setF(p => ({ ...p, employeeId: e.target.value }))} required>
              <option value="">— Choisir —</option>
              {employees.map(e => <option key={e._id} value={e._id}>{e.lastName} {e.firstName} ({e.code})</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mois">
              <select className={selectCls} value={f.month} onChange={e => setF(p => ({ ...p, month: Number(e.target.value) }))}>
                {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Année"><input type="number" className={inputCls} value={f.year} onChange={e => setF(p => ({ ...p, year: Number(e.target.value) }))} /></FormField>
          </div>
          {emp?.employeeType === "employee" && (
            <FormField label="Salaire de base du mois" hint={`Laisser vide : salaire de la fiche (${fmt(emp.grossSalary)} FCFA)`}>
              <input type="number" min={0} className={inputCls} value={f.grossSalary || ""} onChange={e => setF(p => ({ ...p, grossSalary: Number(e.target.value) }))} />
            </FormField>
          )}
          {needsUnits && (
            <FormField label={emp?.indemnityPeriod === "daily" ? "Jours travaillés" : "Heures travaillées"} required>
              <input type="number" min={0} step="0.5" className={inputCls} value={f.units || ""} onChange={e => setF(p => ({ ...p, units: Number(e.target.value) }))} required />
            </FormField>
          )}
          <ItemsEditor items={items} onChange={setItems} />
          <p className="text-[11px] text-ink3">CNSS, IR, ancienneté et retenue permanente sont calculés d&apos;après la fiche du salarié.</p>
          <button type="submit" disabled={saving} className={buttonClass("primary", "md", "w-full")}>
            {saving ? "Génération…" : "Générer le bulletin"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function BatchDialog({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [f, setF] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function run() {
    setSaving(true); setError("");
    const res = await apiSend("POST", "/api/payslips/batch", f);
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Paie du mois impossible"); return; }
    setResult(d.data);
  }

  return (
    <Modal open onClose={onClose} title="Paie du mois — tous les salariés actifs" size="lg">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-ink"><b>{result.created.length}</b> bulletin(s) générés · net total <b>{fmt(result.totalNet)} FCFA</b></p>
          {result.created.some(c => c.alerts.length) && (
            <ul className="text-xs text-warn list-disc pl-5">
              {result.created.filter(c => c.alerts.length).map(c => <li key={c.name}>{c.name} : {c.alerts.join(" ; ")}</li>)}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-line2 p-3">
              <p className="text-xs font-semibold text-ink2 mb-1">Non générés ({result.skipped.length})</p>
              <ul className="text-xs text-ink2 space-y-0.5">{result.skipped.map(s => <li key={s.name}>{s.name} — {s.reason}</li>)}</ul>
            </div>
          )}
          <button onClick={onClose} className={buttonClass("primary", "md")}>Fermer</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink2">Un bulletin est créé pour chaque salarié actif qui n&apos;en a pas encore pour ce mois, avec les réglages de sa fiche. Les primes ponctuelles se saisissent bulletin par bulletin.</p>
          {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mois">
              <select className={selectCls} value={f.month} onChange={e => setF(p => ({ ...p, month: Number(e.target.value) }))}>
                {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Année"><input type="number" className={inputCls} value={f.year} onChange={e => setF(p => ({ ...p, year: Number(e.target.value) }))} /></FormField>
          </div>
          <button onClick={run} disabled={saving} className={buttonClass("primary", "md", "w-full")}>
            {saving ? "Calcul en cours…" : `Générer la paie de ${MONTHS[f.month]} ${f.year}`}
          </button>
        </div>
      )}
    </Modal>
  );
}
