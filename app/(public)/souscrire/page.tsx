"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SouscrireForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planFromUrl = searchParams.get("plan") || "starter";

  const [form, setForm] = useState({ name:"", type:"pme", email:"", adminFirstName:"", adminLastName:"", adminEmail:"", adminPassword:"", plan: planFromUrl, phone:"" });
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const inp = "w-full px-4 py-2.5 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-sm font-medium text-ink mb-1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/superadmin/tenants", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Erreur lors de la souscription"); setLoading(false); return; }
      setSuccess(true);
    } catch { setError("Erreur réseau"); } finally { setLoading(false); }
  }

  if (success) return (
    <div className="text-center py-8 space-y-4">
      <span className="text-5xl">🎉</span>
      <h2 className="text-2xl font-bold text-ink">Inscription réussie !</h2>
      <p className="text-moss">Vérifiez votre email pour activer votre compte. Votre essai gratuit de 30 jours commence dès l'activation.</p>
      <Link href="/login" className="inline-block px-6 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors">Aller à la connexion</Link>
    </div>
  );

  return (
    <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2); } : handleSubmit} className="space-y-5">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {step === 1 && (
        <>
          <h2 className="text-lg font-semibold text-ink">Votre organisation</h2>
          <div><label className={lbl}>Nom de l'organisation *</label><input className={inp} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Ex: SARL Maison des Idées" required /></div>
          <div><label className={lbl}>Profil *</label>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {[{v:"pme",l:"PME",i:"🏢"},{v:"association",l:"Association",i:"🤝"},{v:"administration",l:"Administration",i:"🏛️"}].map(opt=>(
                <button key={opt.v} type="button" onClick={()=>setForm(p=>({...p,type:opt.v}))} className={`py-3 rounded-xl border-2 text-sm font-medium transition-all ${form.type===opt.v?"border-cedar bg-cedar/5 text-cedar":"border-clay/20 text-moss hover:border-cedar/30"}`}>{opt.i}<br/>{opt.l}</button>
              ))}
            </div>
          </div>
          <div><label className={lbl}>Email de l'organisation *</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required /></div>
          <div><label className={lbl}>Téléphone</label><input className={inp} value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder="+227 XX XX XX XX" /></div>
          <button type="submit" className="w-full py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors">Continuer →</button>
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="text-lg font-semibold text-ink">Votre compte administrateur</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={lbl}>Prénom *</label><input className={inp} value={form.adminFirstName} onChange={e=>setForm(p=>({...p,adminFirstName:e.target.value}))} required /></div>
            <div><label className={lbl}>Nom *</label><input className={inp} value={form.adminLastName} onChange={e=>setForm(p=>({...p,adminLastName:e.target.value}))} required /></div>
          </div>
          <div><label className={lbl}>Email de connexion *</label><input type="email" className={inp} value={form.adminEmail} onChange={e=>setForm(p=>({...p,adminEmail:e.target.value}))} required /></div>
          <div><label className={lbl}>Mot de passe *</label><input type="password" className={inp} value={form.adminPassword} onChange={e=>setForm(p=>({...p,adminPassword:e.target.value}))} placeholder="Minimum 8 caractères" required minLength={8} /></div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-800">✅ 30 jours d'essai gratuit — Aucune carte bancaire requise</div>
          <div className="flex gap-3">
            <button type="button" onClick={()=>setStep(1)} className="px-4 py-3 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">← Retour</button>
            <button type="submit" disabled={loading} className="flex-1 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors disabled:opacity-60">{loading?"Création…":"Créer mon compte gratuit"}</button>
          </div>
        </>
      )}
    </form>
  );
}

export default function SouscrirePage() {
  return (
    <div className="min-h-screen bg-sand flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-ink">Kanoo</Link>
          <p className="text-moss mt-2">Commencez votre essai gratuit de 30 jours</p>
        </div>
        <div className="bg-white rounded-2xl shadow-soft p-8">
          <Suspense fallback={<div className="h-64 animate-pulse bg-sand rounded-xl" />}>
            <SouscrireForm />
          </Suspense>
        </div>
        <p className="text-center text-sm text-moss mt-4">
          Déjà un compte ? <Link href="/login" className="text-cedar hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
