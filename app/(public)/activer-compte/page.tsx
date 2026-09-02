"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

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
      <span className="text-5xl">✅</span>
      <h2 className="text-xl font-bold text-ink">Compte activé !</h2>
      <p className="text-moss text-sm">{result.message}</p>
      <Link href="/login" className="inline-block px-6 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors">Accéder à mon espace</Link>
    </div>
  );

  return (
    <form onSubmit={handleActivate} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Token d'activation *</label>
        <input className="w-full px-4 py-2.5 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30 font-mono" value={token} onChange={e=>setToken(e.target.value)} placeholder="Collez votre token ici…" required />
        <p className="text-xs text-moss mt-1">Le token vous a été envoyé par email lors de votre inscription.</p>
      </div>
      {result && !result.success && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{result.message}</div>}
      <button type="submit" disabled={loading || !token} className="w-full py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors disabled:opacity-60">{loading ? "Activation…" : "Activer mon compte"}</button>
      <div className="text-center"><button type="button" onClick={async () => { const email = prompt("Votre email pour renvoyer le lien :"); if (email) { await fetch("/api/public/activation/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); alert("Si votre email est enregistré, vous recevrez un nouveau lien."); } }} className="text-sm text-cedar hover:underline">Renvoyer le lien d'activation</button></div>
    </form>
  );
}

export default function ActiverComptePage() {
  return (
    <div className="min-h-screen bg-sand flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-ink">Kanoo</Link>
          <p className="text-moss mt-2">Activation de votre compte</p>
        </div>
        <div className="bg-white rounded-2xl shadow-soft p-8">
          <Suspense fallback={<div className="h-32 animate-pulse bg-sand rounded-xl" />}>
            <ActivateForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
