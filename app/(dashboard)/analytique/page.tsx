"use client";

import { useCallback, useEffect, useState } from "react";
import { PieChart, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { FlowFilterBar, useFlowFilter, today, type FlowTotals } from "@/components/ui/FlowFilterBar";

import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import {apiJson, apiSend } from "@/lib/api-client";
interface Activity { _id: string; name: string; color?: string }
interface Sector { activityId: string; name: string; color?: string; revenue: number; expense: number; result: number; fromAccounting?: { revenue: number; expense: number } }
interface Report { sectors: Sector[]; general: { revenue: number; expense: number }; consolidated: { revenue: number; expense: number; result: number } | null; isAdmin: boolean }
interface Entry { _id: string; kind: string; label: string; amount: number; date: string; activityId?: { name?: string } | null }


export default function AnalytiquePage() {
  const [report, setReport] = useState<Report | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<FlowTotals | null>(null);
  const [sector, setSector] = useState("");
  const filter = useFlowFilter({ from: `${new Date().getFullYear()}-01-01`, to: today() });
  const [form, setForm] = useState({ kind: "revenue", activityId: "", label: "", amount: 0, date: new Date().toISOString().slice(0, 10) });

  const load = useCallback(() => {
    // La période du filtre s'applique aussi à la rentabilité par secteur.
    const period = new URLSearchParams();
    if (filter.from) period.set("from", filter.from);
    if (filter.to) period.set("to", filter.to);
    apiJson(`/api/analytics/report?${period}`).then(d => setReport(d.data || null));
    apiJson("/api/analytics/activities").then(d => setActivities(d.data || []));
    const q = new URLSearchParams(filter.query);
    q.set("limit", "100");
    if (sector) q.set("activityId", sector);
    apiJson(`/api/analytics/entries?${q}`)
      .then(d => { setEntries(d.data?.items || []); setTotals(d.data?.totals ?? null); });
  }, [filter.query, filter.from, filter.to, sector]);
  useEffect(() => { load(); }, [load]);

  async function addSector() {
    const name = await promptDialog({ title: "Nom du secteur (ex. Vente mobilier, ISIC, Abonnements) :" }); if (!name) return;
    const res = await apiSend("POST", "/api/analytics/activities", { name });
    if (res.ok) load(); else showToast((res.data).error || "Échec", "error");
  }
  async function addEntry() {
    if (!form.label.trim() || form.amount <= 0) { showToast("Libellé et montant requis.", "warning"); return; }
    const res = await apiSend("POST", "/api/analytics/entries", form);
    if (res.ok) { setForm(f => ({ ...f, label: "", amount: 0 })); load(); } else showToast((res.data).error || "Échec", "error");
  }
  async function delEntry(id: string) {
    const res = await apiSend("DELETE", `/api/analytics/entries/${id}`);
    if (res.ok) load();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="page-head">
        <div>
          <h1 className="page-title flex items-center gap-2"><PieChart size={22} /> Secteurs</h1>
          <p className="text-sm text-ink2">Rentabilité par secteur : recettes − dépenses imputées = résultat de chaque activité.</p>
        </div>
        <button onClick={addSector} className={buttonClass("secondary", "md")}><Plus size={16} /> Secteur</button>
      </div>

      {/* Consolidé — administrateur seulement */}
      {report?.consolidated && (
        <div className="rounded-2xl border border-line bg-section-soft/40 p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-section">Santé financière de l'entreprise · réservé à la direction</p>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div><p className="text-xs text-ink2">Recettes totales</p><p className="text-xl font-bold text-ink">{formatMoney(report.consolidated.revenue)}</p></div>
            <div><p className="text-xs text-ink2">Dépenses totales</p><p className="text-xl font-bold text-ink">{formatMoney(report.consolidated.expense)}</p></div>
            <div><p className="text-xs text-ink2">Résultat net</p><p className={`text-xl font-bold ${report.consolidated.result >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(report.consolidated.result)}</p></div>
          </div>
        </div>
      )}

      {/* Rentabilité par secteur */}
      <section className="surface-card overflow-hidden">
        <h2 className="font-semibold text-ink px-5 py-4 border-b border-line">Rentabilité par activité</h2>
        {!report || report.sectors.length === 0 ? (
          <p className="text-sm text-ink3 p-6 text-center">Aucun secteur. Créez-en un (bouton « Secteur ») : factures, achats, notes de frais et charges imputés au secteur y remontent automatiquement.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr className="bg-surface2/50"><th>Secteur</th><th className="text-right">Recettes</th><th className="text-right">Dépenses</th><th className="text-right">Résultat</th><th></th></tr></thead>
            <tbody>
              {report.sectors.map(s => (
                <tr key={s.activityId} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink">{s.name}
                    {s.fromAccounting && (s.fromAccounting.revenue !== 0 || s.fromAccounting.expense !== 0) && (
                      <span className="block text-[11px] text-ink3 font-normal">dont comptabilité : +{formatMoney(s.fromAccounting.revenue)} / −{formatMoney(s.fromAccounting.expense)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(s.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-ink2">{formatMoney(s.expense)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${s.result >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(s.result)}</td>
                  <td className="px-4 py-2.5 text-right">{s.result >= 0 ? <TrendingUp size={15} className="text-pos inline" /> : <TrendingDown size={15} className="text-neg inline" />}</td>
                </tr>
              ))}
              {(report.general.revenue > 0 || report.general.expense > 0) && (
                <tr className="border-t border-line bg-surface2/30">
                  <td className="px-4 py-2.5 italic text-ink2">Frais généraux (non imputés)</td>
                  <td className="px-4 py-2.5 text-right">{report.general.revenue ? formatMoney(report.general.revenue) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-ink2">{formatMoney(report.general.expense)}</td>
                  <td className="px-4 py-2.5 text-right text-ink3">—</td><td />
                </tr>
              )}
            </tbody>
          </table></div>
        )}
      </section>

      {/* Saisie d'une écriture */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">Imputer une recette ou une dépense</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <FormField label="Type"><select className={selectCls} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}><option value="revenue">Recette</option><option value="expense">Dépense</option></select></FormField>
          <FormField label="Secteur"><select className={selectCls} value={form.activityId} onChange={e => setForm(f => ({ ...f, activityId: e.target.value }))}><option value="">Frais généraux</option>{activities.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}</select></FormField>
          <FormField label="Libellé"><input className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex. Licences ISIC nov." /></FormField>
          <FormField label="Montant (FCFA)"><input type="number" min={1} className={inputCls} value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} /></FormField>
          <button onClick={addEntry} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </section>

      {/* Écritures : filtre recettes / dépenses, secteur et période */}
      <section className="surface-card overflow-hidden">
        <div className="px-5 py-4 border-b border-line space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Écritures</h2>
            <select className={`${selectCls} w-auto`} value={sector} onChange={e => setSector(e.target.value)} aria-label="Secteur">
              <option value="">Tous les secteurs</option><option value="general">Frais généraux</option>
              {activities.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>
          <FlowFilterBar state={filter} totals={totals} size="sm" />
        </div>
        {entries.length === 0 ? <p className="px-5 py-6 text-sm text-ink3 text-center">Aucune écriture pour ce filtre.</p> : (
          <ul className="divide-y divide-line">
            {entries.map(e => (
              <li key={e._id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className={`font-semibold ${e.kind === "revenue" ? "text-pos" : "text-neg"}`}>{e.kind === "revenue" ? "+" : "−"} {formatMoney(e.amount)}</span>
                  <span className="text-ink"> · {e.label}</span>
                  <span className="text-ink3"> · {e.activityId?.name || "Frais généraux"} · {new Date(e.date).toLocaleDateString("fr-FR")}</span>
                </span>
                <button onClick={() => delEntry(e._id)} className="text-ink3 hover:text-neg"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
