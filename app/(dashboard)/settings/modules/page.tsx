"use client";

import { useEffect, useState } from "react";
import { Store, CreditCard, Repeat, Calendar } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/Toast";
import { api, apiErrorMessage } from "@/lib/api-client";
import { OPTIONAL_MODULES, type ModuleKey } from "@/lib/modules";
import { invalidateMe, useMe, meCanDo } from "@/lib/useMe";

const ICONS: Record<ModuleKey, React.ReactNode> = {
  comptoir: <Store size={18} />, isic: <CreditCard size={18} />, licences: <Repeat size={18} />, evenements: <Calendar size={18} />,
};

export default function ModulesPage() {
  const me = useMe();
  const canEdit = meCanDo(me, "companies", "update");
  const [disabled, setDisabled] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ disabledModules: string[] }>("/api/companies/modules")
      .then(d => setDisabled(new Set(d.disabledModules)))
      .catch(e => { showToast(apiErrorMessage(e, "Lecture des modules impossible."), "error"); setDisabled(new Set()); });
  }, []);

  const toggle = (key: string) => setDisabled(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  async function save() {
    if (!disabled) return;
    setSaving(true);
    try {
      await api.patch("/api/companies/modules", { disabledModules: [...disabled] });
      invalidateMe();
      showToast("Modules enregistrés. Le menu est mis à jour.", "success");
      // Le menu lit l'organisation au chargement : on le recharge.
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      showToast(apiErrorMessage(e, "Enregistrement impossible."), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Modules"
        subtitle="Activez les métiers que votre organisation exerce. Un module désactivé disparaît du menu et de la recherche ; ses données sont conservées."
        back={{ href: "/settings", label: "Réglages" }}
        actions={canEdit && <Button onClick={save} loading={saving} disabled={!disabled}>Enregistrer</Button>}
      />

      {!disabled ? (
        <div className="h-48 surface-card animate-pulse" />
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {OPTIONAL_MODULES.map(m => {
            const on = !disabled.has(m.key);
            return (
              <li key={m.key}>
                <label className={`surface-card p-4 flex gap-3 h-full ${canEdit ? "cursor-pointer hover:border-section/40" : ""} ${on ? "" : "opacity-70"}`}>
                  <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${on ? "bg-section-soft text-section" : "bg-surface2 text-ink3"}`}>{ICONS[m.key]}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink text-sm">{m.label}</span>
                      <input type="checkbox" role="switch" checked={on} disabled={!canEdit} onChange={() => toggle(m.key)}
                        aria-label={`${on ? "Désactiver" : "Activer"} le module ${m.label}`} className="h-4 w-4 accent-[rgb(var(--s-accent))]" />
                    </span>
                    <span className="block text-xs text-ink2 mt-1 leading-relaxed">{m.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!canEdit && <p className="text-xs text-ink3">Seul un administrateur de l&apos;organisation peut modifier les modules.</p>}
    </div>
  );
}
