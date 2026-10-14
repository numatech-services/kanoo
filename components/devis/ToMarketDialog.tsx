"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

/**
 * Devis accepté → marché : contrat au montant HT du devis, projet d'exécution
 * (qui recevra les dépenses), échéancier facultatif (acompte puis solde).
 */
export function ToMarketDialog({ devis, onClose }: { devis: { _id: string; number: string; totalHT: number }; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(`Marché — devis ${devis.number}`);
  const [project, setProject] = useState(true);
  const [deposit, setDeposit] = useState("30");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rate = Number(deposit || 0);
  async function submit() {
    setSaving(true); setError("");
    const milestones = rate > 0 && rate < 100
      ? [{ label: "Acompte à la commande", kind: "deposit", rate }, { label: "Solde à la livraison", kind: "standard", rate: 100 - rate }]
      : [{ label: "Facture du marché", kind: "standard", rate: 100 }];
    const res = await fetch(`/api/devis/${devis._id}/to-market`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ title, createProject: project, milestones }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error || "Création du marché refusée"); return; }
    router.push(`/contracts/${d.data.contractId}`);
  }
  return (
    <Modal open onClose={onClose} title={`Créer le marché — devis ${devis.number}`} size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <p className="text-sm text-ink2">Le devis passe en « accepté » et devient un marché de <b>{Math.round(devis.totalHT).toLocaleString("fr-FR")} FCFA HT</b>. Vous suivrez ensuite séparément le devis, le facturé, les acomptes, les dépenses et la marge.</p>
        <FormField label="Intitulé du marché" required><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} /></FormField>
        <FormField label="Acompte à la commande (%)" hint="0 : pas d'acompte. Le solde est prévu à la livraison ; l'échéancier reste modifiable.">
          <input type="number" min={0} max={99} className={inputCls} value={deposit} onChange={e => setDeposit(e.target.value)} />
        </FormField>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-section mt-1" checked={project} onChange={e => setProject(e.target.checked)} />
          <span>Créer le projet d&apos;exécution<span className="block text-xs text-ink3">Achats, commandes, notes de frais et charges s&apos;y imputent : ce sont les dépenses du marché.</span></span></label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !title.trim()} className={buttonClass("primary", "md")}>{saving ? "Création…" : "Créer le marché"}</button>
        </div>
      </div>
    </Modal>
  );
}
