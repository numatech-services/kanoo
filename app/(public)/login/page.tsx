"use client";

/**
 * Page de connexion (charte v5) : carte arrondie sur fond à halos, panneau de
 * marque bleu nuit à gauche, formulaire à droite ; l'étape de double
 * authentification reprend le même cadre.
 *
 * Quatre états (repos / chargement / erreur / succès), accessibilité (labels,
 * autocomplete, aria-*, focus visible), message d'erreur générique (pas
 * d'énumération des comptes), affichage du mot de passe, redirection par rôle.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, AlertCircle, Check, ArrowRight, Lock, ShieldCheck } from "lucide-react";

import { apiSend } from "@/lib/api-client";
import { purgeOfflineData } from "@/lib/offline/sync-queue";
import { IDLE_MINUTES } from "@/lib/idle";

// L'adresse ne change pas tant que la page est affichée : rien à écouter.
const noSubscribe = () => () => {};
const IDLE_NOTICE = "Vous avez été déconnecté pour inactivité. Reconnectez-vous.";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState("");
  // Rien de la session précédente ne reste lisible sur ce téléphone (données gardées hors ligne).
  useEffect(() => { purgeOfflineData("data"); }, []);

  // Message d'inactivité : lu depuis la query (?reason=idle) côté navigateur
  // seulement (vide au rendu serveur), pour éviter la frontière Suspense
  // qu'imposerait useSearchParams.
  const notice = useSyncExternalStore(
    noSubscribe,
    () => (new URLSearchParams(window.location.search).get("reason") === "idle" ? IDLE_NOTICE : ""),
    () => "",
  );

  // Page d'arrivée : les rôles « étroits » atterrissent directement sur leur
  // module, plutôt que sur un tableau de bord dont ils ne peuvent rien lire.
  const LANDING: Record<string, string> = {
    superadmin: "/saas/dashboard",
    pme_activity_manager: "/restauration/magasin",
    svc_spot: "/restauration/magasin",
    pme_isic_operator: "/isic",
    pme_isic_finance: "/isic",
  };
  function redirect(role: string) {
    window.location.href = LANDING[role] ?? "/dashboard";
  }

  async function verify2fa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const res = await apiSend("POST", "/api/auth/2fa/verify", { token: code });
      const result = res.data;
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

      const res = await apiSend("POST", "/api/auth/login", { email, password });
      const result = res.data;
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
  const field = "w-full h-12 px-4 rounded-xl border border-line2 bg-surface text-[15px] text-ink placeholder:text-ink3 transition focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-60";
  const banner = (kind: "error" | "notice", text: string) => (
    <div role={kind === "error" ? "alert" : "status"} id={kind === "error" ? "login-error" : undefined}
      className={`flex gap-2.5 items-start text-[13px] px-3.5 py-3 rounded-xl mb-5 ${kind === "error" ? "bg-neg-50 text-neg" : "bg-accent-50 text-ink2"}`}>
      <AlertCircle size={16} className="flex-none mt-0.5" /><span>{text}</span>
    </div>
  );

  return (
    <div className="app-page px-4 py-8 sm:py-14">
      <div className="max-w-[1080px] mx-auto grid lg:grid-cols-[1.05fr_1fr] rounded-[28px] overflow-hidden bg-surface border border-white/70 shadow-shell">
        {/* Panneau de marque (charte v5) — masqué sur téléphone. */}
        <aside className="relative hidden lg:flex flex-col gap-8 p-12 text-white overflow-hidden bg-gradient-to-br from-[rgb(25_43_111)] to-[rgb(20_24_70)]">
          <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-[rgb(0_130_235)]/35 blur-3xl" aria-hidden />
          <div className="absolute -bottom-28 -right-16 w-80 h-80 rounded-full bg-[rgb(110_68_188)]/35 blur-3xl" aria-hidden />
          <div className="relative">
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-white/55">Votre espace de gestion</p>
            <h2 className="mt-3 text-[34px] leading-[1.08] font-extrabold tracking-[-0.035em]">
              La gestion d&apos;entreprise,<br />
              <span className="bg-gradient-to-r from-[rgb(120_190_255)] to-[rgb(180_160_255)] bg-clip-text text-transparent">pensée pour le Niger.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/70 max-w-[40ch]">
              Facturation, comptabilité SYSCOHADA, paie CNSS/IR, fiscalité DGI et mobile money — dans une seule plateforme.
            </p>
          </div>
          <ul className="relative grid grid-cols-2 gap-3">
            {[
              ["Écritures comptables", "générées automatiquement"],
              ["Mobile money", "Orange, Moov & Airtel Money"],
              ["TVA & CNSS", "déclarations prêtes à déposer"],
              ["Connexion faible", "l'application tient le coup"],
            ].map(([t, d]) => (
              <li key={t} className="rounded-2xl bg-white/[0.07] border border-white/10 p-3.5 flex gap-2.5">
                <span className="w-6 h-6 rounded-full bg-[rgb(0_130_235)]/30 text-[rgb(150_205_255)] grid place-items-center flex-none"><Check size={13} /></span>
                <span className="min-w-0"><span className="block text-[13px] font-semibold">{t}</span><span className="block text-[12px] text-white/60 leading-snug">{d}</span></span>
              </li>
            ))}
          </ul>
          {/* Aperçu décoratif du tableau de bord. */}
          <div className="relative mt-auto rounded-2xl bg-white/[0.08] border border-white/10 p-4 backdrop-blur" aria-hidden>
            <div className="flex items-start justify-between">
              <div><p className="text-[11px] text-white/55">Trésorerie disponible</p><p className="text-[22px] font-extrabold tracking-tight">15,9 M <span className="text-[12px] font-semibold text-white/55">FCFA</span></p></div>
              <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-[rgb(40_170_110)]/25 text-[rgb(140_230_180)]">▲ 18 %</span>
            </div>
            <svg viewBox="0 0 300 60" className="w-full h-14 mt-1" preserveAspectRatio="none">
              <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stopColor="rgb(0 150 235)" /><stop offset="1" stopColor="rgb(160 140 255)" /></linearGradient></defs>
              <path d="M0 50 C30 46 50 34 80 38 S130 22 160 26 S220 10 250 14 S285 6 300 4" fill="none" stroke="url(#lg)" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="absolute -top-5 right-4 font-hand text-[22px] text-[rgb(170_200_255)] -rotate-6">Chaque franc compte.</p>
          </div>
          <p className="relative text-[12px] text-white/45">© {new Date().getFullYear()} Numatech Services — Niamey · Données chiffrées</p>
        </aside>

        {/* Formulaire */}
        <main className="flex items-center justify-center px-6 py-10 sm:px-12 sm:py-14">
          <div className="w-full max-w-[380px]">
            {twoFactor ? (
              <>
                <span className="w-12 h-12 rounded-2xl grad-brand grad-brand-glow grid place-items-center mb-5"><ShieldCheck size={22} /></span>
                <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">Vérification en deux étapes</h1>
                <p className="text-ink2 text-sm mt-1.5 mb-7">Saisissez le code à 6 chiffres de votre application d&apos;authentification, ou un code de secours.</p>
                {error && banner("error", error)}
                <form onSubmit={verify2fa}>
                  <label htmlFor="code" className="block text-[13px] font-semibold text-ink mb-1.5">Code</label>
                  <input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                    className={`${field} text-center tracking-[0.45em] font-mono text-lg`} placeholder="000000" disabled={loading} />
                  <button type="submit" disabled={loading} className="mt-5 w-full h-12 rounded-full grad-brand grad-brand-glow text-[15px] font-semibold inline-flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-60">
                    {loading ? (<><Loader2 size={16} className="animate-spin" /> Vérification…</>) : "Vérifier"}
                  </button>
                </form>
                <button onClick={() => { setTwoFactor(false); setCode(""); setError(""); }} className="text-sm text-ink2 hover:text-ink mt-5 w-full text-center">← Revenir à la connexion</button>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-ink3">Bienvenue</p>
                <h1 className="mt-1.5 text-[30px] font-extrabold tracking-[-0.035em] text-ink">Connexion</h1>
                <p className="text-ink2 text-[15px] mt-1.5 mb-7">Accédez à votre espace de gestion.</p>

                {notice && !error && banner("notice", notice)}
                {error && banner("error", error)}

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-[13px] font-semibold text-ink mb-1.5">Adresse email</label>
                    <input id="email" name="email" type="email" autoComplete="email" required autoFocus
                      value={email} onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined}
                      className={field} placeholder="vous@entreprise.ne" disabled={loading} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="password" className="text-[13px] font-semibold text-ink">Mot de passe</label>
                      <Link href="/mot-de-passe-oublie" className="text-[13px] font-semibold text-accent hover:underline">Mot de passe oublié ?</Link>
                    </div>
                    <div className="relative">
                      <input id="password" name="password" type={showPwd ? "text" : "password"} autoComplete="current-password" required
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined}
                        className={`${field} pr-12`} placeholder="••••••••" disabled={loading} />
                      <button type="button" onClick={() => setShowPwd((v) => !v)}
                        aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center text-ink3 hover:bg-surface2 hover:text-ink">
                        {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="!mt-6 w-full h-12 rounded-full grad-brand grad-brand-glow text-[15px] font-semibold inline-flex items-center justify-center gap-2 hover:brightness-105 disabled:opacity-60">
                    {loading ? (<><Loader2 size={16} className="animate-spin" /> Connexion…</>)
                     : status === "success" ? (<><Check size={16} /> Connecté</>)
                     : <>Se connecter <ArrowRight size={16} /></>}
                  </button>
                </form>

                <div className="mt-7 pt-6 border-t border-line text-center text-sm text-ink2">
                  Pas encore de compte ?{" "}
                  <Link href="/souscrire" className="text-accent font-semibold hover:underline">Démarrer l&apos;essai gratuit</Link>
                </div>
                <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-ink3">
                  <Lock size={12} /> Connexion chiffrée · déconnexion automatique après {IDLE_MINUTES} min d&apos;inactivité
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
