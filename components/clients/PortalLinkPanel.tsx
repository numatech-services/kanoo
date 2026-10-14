"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, RefreshCw, Ban, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useMe, meCanDo } from "@/lib/useMe";

/**
 * Portail client : un lien personnel, sans mot de passe, où le client consulte
 * ses factures et devis, télécharge les PDF, accepte un devis et paie en ligne.
 */
export function PortalLinkPanel({ clientId, clientName, phone }: { clientId: string; clientName: string; phone?: string }) {
  const canEdit = meCanDo(useMe(), "clients", "update");
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ url: string | null }>(`/api/clients/${clientId}/portal-link`).then(d => setUrl(d.url)).catch(() => setUrl(null));
  }, [clientId]);

  async function create(regenerate = false) {
    if (regenerate && !(await confirmDialog({ title: "Générer un nouveau lien ?", message: "L'ancien lien cessera aussitôt de fonctionner.", confirmLabel: "Générer" }))) return;
    setBusy(true);
    try { setUrl((await api.post<{ url: string }>(`/api/clients/${clientId}/portal-link`)).url); showToast("Lien du portail prêt.", "success"); }
    catch (e) { showToast(apiErrorMessage(e, "Création du lien impossible."), "error"); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!(await confirmDialog({ title: "Révoquer le lien du portail ?", message: "Le client ne pourra plus consulter ses documents avec ce lien.", danger: true, confirmLabel: "Révoquer" }))) return;
    try { await api.del(`/api/clients/${clientId}/portal-link`); setUrl(null); showToast("Lien révoqué.", "success"); }
    catch (e) { showToast(apiErrorMessage(e, "Révocation impossible."), "error"); }
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); showToast("Lien copié.", "success"); }
    catch { showToast("Copie impossible : sélectionnez le lien à la main.", "warning"); }
  }

  if (url === undefined) return null;
  const message = url ? `Bonjour, voici votre espace client ${clientName} : factures, devis et paiement en ligne. ${url}` : "";
  const wa = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <section className="surface-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2"><Link2 size={16} className="text-section" /> Portail client</h2>
          <p className="text-xs text-ink2 mt-0.5">Factures, devis, PDF, acceptation des devis et paiement en ligne, sans compte ni mot de passe.</p>
        </div>
      </div>
      {url ? (
        <>
          <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="Lien du portail" className="input font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Copy size={13} />} onClick={copy}>Copier</Button>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-[#25D366] text-white hover:brightness-95">
              <MessageCircle size={13} /> Envoyer par WhatsApp
            </a>
            {canEdit && <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => create(true)} loading={busy}>Nouveau lien</Button>}
            {canEdit && <Button size="sm" variant="ghost" icon={<Ban size={13} />} onClick={revoke}>Révoquer</Button>}
          </div>
        </>
      ) : canEdit ? (
        <Button size="sm" onClick={() => create()} loading={busy}>Créer le lien du portail</Button>
      ) : <p className="text-sm text-ink3">Aucun lien actif.</p>}
    </section>
  );
}
