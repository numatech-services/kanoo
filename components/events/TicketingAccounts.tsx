"use client";

import { useState } from "react";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/Toast";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
import { api, apiErrorMessage } from "@/lib/api-client";

/**
 * Comptes de la billetterie : sans eux, les billets vendus restent hors
 * comptabilité et hors trésorerie.
 */
export function TicketingAccounts({ eventId, initial, onSaved }: {
  eventId: string;
  initial: { treasuryAccountId?: string; onlineTreasuryAccountId?: string };
  onSaved?: () => void;
}) {
  const [onsite, setOnsite] = useState(initial.treasuryAccountId ?? "");
  const [online, setOnline] = useState(initial.onlineTreasuryAccountId ?? "");
  const [saving, setSaving] = useState(false);
  const linked = Boolean(initial.treasuryAccountId || initial.onlineTreasuryAccountId);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/events/${eventId}`, { treasuryAccountId: onsite || null, onlineTreasuryAccountId: online || null });
      showToast("Comptes de la billetterie enregistrés.", "success");
      onSaved?.();
    } catch (e) { showToast(apiErrorMessage(e, "Enregistrement impossible."), "error"); }
    finally { setSaving(false); }
  }

  return (
    <section className={`surface-card p-4 space-y-3 ${linked ? "" : "border-warn/40"}`}>
      <div>
        <h2 className="font-semibold text-ink text-sm">Billetterie et comptabilité</h2>
        <p className="text-xs text-ink2 mt-0.5">
          {linked ? "Les billets réglés sont enregistrés en recette (706500) sur ces comptes ; un remboursement est extourné."
            : "Billets réglés hors comptabilité : choisissez où l'argent arrive."}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <FormField label="Caisse des ventes sur place"><TreasuryAccountSelect value={onsite} onChange={setOnsite} /></FormField>
        <FormField label="Compte des paiements en ligne" hint="À défaut, la caisse sur place."><TreasuryAccountSelect value={online} onChange={setOnline} autoSelect={false} /></FormField>
      </div>
      <div className="flex justify-end"><Button size="sm" onClick={save} loading={saving}>Enregistrer</Button></div>
    </section>
  );
}
