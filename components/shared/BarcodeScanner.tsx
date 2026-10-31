"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff, ScanBarcode } from "lucide-react";
import { inputCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";

let audio: AudioContext | null = null;
/** Bip court (lu) ou grave (inconnu) : l'équipe compte sans regarder l'écran. Un seul contexte audio pour toute la session. */
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new Ctx();
    const ctx = audio, o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220; o.type = "sine";
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.1 : 0.3));
  } catch { /* audio indisponible */ }
}

/**
 * Lecture de codes-barres (EAN, UPC, Code 128, QR…) :
 *  - douchette USB ou Bluetooth : elle « tape » le code puis Entrée dans le
 *    champ, toujours prêt à recevoir ;
 *  - caméra du téléphone ou de la tablette (bouton Caméra) ;
 *  - saisie à la main du code ou du nom, en dernier recours.
 * Douchette et saisie : chaque lecture compte (12 bouteilles = 12 lectures).
 * Caméra : un code reste dans le champ pendant plusieurs images ; il ne
 * compte à nouveau qu'après en être sorti (une seconde sans le voir).
 * `refocus` : changer sa valeur rend la main au champ de lecture.
 */
export function BarcodeScanner({ onCode, placeholder = "Scanner ou taper un code, puis Entrée", refocus }: { onCode: (code: string) => void; placeholder?: string; refocus?: number }) {
  const regionId = `scan-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [cam, setCam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const seen = useRef({ code: "", at: 0 });
  const handler = useRef(onCode);
  useEffect(() => { handler.current = onCode; }, [onCode]);
  useEffect(() => { if (refocus !== undefined) inputRef.current?.focus(); }, [refocus]);

  const emit = (raw: string) => { const code = raw.trim(); if (code) handler.current(code); };
  const fromCamera = (raw: string) => {
    const code = raw.trim(), now = Date.now();
    if (!code) return;
    const again = code === seen.current.code && now - seen.current.at < 1000;
    seen.current = { code, at: now };
    if (!again) handler.current(code);
  };

  useEffect(() => {
    if (!cam) return;
    let cancelled = false;
    // Le démarrage est attendu avant l'arrêt : sinon la caméra resterait allumée.
    const started = (async () => {
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return null;
        const scanner = new mod.Html5Qrcode(regionId, { verbose: false });
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 140 } }, (decoded: string) => fromCamera(decoded), () => { /* rien lu */ });
        return scanner;
      } catch {
        setError("Caméra inaccessible : autorisez l'accès, ou utilisez une douchette ou la saisie.");
        setCam(false);
        return null;
      }
    })();
    return () => { cancelled = true; started.then(sc => sc?.stop().then(() => sc.clear()).catch(() => { /* déjà arrêté */ })); };
  }, [cam, regionId]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input ref={inputRef} autoFocus className={`${inputCls} pl-9`} value={text} placeholder={placeholder} inputMode="text" autoComplete="off" aria-label="Code-barres ou nom de l'article"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); emit(text); setText(""); } }} />
        </div>
        <button type="button" onClick={() => { setError(null); setCam(c => !c); }} className={buttonClass(cam ? "primary" : "secondary", "md")} aria-pressed={cam}>
          {cam ? <CameraOff size={15} /> : <Camera size={15} />} {cam ? "Arrêter" : "Caméra"}
        </button>
      </div>
      {cam && <div id={regionId} className="rounded-xl overflow-hidden border border-line max-w-sm" />}
      {error && <p className="text-xs text-warn">{error}</p>}
    </div>
  );
}
