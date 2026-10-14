"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";

import { apiSend } from "@/lib/api-client";
/**
 * Demande de réinitialisation.
 *
 * La page de connexion pointait ici depuis l'origine — vers un 404. Le message
 * de confirmation est le même que l'adresse existe ou non : la différence
 * serait un annuaire des comptes offert à qui énumère.
 */
export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiSend("POST", "/api/auth/forgot-password", { email });
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Demande impossible");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demande impossible");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-surface p-6">
      <div className="w-full max-w-[376px]">
        {sent ? (
          <div className="text-center space-y-4">
            <span className="mx-auto w-12 h-12 rounded-full bg-pos-50 text-pos grid place-items-center">
              <MailCheck size={22} />
            </span>
            <h1 className="text-[22px] font-bold tracking-tight">Vérifiez votre boîte</h1>
            <p className="text-ink2 text-sm">
              Si cette adresse correspond à un compte, un lien de réinitialisation vient de
              partir. Il est valable <strong>une heure</strong>. Pensez aux indésirables.
            </p>
            <Link href="/login" className="text-sm text-accent-600 hover:underline">
              ← Revenir à la connexion
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[22px] font-bold tracking-tight">Mot de passe oublié</h1>
            <p className="text-ink2 text-sm mt-1 mb-6">
              Saisissez l&apos;adresse de votre compte : nous vous enverrons un lien pour en
              choisir un nouveau.
            </p>
            {error && (
              <p role="alert" className="bg-neg-50 border border-neg/25 text-neg text-xs px-3 py-2.5 rounded-sm mb-4">
                {error}
              </p>
            )}
            <form onSubmit={submit}>
              <label htmlFor="email" className="label">Adresse e-mail</label>
              <input id="email" type="email" required autoFocus className="input"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="vous@entreprise.ne" disabled={loading} />
              <button type="submit" disabled={loading} className="btn-primary w-full h-11 mt-4">
                {loading
                  ? (<><Loader2 size={15} className="animate-spin" /> Envoi…</>)
                  : "Envoyer le lien"}
              </button>
            </form>
            <Link href="/login" className="block text-sm text-ink2 hover:text-ink mt-4 text-center">
              ← Revenir à la connexion
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
