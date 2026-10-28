"use client";
import { useEffect, useState } from "react";
import { Users2, CalendarDays, Plus, Trash2, Save } from "lucide-react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useMe, meCanDo } from "@/lib/useMe";

interface Center { value: string; label: string; active: boolean }
interface Holiday { date: string; label: string }
interface Data {
  year: number; costCenters: Center[]; customCostCenters: boolean; leaveMaxBalanceDays: number | null;
  holidays: Holiday[]; defaultHolidays: Holiday[]; extraHolidays: Holiday[]; removedHolidays: string[];
}

const fr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/**
 * Réglages RH : services (centres de coût) propres à l'organisation, plafond
 * de report des congés, jours fériés retenus pour le décompte des congés.
 */
export default function HrSettingsPage() {
  const canEdit = meCanDo(useMe(), "companies", "update");
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, reload } = useApi<Data | null>(`/api/companies/hr-settings?year=${year}`, d => d?.data ?? null, null);
  const [centers, setCenters] = useState<Center[]>([]);
  const [cap, setCap] = useState("");
  const [extra, setExtra] = useState<Holiday[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Les champs se remplissent à chaque lecture (changement d'année, enregistrement).
  /* eslint-disable react-hooks/set-state-in-effect -- copie éditable des données lues */
  useEffect(() => {
    if (!data) return;
    setCenters(data.costCenters); setCap(data.leaveMaxBalanceDays ? String(data.leaveMaxBalanceDays) : "");
    setExtra(data.extraHolidays); setRemoved(data.removedHolidays);
  }, [data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    setBusy(true);
    const res = await apiSend("PATCH", "/api/companies/hr-settings", { costCenters: centers, leaveMaxBalanceDays: cap === "" ? null : Number(cap), extraHolidays: extra, removedHolidays: removed });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
    showToast("Réglages RH enregistrés.", "success"); reload();
  }

  if (!data) return <div className="h-48 bg-surface rounded-xl animate-pulse border border-line" />;
  const set = (i: number, patch: Partial<Center>) => setCenters(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const yearExtra = extra.filter(h => h.date.startsWith(`${year}-`));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="page-title">RH et services</h1>
        <p className="text-sm text-ink2 mt-1">Services d&apos;imputation, règles de congés et jours fériés de votre organisation.</p>
      </div>

      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><Users2 size={16} /> Services (centres de coût)</h2>
        <p className="text-xs text-ink2">Proposés sur les dépenses, notes de frais, commandes, écritures et fiches salariés ; la paie y est imputée.{!data.customCostCenters && " Liste par défaut : adaptez-la à votre organisation."} Un service retiré reste lisible sur les pièces anciennes.</p>
        <div className="space-y-2">
          {centers.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={`${inputCls} col-span-4 font-mono`} value={c.value} disabled={!canEdit} maxLength={20} onChange={e => set(i, { value: e.target.value.toLowerCase() })} aria-label="Code" />
              <input className={`${inputCls} col-span-6`} value={c.label} disabled={!canEdit} maxLength={80} onChange={e => set(i, { label: e.target.value })} aria-label="Libellé" />
              <label className="col-span-2 text-xs inline-flex items-center gap-1"><input type="checkbox" checked={c.active} disabled={!canEdit} onChange={e => set(i, { active: e.target.checked })} className="accent-section" /> actif</label>
            </div>
          ))}
          {canEdit && <button onClick={() => setCenters(cs => [...cs, { value: "", label: "", active: true }])} className={buttonClass("ghost", "sm")}><Plus size={14} /> Ajouter un service</button>}
        </div>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">Congés</h2>
        <FormField label="Plafond de report (jours)" hint="Au-delà, les jours acquis non pris sont perdus et ne s'indemnisent pas au départ. Vide : pas de plafond.">
          <input type="number" min={0} max={365} className={inputCls} value={cap} disabled={!canEdit} onChange={e => setCap(e.target.value)} />
        </FormField>
      </section>

      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><CalendarDays size={16} /> Jours fériés {year}</h2>
          <div className="flex gap-1">
            <button onClick={() => setYear(y => y - 1)} className={buttonClass("ghost", "sm")}>{year - 1}</button>
            <button onClick={() => setYear(y => y + 1)} className={buttonClass("ghost", "sm")}>{year + 1}</button>
          </div>
        </div>
        <p className="text-xs text-ink2">Exclus du décompte des congés. Les fêtes musulmanes sont à leur date prévisionnelle : décochez-en une et ajoutez la date de l&apos;arrêté si elle est décalée.</p>
        <ul className="divide-y divide-line text-sm">
          {data.defaultHolidays.map(h => (
            <li key={h.date} className="py-1.5 flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" disabled={!canEdit} checked={!removed.includes(h.date)} onChange={e => setRemoved(r => (e.target.checked ? r.filter(x => x !== h.date) : [...r, h.date]))} className="accent-section" />
                <span className="text-ink">{h.label}</span>
              </label>
              <span className="text-ink2 text-xs">{fr(h.date)}</span>
            </li>
          ))}
          {yearExtra.map(h => (
            <li key={`x-${h.date}`} className="py-1.5 flex items-center justify-between gap-2">
              <span className="text-ink">{h.label} <span className="text-[11px] text-section">ajouté</span></span>
              <span className="text-ink2 text-xs inline-flex items-center gap-2">{fr(h.date)}
                {canEdit && <button onClick={() => setExtra(x => x.filter(e => e.date !== h.date))} className="text-ink3 hover:text-neg" title="Retirer"><Trash2 size={13} /></button>}</span>
            </li>
          ))}
        </ul>
        {canEdit && <AddHoliday year={year} onAdd={h => setExtra(x => [...x.filter(e => e.date !== h.date), h])} />}
      </section>

      {canEdit && <button disabled={busy} onClick={save} className={buttonClass("primary", "md")}><Save size={15} /> Enregistrer</button>}
    </div>
  );
}

function AddHoliday({ year, onAdd }: { year: number; onAdd: (h: Holiday) => void }) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  return (
    <div className="grid grid-cols-12 gap-2 items-end">
      <div className="col-span-5"><FormField label="Date"><input type="date" className={inputCls} min={`${year}-01-01`} max={`${year}-12-31`} value={date} onChange={e => setDate(e.target.value)} /></FormField></div>
      <div className="col-span-5"><FormField label="Libellé"><input className={inputCls} value={label} maxLength={80} onChange={e => setLabel(e.target.value)} placeholder="Ex. Tabaski (date de l'arrêté)" /></FormField></div>
      <div className="col-span-2 pb-0.5"><button disabled={!date} onClick={() => { onAdd({ date, label: label || "Jour férié" }); setDate(""); setLabel(""); }} className={buttonClass("secondary", "md", "w-full")}><Plus size={14} /></button></div>
    </div>
  );
}
