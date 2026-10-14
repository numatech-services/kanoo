"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { CheckCircle2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
function ActivateForm() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") || "";
  const [token, setToken] = useState(tokenFromUrl);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{success: boolean; message: string} | null>(null);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      const res = await fetch("/api/public/activation/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const d = await res.json();
      setResult({ success: res.ok, message: res.ok ? d.data?.message : d.error });
    } catch { setResult({ success: false, message: "Erreur réseau" }); } finally { setLoading(false); }
  }

  if (result?.success) return (
    <div className="text-center py-4 space-y-4">
      <span className="text-ink3 inline-flex" aria-hidden><CheckCircle2 size={44} /></span>
      <h2 className="text-xl font-bold text-ink">Compte activé !</h2>
      <p className="text-ink2 text-sm">{result.message}</p>
      <Link href="/login" className={buttonClass("primary", "md")}>Accéder à mon espace</Link>
    </div>
  );

  return (
    <form onSubmit={handleActivate} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Token d'activation *</label>
        <input className="w-full px-4 py-2.5 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30 font-mono" value={token} onChange={e=>setToken(e.target.value)} placeholder="Collez votre token ici…" required />
        <p className="text-xs text-ink2 mt-1">Le token vous a été envoyé par email lors de votre inscription.</p>
      </div>
      {result && !result.success && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{result.message}</div>}
      <button type="submit" disabled={loading || !token} className={buttonClass("primary", "md", "w-full")}>{loading ? "Activation…" : "Activer mon compte"}</button>
      <div className="text-center"><button type="button" onClick={async () => { const email = await promptDialog({ title: "Votre email pour renvoyer le lien :" }); if (email) { await fetch("/api/public/activation/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); showToast("Si votre email est enregistré, vous recevrez un nouveau lien.", "success"); } }} className="text-sm text-section hover:underline">Renvoyer le lien d'activation</button></div>
    </form>
  );
}

export default function ActiverComptePage() {
  return (
    <div className="min-h-screen bg-surface2 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-ink">Kanoo</Link>
          <p className="text-ink2 mt-2">Activation de votre compte</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft p-8">
          <Suspense fallback={<div className="h-32 animate-pulse bg-surface2 rounded-xl" />}>
            <ActivateForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
