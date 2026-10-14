"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Factory } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
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
  const inp = "w-full px-4 py-3 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  return (
    <div className="max-w-sm mx-auto">
      <div className="text-center mb-8"><p className="mb-2 text-ink3 flex justify-center" aria-hidden><Factory size={30} /></p><h1 className="text-2xl font-bold text-ink">Espace fournisseur</h1><p className="text-ink2 text-sm mt-1">Accédez aux appels d'offres et à vos contrats</p></div>
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-xl text-neg text-sm mb-4">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-xs font-medium text-ink2 mb-1">Email</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/></div>
        <div><label className="block text-xs font-medium text-ink2 mb-1">Code d'accès</label><input type="password" className={inp} value={form.accessCode} onChange={e=>setForm(p=>({...p,accessCode:e.target.value}))} required/></div>
        <button type="submit" disabled={loading} className={buttonClass("primary", "md", "w-full")}>{loading?"Connexion…":"Se connecter"}</button>
      </form>
    </div>
  );
}
