"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function ConnexionFournisseurPage() {
  const [form, setForm] = useState({ email:"", accessCode:"" });
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    const res = await fetch("/api/portail/auth", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...form, type:"fournisseur"}) });
    const d = await res.json();
    if (d.success) router.push("/portail/fournisseur");
    else setError(d.error || "Identifiants incorrects");
    setLoading(false);
  }
  const inp = "w-full px-4 py-3 border border-clay/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  return (
    <div className="max-w-sm mx-auto">
      <div className="text-center mb-8"><p className="text-3xl mb-2">🏭</p><h1 className="text-2xl font-bold text-ink">Espace fournisseur</h1><p className="text-moss text-sm mt-1">Accédez aux appels d'offres et à vos contrats</p></div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-4">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-xs font-medium text-moss mb-1">Email</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/></div>
        <div><label className="block text-xs font-medium text-moss mb-1">Code d'accès</label><input type="password" className={inp} value={form.accessCode} onChange={e=>setForm(p=>({...p,accessCode:e.target.value}))} required/></div>
        <button type="submit" disabled={loading} className="w-full py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink disabled:opacity-60">{loading?"Connexion…":"Se connecter"}</button>
      </form>
    </div>
  );
}
