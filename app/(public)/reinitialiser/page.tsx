"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, KeyRound } from "lucide-react";

import { apiSend } from "@/lib/api-client";
/**
 * Pose du nouveau mot de passe, depuis le lien reçu par courriel.
 *
 * Le champ est en clair : sur un formulaire de *création* de mot de passe, le
 * masquage protège d'un regard par-dessus l'épaule mais provoque les fautes de
 * frappe — et personne ne regarde par-dessus l'épaule de quelqu'un qui vient
 * précisément de perdre son mot de passe chez lui.
 */
function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiSend("POST", "/api/auth/reset-password", { token, password });
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Réinitialisation impossible");
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réinitialisation impossible");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-[22px] font-bold tracking-tight">Lien incomplet</h1>
        <p className="text-ink2 text-sm">
          Ce lien ne porte pas de jeton. Ouvrez le lien complet reçu par e-mail, ou{" "}
          <Link href="/mot-de-passe-oublie" className="text-accent-600 hover:underline">
            demandez-en un nouveau
          </Link>.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center space-y-3">
        <span className="mx-auto w-12 h-12 rounded-full bg-pos-50 text-pos grid place-items-center">
          <KeyRound size={22} />
        </span>
        <h1 className="text-[22px] font-bold tracking-tight">C&apos;est fait</h1>
        <p className="text-ink2 text-sm">
          Mot de passe modifié, sessions précédentes fermées. Redirection vers la
          connexion…
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-[22px] font-bold tracking-tight">Nouveau mot de passe</h1>
      <p className="text-ink2 text-sm mt-1 mb-6">
        Douze caractères au minimum. Une phrase courte fait un bon mot de passe —
        «&nbsp;le thé de 16h à Dosso&nbsp;» se retient et se tape vite.
      </p>
      {error && (
        <p role="alert" className="bg-neg-50 border border-neg/25 text-neg text-xs px-3 py-2.5 rounded-sm mb-4">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="password" className="label">Nouveau mot de passe</label>
        <input id="password" type="text" required autoFocus autoComplete="new-password"
          className="input" value={password} onChange={e => setPassword(e.target.value)}
          disabled={loading} minLength={12} />
        <button type="submit" disabled={loading} className="btn-primary w-full h-11 mt-4">
          {loading
            ? (<><Loader2 size={15} className="animate-spin" /> Enregistrement…</>)
            : "Enregistrer et fermer les autres sessions"}
        </button>
      </form>
    </>
  );
}

export default function ReinitialiserPage() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface p-6">
      <div className="w-full max-w-[376px]">
        {/* useSearchParams exige une frontière Suspense au rendu statique. */}
        <Suspense fallback={<div className="h-40" />}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
