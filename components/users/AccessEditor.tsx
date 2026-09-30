"use client";

import { useEffect, useState } from "react";
import { ROLE_UI, LEVEL_UI, roleLabel } from "@/lib/roles-ui";
import { SERVICE_ROLES } from "@/lib/role-resources";
import { selectCls, inputCls } from "@/components/ui/FormField";
import type { UserRole } from "@/types";

export type Level = "chef" | "employe" | "stagiaire";
export interface Access {
  roles: string[];
  roleLevels: Record<string, Level>;
  siteIds: string[];
  accessUntil: string; // AAAA-MM-JJ ou ""
}

export const emptyAccess = (): Access => ({ roles: [], roleLevels: {}, siteIds: [], accessUntil: "" });

const isService = (r: string) => (SERVICE_ROLES as readonly string[]).includes(r);

/** Accès d'un compte → corps envoyé à l'API. */
export function accessPayload(a: Access) {
  const roleLevels: Record<string, Level> = {};
  for (const r of a.roles) if (isService(r)) roleLevels[r] = a.roleLevels[r] ?? "employe";
  const needsSites = a.roles.includes("svc_spot") && roleLevels.svc_spot !== "chef";
  return {
    roles: a.roles,
    roleLevels,
    siteIds: needsSites ? a.siteIds : [],
    accessUntil: a.accessUntil || null,
  };
}

/** Libellé court d'un rôle attribué : « Service Communication · Chef de service ». */
export function accessChip(role: string, level?: string): string {
  const label = ROLE_UI[role as UserRole]?.label ?? roleLabel(role);
  if (!isService(role)) return label;
  return `${label.replace(/^Service /, "")} · ${LEVEL_UI[(level as Level) ?? "employe"]?.label ?? "Employé"}`;
}

/**
 * Éditeur d'accès : services cochés, niveau par service, sites The Spot et fin
 * de stage. Les anciens rôles encore portés par le compte s'affichent à part,
 * pour être retirés — ils ne peuvent plus être attribués.
 */
export function AccessEditor({ value, onChange, assignable }: {
  value: Access;
  onChange: (next: Access) => void;
  assignable: string[];
}) {
  const [sites, setSites] = useState<Array<{ _id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/comptoir/desks", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.data && setSites(d.data))
      .catch(() => {});
  }, []);

  const legacy = value.roles.filter(r => !assignable.includes(r));
  const set = (patch: Partial<Access>) => onChange({ ...value, ...patch });
  const toggle = (r: string, on: boolean) => set({ roles: on ? [...value.roles, r] : value.roles.filter(x => x !== r) });
  const levelOf = (r: string): Level => value.roleLevels[r] ?? "employe";
  const hasIntern = value.roles.some(r => isService(r) && levelOf(r) === "stagiaire");
  const spotNeedsSites = value.roles.includes("svc_spot") && levelOf("svc_spot") !== "chef";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line2 divide-y divide-line">
        {assignable.map(r => {
          const on = value.roles.includes(r);
          const d = ROLE_UI[r as UserRole];
          return (
            <div key={r} className={`p-2.5 flex flex-wrap items-start gap-x-3 gap-y-2 ${on ? "bg-section-soft/40" : ""}`}>
              <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-[14rem]">
                <input id={`role-${r}`} type="checkbox" checked={on} className="accent-section mt-1" onChange={e => toggle(r, e.target.checked)} />
                <span>
                  <span className="block text-sm font-semibold text-ink">{d?.label ?? r}</span>
                  {d && <span className="block text-[11px] text-ink3">{d.summary}{d.cannot ? ` ${d.cannot}` : ""}</span>}
                </span>
              </label>
              {on && isService(r) && (
                <select id={`level-${r}`} className={`${selectCls} w-auto h-9 text-sm`} value={levelOf(r)} aria-label={`Niveau — ${d?.label ?? r}`}
                  onChange={e => set({ roleLevels: { ...value.roleLevels, [r]: e.target.value as Level } })}>
                  {(["chef", "employe", "stagiaire"] as Level[]).map(l => <option key={l} value={l}>{LEVEL_UI[l].label}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {value.roles.some(r => isService(r)) && (
        <p className="text-[11px] text-ink3">
          {LEVEL_UI.chef.label} : {LEVEL_UI.chef.summary} {LEVEL_UI.employe.label} : {LEVEL_UI.employe.summary}
        </p>
      )}

      {spotNeedsSites && (
        <div className="rounded-lg border border-line2 p-3 space-y-2">
          <p className="text-sm font-semibold text-ink">Sites The Spot attribués</p>
          {sites.length === 0 ? (
            <p className="text-xs text-warn">Aucun comptoir n&apos;existe encore : créez les sites dans « Comptoir (The Spot) ».</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {sites.map(s => (
                <label key={s._id} className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
                  <input id={`site-${s._id}`} type="checkbox" className="accent-section" checked={value.siteIds.includes(s._id)}
                    onChange={e => set({ siteIds: e.target.checked ? [...value.siteIds, s._id] : value.siteIds.filter(x => x !== s._id) })} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {hasIntern && (
        <label className="block rounded-lg border border-warn/30 bg-warn-50 p-3 space-y-1.5">
          <span className="block text-sm font-semibold text-ink">Fin de stage</span>
          <span className="block text-[11px] text-ink2">L&apos;accès se ferme automatiquement à cette date.</span>
          <input id="access-until" type="date" className={`${inputCls} max-w-[12rem]`} value={value.accessUntil}
            onChange={e => set({ accessUntil: e.target.value })} />
        </label>
      )}

      {legacy.length > 0 && (
        <div className="rounded-lg border border-line2 p-3 space-y-2">
          <p className="text-sm font-semibold text-ink">Anciens rôles encore portés</p>
          <p className="text-[11px] text-ink3">Ils ne sont plus proposés : retirez-les une fois le service attribué. Certains donnent accès aux finances.</p>
          {legacy.map(r => (
            <label key={r} className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
              <input type="checkbox" className="accent-section" checked onChange={() => toggle(r, false)} />
              {ROLE_UI[r as UserRole]?.label ?? roleLabel(r)} <span className="pill pill-warn">ancien rôle</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
