"use client";

import { useEffect, useState } from "react";
import { Download, Mail, MessageCircle, Smartphone, Trash2, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

interface Consents { email: boolean; whatsapp: boolean; sms: boolean; }

const CHANNELS: { key: keyof Consents; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: "email", label: "Email", desc: "Confirmations, reçus, informations produit", icon: <Mail size={16} /> },
  { key: "whatsapp", label: "WhatsApp", desc: "Billets, rappels d'événement, notifications", icon: <MessageCircle size={16} /> },
  { key: "sms", label: "SMS", desc: "Codes et rappels urgents", icon: <Smartphone size={16} /> },
];

export default function ConfidentialitePage() {
  const [consents, setConsents] = useState<Consents>({ email: false, whatsapp: false, sms: false });
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch("/api/me/consents", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.consents) setConsents({ email: !!d.data.consents.email, whatsapp: !!d.data.consents.whatsapp, sms: !!d.data.consents.sms });
        setRequested(d.data?.deletionRequestedAt || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: keyof Consents, value: boolean) {
    const next = { ...consents, [key]: value };
    setConsents(next);
    try {
      const res = await fetch("/api/me/consents", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
      toast.success("Préférence enregistrée");
    } catch {
      setConsents((c) => ({ ...c, [key]: !value })); // rollback
      toast.error("Échec de l'enregistrement");
    }
  }

  async function requestDeletion() {
    try {
      const res = await fetch("/api/me/deletion-request", { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setRequested(d.data.requestedAt);
      setConfirmDelete(false);
      toast.success("Demande de suppression enregistrée");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="page-title">Confidentialité &amp; données</h1>
        <p className="text-sm text-ink2 mt-0.5">Gérez vos consentements et exercez vos droits (RGPD).</p>
      </div>

      {/* Consentements */}
      <div className="card card-p">
        <h2 className="section-title">Préférences de communication</h2>
        <p className="text-sm text-ink2 mt-1 mb-4">Vous choisissez par quels canaux nous pouvons vous contacter. Modifiable à tout moment ; chaque choix est horodaté.</p>
        <div className="divide-y divide-line">
          {CHANNELS.map((c) => (
            <div key={c.key} className="flex items-center gap-3 py-3">
              <span className="w-9 h-9 rounded-lg bg-accent-50 text-accent-700 grid place-items-center flex-none">{c.icon}</span>
              <div className="flex-1"><p className="text-sm font-semibold text-ink">{c.label}</p><p className="text-xs text-ink2">{c.desc}</p></div>
              <button
                role="switch" aria-checked={consents[c.key]} disabled={loading}
                onClick={() => toggle(c.key, !consents[c.key])}
                className={`relative w-11 h-6 rounded-full transition-colors flex-none ${consents[c.key] ? "bg-accent" : "bg-line2"}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${consents[c.key] ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Export */}
      <div className="card card-p flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-surface2 text-ink2 grid place-items-center flex-none"><Download size={18} /></span>
        <div className="flex-1">
          <h2 className="section-title">Exporter mes données</h2>
          <p className="text-sm text-ink2 mt-1">Téléchargez une copie de vos données personnelles au format JSON.</p>
          <a href="/api/me/export" className="btn-secondary mt-3"><Download size={15} /> Télécharger (JSON)</a>
        </div>
      </div>

      {/* Droit à l'oubli */}
      <div className="card card-p flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-neg-50 text-neg grid place-items-center flex-none"><Trash2 size={18} /></span>
        <div className="flex-1">
          <h2 className="section-title">Supprimer mon compte</h2>
          {requested ? (
            <p className="text-sm text-ink2 mt-1 flex items-center gap-1.5"><ShieldCheck size={15} className="text-acacia" /> Demande enregistrée le {new Date(requested).toLocaleDateString("fr-FR")}. Notre équipe la traitera après vérification.</p>
          ) : !confirmDelete ? (
            <>
              <p className="text-sm text-ink2 mt-1">La suppression est définitive. Votre demande sera vérifiée par un administrateur avant traitement.</p>
              <button onClick={() => setConfirmDelete(true)} className="btn-danger mt-3">Demander la suppression</button>
            </>
          ) : (
            <div className="mt-1">
              <p className="text-sm text-ink">Confirmez-vous la demande de suppression de votre compte&nbsp;?</p>
              <div className="flex gap-2 mt-3">
                <button onClick={requestDeletion} className="btn-danger">Oui, demander la suppression</button>
                <button onClick={() => setConfirmDelete(false)} className="btn-secondary">Annuler</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
