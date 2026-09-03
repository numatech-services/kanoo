"use client";

import { useRef, useState } from "react";
import { Camera, Upload, Check, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  hostId: string;
  lineId: string;
  count: number;
  onUploaded: () => void;
  disabled?: boolean;
}

/**
 * Capture d'un justificatif, à même la ligne de dépense.
 *
 * Deux boutons, et la raison de les séparer : sur un téléphone,
 * `capture="environment"` ouvre l'appareil photo arrière directement, sans
 * passer par la galerie. C'est le geste réel — on photographie le reçu au
 * moment où on le reçoit, debout devant le comptoir. Réclamer un fichier au
 * retour au bureau, c'est réclamer un reçu déjà perdu.
 *
 * Le second bouton reste indispensable : une facture d'hôtel arrive par
 * courriel, en PDF.
 */
export function ReceiptCapture({ hostId, lineId, count, onUploaded, disabled }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        body.append("host", "expenses");
        body.append("hostId", hostId);
        body.append("lineId", lineId);
        body.append("category", "justificatif");

        const res = await fetch("/api/attachments", {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          credentials: "include",
          body,
        });
        if (!res.ok) throw new Error((await res.json()).error || "Envoi refusé");
      }
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {count > 0 ? (
          <span className="pill pill-pos" title={`${count} justificatif(s)`}>
            <Check size={11} strokeWidth={3} />
            {count > 1 ? `${count} pièces` : "Pièce jointe"}
          </span>
        ) : (
          <span className="pill pill-warn" title="Justificatif manquant">
            <AlertTriangle size={11} /> Sans pièce
          </span>
        )}

        {!disabled && (
          <>
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy}
              title="Photographier le reçu"
              className="p-1.5 rounded-lg text-ink3 hover:text-section hover:bg-section-soft disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              title="Choisir un fichier (PDF, image)"
              className="p-1.5 rounded-lg text-ink3 hover:text-section hover:bg-section-soft disabled:opacity-40">
              <Upload size={14} />
            </button>
          </>
        )}
      </div>

      {error && <p className="text-[11px] text-neg max-w-[14rem]">{error}</p>}

      {/* `capture` n'est honoré que par les navigateurs mobiles ; ailleurs il
          se comporte comme un sélecteur de fichier ordinaire. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={e => send(e.target.files)} />
      <input ref={fileRef} type="file" multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
        className="hidden" onChange={e => send(e.target.files)} />
    </div>
  );
}
