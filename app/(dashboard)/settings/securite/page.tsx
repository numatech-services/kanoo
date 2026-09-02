"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck, ShieldOff, Copy, Loader2, KeyRound } from "lucide-react";
import toast from "react-hot-toast";

type Step = "idle" | "setup" | "backup";

export default function SecuritePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  useEffect(() => {
    fetch("/api/auth/2fa/setup", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEnabled(!!d.data?.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function startSetup() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setSecret(d.data.secret);
      setQr(await QRCode.toDataURL(d.data.otpauth, { margin: 1, width: 200, color: { dark: "#17130E", light: "#FFFFFF" } }));
      setStep("setup");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Code incorrect");
      setBackup(d.data.backupCodes || []);
      setStep("backup");
      setEnabled(true);
      setCode("");
      toast.success("Authentification à deux facteurs activée");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: disableCode }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setEnabled(false); setShowDisable(false); setDisableCode(""); setStep("idle");
      toast.success("2FA désactivée");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  }

  function copyBackup() {
    navigator.clipboard?.writeText(backup.join("\n")).then(() => toast.success("Codes copiés")).catch(() => {});
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="page-title">Sécurité</h1>
        <p className="text-sm text-ink2 mt-0.5">Renforcez la protection de votre compte.</p>
      </div>

      <div className="card card-p">
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-lg grid place-items-center flex-none ${enabled ? "bg-acacia-50 text-acacia" : "bg-surface2 text-ink2"}`}>
            {enabled ? <ShieldCheck size={20} /> : <KeyRound size={20} />}
          </span>
          <div className="flex-1">
            <h2 className="section-title">Authentification à deux facteurs (2FA)</h2>
            <p className="text-sm text-ink2 mt-1">Un code temporaire depuis votre téléphone, en plus du mot de passe. Compatible Google Authenticator, Authy, FreeOTP.</p>

            {enabled === null ? (
              <p className="text-sm text-ink3 mt-4">Chargement…</p>
            ) : enabled && step !== "backup" ? (
              <div className="mt-4">
                <span className="badge badge-paid">Activée</span>
                {!showDisable ? (
                  <button onClick={() => setShowDisable(true)} className="btn-secondary mt-4"><ShieldOff size={15} /> Désactiver</button>
                ) : (
                  <form onSubmit={disable} className="mt-4 flex gap-2 items-end max-w-sm">
                    <div className="flex-1">
                      <label className="label">Code actuel pour confirmer</label>
                      <input className="input font-mono" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="000000" />
                    </div>
                    <button type="submit" disabled={busy} className="btn-danger">Confirmer</button>
                  </form>
                )}
              </div>
            ) : step === "idle" ? (
              <button onClick={startSetup} disabled={busy} className="btn-primary mt-4">{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Activer la 2FA</button>
            ) : null}
          </div>
        </div>

        {/* Étape configuration */}
        {step === "setup" && (
          <div className="mt-6 pt-6 border-t border-line grid sm:grid-cols-[auto_1fr] gap-6 items-start">
            <div className="text-center">
              {qr ? <img src={qr} alt="QR code 2FA" width={180} height={180} className="rounded-md border border-line" /> : <div className="w-[180px] h-[180px] bg-surface2 rounded-md animate-pulse" />}
              <p className="text-[11px] text-ink3 mt-2">ou saisir la clé :</p>
              <p className="font-mono text-xs break-all text-ink2 max-w-[180px]">{secret}</p>
            </div>
            <form onSubmit={confirmEnable}>
              <ol className="text-sm text-ink2 space-y-1 mb-3 list-decimal list-inside">
                <li>Scannez le QR dans votre application d'authentification.</li>
                <li>Saisissez le code à 6 chiffres affiché.</li>
              </ol>
              <label className="label">Code de vérification</label>
              <input className="input font-mono text-center tracking-[0.3em] text-lg max-w-[220px]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" autoFocus />
              <div className="flex gap-2 mt-4">
                <button type="submit" disabled={busy} className="btn-primary">{busy ? "Vérification…" : "Activer"}</button>
                <button type="button" onClick={() => { setStep("idle"); setCode(""); }} className="btn-secondary">Annuler</button>
              </div>
            </form>
          </div>
        )}

        {/* Codes de secours */}
        {step === "backup" && (
          <div className="mt-6 pt-6 border-t border-line">
            <h3 className="section-title">Codes de secours</h3>
            <p className="text-sm text-ink2 mt-1">Conservez ces codes en lieu sûr. Chacun s'utilise <b>une seule fois</b> si vous perdez votre téléphone.</p>
            <div className="grid grid-cols-2 gap-2 mt-3 max-w-sm">
              {backup.map((c) => <span key={c} className="font-mono text-sm bg-surface2 border border-line rounded px-2 py-1.5 text-center">{c}</span>)}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={copyBackup} className="btn-secondary"><Copy size={15} /> Copier</button>
              <button onClick={() => setStep("idle")} className="btn-primary">J'ai noté mes codes</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
