"use client";
import { useEffect, useState } from "react";
import { selectCls } from "@/components/ui/FormField";

import { apiJson } from "@/lib/api-client";
export interface ImputationValue { projectId?: string; activityId?: string; costCenter?: string }
interface Options {
  projects: Array<{ _id: string; code: string; name: string }>;
  activities: Array<{ _id: string; name: string }>;
  costCenters: Array<{ value: string; label: string }>;
}

let cache: Promise<Options> | null = null;
function loadOptions(): Promise<Options> {
  if (!cache) {
    cache = apiJson("/api/imputation/options").then(d => d.data ?? { projects: [], activities: [], costCenters: [] })
      .catch(() => { cache = null; return { projects: [], activities: [], costCenters: [] }; });
  }
  return cache;
}

/**
 * Imputation analytique : projet, secteur d'activité, service. Les trois sont
 * facultatifs. `compact` : sur une seule ligne (lignes de tableau).
 */
export function ImputationFields({ value, onChange, compact = false, hideCostCenter = false, disabled = false }: {
  value: ImputationValue; onChange: (v: ImputationValue) => void; compact?: boolean; hideCostCenter?: boolean; disabled?: boolean;
}) {
  const [opts, setOpts] = useState<Options>({ projects: [], activities: [], costCenters: [] });
  useEffect(() => { loadOptions().then(setOpts); }, []);
  const set = (patch: ImputationValue) => onChange({ ...value, ...patch });
  const cls = `${selectCls} ${compact ? "h-8 text-xs" : ""}`;
  return (
    <fieldset disabled={disabled} className={compact ? `grid ${hideCostCenter ? "grid-cols-2" : "grid-cols-3"} gap-2 min-w-[16rem]` : "grid sm:grid-cols-3 gap-3"}>
      <label className="block">
        {!compact && <span className="block text-xs font-medium text-ink2 mb-1">Projet</span>}
        <select className={cls} value={value.projectId ?? ""} onChange={e => set({ projectId: e.target.value || undefined })} aria-label="Projet">
          <option value="">{compact ? "Projet —" : "Aucun projet"}</option>
          {opts.projects.map(p => <option key={p._id} value={p._id}>{p.code} — {p.name}</option>)}
        </select>
      </label>
      <label className="block">
        {!compact && <span className="block text-xs font-medium text-ink2 mb-1">Secteur d&apos;activité</span>}
        <select className={cls} value={value.activityId ?? ""} onChange={e => set({ activityId: e.target.value || undefined })} aria-label="Secteur d'activité">
          <option value="">{compact ? "Secteur —" : "Frais généraux"}</option>
          {opts.activities.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
      </label>
      {!hideCostCenter && (
        <label className="block">
          {!compact && <span className="block text-xs font-medium text-ink2 mb-1">Service</span>}
          <select className={cls} value={value.costCenter ?? ""} onChange={e => set({ costCenter: e.target.value || undefined })} aria-label="Service">
            <option value="">{compact ? "Service —" : "Non précisé"}</option>
            {opts.costCenters.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      )}
    </fieldset>
  );
}
