"use client";

/**
 * Kanoo — app/(public)/login/page.tsx  (refonte v2)
 * Remplace le fichier existant. Reprend fidèlement votre flux d'API
 * (/api/auth/csrf puis /api/auth/login) et la redirection par rôle.
 *
 * Améliorations : direction fintech premium, 4 états gérés (repos / chargement
 * / erreur / succès), accessibilité (label associé, autocomplete, aria-*,
 * focus visible), message d'erreur générique (anti-énumération de comptes),
 * affichage/masquage du mot de passe, lien « mot de passe oublié ».
 *
 * NB sécurité : le token CSRF est envoyé mais n'est aujourd'hui vérifié par
 * aucune route serveur (cf. rapport, M-5). À implémenter côté API ou à retirer.
 */

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, AlertCircle, Check } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState("");

  function redirect(role: string) {
    window.location.href = role === "superadmin" ? "/saas/dashboard" : "/dashboard";
  }

  async function verify2fa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
        credentials: "include",
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Code incorrect");
      setStatus("success");
      redirect(result.data.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code incorrect");
      setStatus("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      const result = await res.json();
      if (!res.ok) {
        // Message unique volontaire : ne révèle pas si l'email existe.
        throw new Error("Email ou mot de passe incorrect.");
      }

      // 2FA activé : passer à l'étape du code.
      if (result.data?.twoFactorRequired) {
        setTwoFactor(true);
        setStatus("idle");
        return;
      }

      setStatus("success");
      redirect(result.data.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setStatus("idle");
    }
  }

  const loading = status === "loading";

  // Étape 2 : code d'authentification à deux facteurs.
  if (twoFactor) {
    return (
      <div className="min-h-screen grid place-items-center bg-surface p-6">
        <div className="w-full max-w-[376px]">
          <h1 className="text-[22px] font-bold tracking-tight">Vérification en deux étapes</h1>
          <p className="text-ink2 text-sm mt-1 mb-6">Saisissez le code à 6 chiffres de votre application d'authentification (ou un code de secours).</p>
          {error && (
            <div role="alert" className="flex gap-2.5 items-start bg-neg-50 border border-neg/25 text-neg text-xs px-3 py-2.5 rounded-sm mb-4">
              <AlertCircle size={15} className="flex-none mt-0.5" /><span>{error}</span>
            </div>
          )}
          <form onSubmit={verify2fa}>
            <label htmlFor="code" className="label">Code</label>
            <input
              id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus
              value={code} onChange={(e) => setCode(e.target.value)}
              className="input text-center tracking-[0.4em] font-mono text-lg" placeholder="000000" disabled={loading}
            />
            <button type="submit" disabled={loading} className="btn-primary w-full h-11 mt-4">
              {loading ? (<><Loader2 size={15} className="animate-spin" /> Vérification…</>) : "Vérifier"}
            </button>
          </form>
          <button onClick={() => { setTwoFactor(false); setCode(""); setError(""); }} className="text-sm text-ink2 hover:text-ink mt-4 w-full text-center">← Revenir à la connexion</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_.95fr] bg-surface">
      {/* Panneau de marque (masqué sur mobile) */}
      <aside className="relative hidden lg:flex flex-col justify-between p-14 text-white overflow-hidden
        bg-[#17130E]
        [background-image:radial-gradient(1200px_500px_at_15%_-10%,rgba(194,98,14,.5),transparent_60%),radial-gradient(900px_500px_at_110%_120%,rgba(194,98,14,.26),transparent_55%)]">
        <div className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
          <span className="w-8 h-8 rounded-lg bg-accent grid place-items-center shadow-[0_4px_14px_rgba(194,98,14,.5)]">K</span>
          Kanoo
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight max-w-[14ch] mb-3.5">
            La gestion d'entreprise, pensée pour le Niger.
          </h2>
          <p className="text-[#aeb6bf] text-[15px] max-w-[38ch]">
            Facturation, comptabilité OHADA, paie CNSS/IR, fiscalité DGI et mobile money — dans une seule plateforme.
          </p>
          <ul className="flex flex-col gap-3 mt-7">
            {[
              "Écritures comptables générées automatiquement",
              "Encaissement Orange, Moov & Airtel Money",
              "Déclarations TVA 19 % & CNSS prêtes à déposer",
              "Fonctionne même en connexion faible",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3 text-[#d7dce1] text-sm">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-[#E9A45C] grid place-items-center text-xs flex-none">
                  <Check size={12} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[#7d8894] text-xs">© 2026 Numatech Services — Niamey · Données chiffrées</p>
      </aside>

      {/* Formulaire */}
      <main className="flex items-center justify-center p-8">
        <div className="w-full max-w-[376px]">
          <div className="lg:hidden flex items-center gap-2.5 font-bold text-lg mb-8">
            <span className="w-8 h-8 rounded-lg bg-accent text-white grid place-items-center">K</span> Kanoo
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">Connexion</h1>
          <p className="text-ink2 text-sm mt-1 mb-6">Accédez à votre espace de gestion.</p>

          {error && (
            <div role="alert" className="flex gap-2.5 items-start bg-neg-50 border border-neg/25 text-neg text-xs px-3 py-2.5 rounded-sm mb-4">
              <AlertCircle size={15} className="flex-none mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label htmlFor="email" className="label">Adresse email</label>
              <input
                id="email" name="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined}
                className="input" placeholder="vous@entreprise.ne" disabled={loading}
              />
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="label mb-0">Mot de passe</label>
                <Link href="/mot-de-passe-oublie" className="text-xs font-medium text-accent-600 hover:underline">
                  Mot de passe oublié ?
                </Link>
              </div>
              <div className="relative flex items-center">
                <input
                  id="password" name="password" type={showPwd ? "text" : "password"}
                  autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined}
                  className="input pr-16" placeholder="••••••••" disabled={loading}
                />
                <button
                  type="button" onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  className="absolute right-1.5 h-7 px-2 rounded text-xs font-medium text-ink2 hover:bg-surface2 flex items-center gap-1"
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full h-11">
              {loading ? (<><Loader2 size={15} className="animate-spin" /> Connexion…</>)
               : status === "success" ? (<><Check size={15} /> Connecté</>)
               : "Se connecter"}
            </button>
          </form>

          <p className="text-center text-sm text-ink2 mt-6">
            Pas encore de compte ?{" "}
            <Link href="/souscrire" className="text-accent-600 font-semibold hover:underline">
              Démarrer l'essai gratuit
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
