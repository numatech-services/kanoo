"use client";

import { useState } from "react";
import { Mail, MapPin, CheckCircle2 } from "lucide-react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "", type: "pme" });
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/demo-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => {});
    setSaving(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="py-24 px-6 text-center">
        <CheckCircle2 size={54} className="mx-auto text-acacia" />
        <h2 className="font-display font-semibold text-2xl text-ink mt-4">Message envoyé !</h2>
        <p className="text-ink2 mt-2">Notre équipe vous répondra sous 24 h.</p>
      </div>
    );
  }

  return (
    <div className="py-16 px-5 sm:px-6">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-9">
          <h1 className="font-display font-semibold text-ink text-[clamp(2rem,5vw,2.8rem)] tracking-tight">Contactez-nous</h1>
          <p className="text-ink2 mt-3">Questions, démo personnalisée, partenariat — réponse sous 24 h.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Nom *</label><input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required /></div>
              <div><label className="label">Email *</label><input type="email" className="input" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required /></div>
            </div>
            <div>
              <label className="label">Profil</label>
              <select className="input" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
                <option value="pme">PME</option>
                <option value="association">Association / ONG</option>
                <option value="administration">Administration</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div><label className="label">Sujet *</label><input className="input" value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} required /></div>
            <div><label className="label">Message *</label><textarea className="input h-32 py-2 resize-none" value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} required /></div>
            <button type="submit" disabled={saving} className="btn-primary w-full h-11">{saving ? "Envoi…" : "Envoyer le message"}</button>
          </form>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-line bg-surface p-4 flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-accent-50 text-accent-700 grid place-items-center"><Mail size={16} /></span><span className="text-sm font-medium text-ink">contact@kanoo.ne</span></div>
          <div className="rounded-xl border border-line bg-surface p-4 flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-accent-50 text-accent-700 grid place-items-center"><MapPin size={16} /></span><span className="text-sm font-medium text-ink">Niamey, Niger</span></div>
        </div>
      </div>
    </div>
  );
}
