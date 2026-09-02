"use client";

import { useState } from "react";
import { Target, Clock, Plus, CheckCircle2, ArrowRight } from "lucide-react";

export default function DemoPage() {
  const [form, setForm] = useState({ name: "", email: "", organization: "", type: "pme", message: "" });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/demo-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, subject: "Demande d'accès démo Kanoo" }),
    }).catch(() => {});
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="py-24 px-6 text-center">
        <CheckCircle2 size={54} className="mx-auto text-acacia" />
        <h2 className="font-display font-semibold text-2xl text-ink mt-5">Demande envoyée</h2>
        <p className="text-ink2 mt-3 max-w-sm mx-auto">Notre équipe vous contacte sous 24 h pour planifier votre démonstration personnalisée.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-6 py-16">
      <div className="text-center mb-10">
        <span className="text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">Démo</span>
        <h1 className="font-display font-semibold text-ink text-[clamp(2rem,5vw,2.8rem)] tracking-tight mt-5">Voir Kanoo en action.</h1>
        <p className="text-ink2 mt-3 text-lg max-w-xl mx-auto">Une démonstration guidée, adaptée à votre secteur et à vos besoins.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        {[
          { icon: <Target size={20} />, title: "Personnalisée", desc: "Selon votre profil : PME, association ou administration" },
          { icon: <Clock size={20} />, title: "30 minutes", desc: "Ciblée sur vos cas d'usage prioritaires" },
          { flag: true, title: "En français", desc: "Par une équipe qui connaît le contexte nigérien" },
        ].map((c) => (
          <div key={c.title} className="bg-surface rounded-2xl border border-line p-5 text-center">
            <span className="w-10 h-10 rounded-lg bg-accent-50 text-accent-700 grid place-items-center mx-auto text-lg">{c.flag ? "🇳🇪" : c.icon}</span>
            <p className="font-semibold text-ink mt-3 text-sm">{c.title}</p>
            <p className="text-ink2 text-xs mt-1">{c.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface rounded-2xl border border-line p-7 shadow-sm">
        <h2 className="section-title mb-5">Demander une session de démonstration</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Prénom &amp; Nom *</label><input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Moussa Diallo" required /></div>
            <div><label className="label">Email professionnel *</label><input type="email" className="input" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required /></div>
          </div>
          <div><label className="label">Organisation *</label><input className="input" value={form.organization} onChange={(e) => setForm((p) => ({ ...p, organization: e.target.value }))} placeholder="Nom de votre entreprise / association" required /></div>
          <div>
            <label className="label">Profil *</label>
            <div className="grid grid-cols-3 gap-2">
              {[["pme", "PME"], ["association", "Association"], ["administration", "Administration"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm((p) => ({ ...p, type: v }))}
                  className={`h-11 rounded-md border text-sm font-medium transition-colors ${form.type === v ? "border-accent bg-accent-50 text-accent-700" : "border-line2 text-ink2 hover:bg-surface2"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div><label className="label">Vos besoins principaux</label><textarea className="input h-24 py-2 resize-none" value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} placeholder="Ex : facturation, paie, marchés publics, adhérents, billetterie…" /></div>
          <button type="submit" disabled={loading} className="btn-primary w-full h-11">{loading ? "Envoi en cours…" : (<>Demander ma démonstration <ArrowRight size={16} /></>)}</button>
        </form>
        <p className="text-center text-xs text-ink2 mt-4">Réponse sous 24 h · aucun engagement</p>
      </div>

      <div className="mt-8 space-y-2.5">
        {[
          ["La démo est-elle gratuite ?", "Oui, totalement gratuite et sans engagement."],
          ["Puis-je essayer par moi-même ensuite ?", "Oui, un essai de 30 jours vous est proposé immédiatement après la démo."],
          ["La démo couvre-t-elle mon secteur ?", "Nous préparons une démo spécifique selon votre profil (PME, association ou administration)."],
        ].map(([q, a]) => (
          <details key={q} className="bg-surface rounded-xl border border-line overflow-hidden group">
            <summary className="px-5 py-4 cursor-pointer text-sm font-semibold text-ink list-none flex justify-between items-center">
              {q}<Plus size={16} className="text-ink3 group-open:rotate-45 transition-transform" />
            </summary>
            <p className="px-5 pb-4 text-sm text-ink2">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
