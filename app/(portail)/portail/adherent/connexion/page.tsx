"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { apiSend } from "@/lib/api-client";
export default function ConnexionAdherentPage() {
  const [form, setForm] = useState({ email:"", accessCode:"" });
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    const res = await apiSend("POST", "/api/portail/auth", {...form, type:"adherent"});
    const d = res.data;
    if (d.success) router.push("/portail/adherent");
    else setError(d.error || "Identifiants incorrects");
    setLoading(false);
  }
  const inp = "w-full px-4 py-3 border border-line rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  return (
    <div className="max-w-sm mx-auto">
      <div className="text-center mb-8"><p className="mb-2 text-ink3 flex justify-center" aria-hidden><Handshake size={30} /></p><h1 className="text-2xl font-bold text-ink">Espace adhérent</h1><p className="text-ink2 text-sm mt-1">Connectez-vous avec votre email et code d'accès</p></div>
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-xl text-neg text-sm mb-4">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="block text-xs font-medium text-ink2 mb-1">Email</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required/></div>
        <div><label className="block text-xs font-medium text-ink2 mb-1">Code d'accès</label><input type="password" className={inp} value={form.accessCode} onChange={e=>setForm(p=>({...p,accessCode:e.target.value}))} required/></div>
        <button type="submit" disabled={loading} className={buttonClass("primary", "md", "w-full")}>{loading?"Connexion…":"Se connecter"}</button>
      </form>
      <p className="text-center text-xs text-ink2 mt-4">Code d'accès fourni par votre association</p>
    </div>
  );
}
