"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, FileUp, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { apiJson, apiSend } from "@/lib/api-client";
import { compressPhoto } from "@/components/isic/image";
import { buttonClass } from "@/components/ui/button-class";

export interface ScannedInvoice {
  invoice: {
    supplierName: string; supplierNif: string; invoiceNumber: string; invoiceDate: string; dueDate: string; currency: string;
    lines: Array<{ description: string; quantity: number; unitPriceHT: number; tvaRate: number; accountCode: string }>;
    totalHT: number; totalTVA: number; totalTTC: number; notes: string;
  };
  warnings: string[];
  supplier: { _id: string; name: string; paymentTermDays?: number } | null;
}

/** data:…;base64 → Blob, sans fetch (la CSP limite connect-src à l'origine). */
function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * « Lire une facture » : photo (appareil photo arrière sur téléphone) ou PDF,
 * lu par l'IA, qui pré-remplit le formulaire d'achat. L'utilisateur relit
 * avant d'enregistrer ; les écarts de calcul sont signalés, jamais corrigés
 * en silence. Absent si la lecture n'est pas configurée sur l'instance.
 */
export function InvoiceScan({ onRead }: { onRead: (r: ScannedInvoice, file: { blob: Blob; name: string }) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ configured: boolean; remaining?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    apiJson("/api/ai/lire-facture", { quiet: true })
      .then(d => setState({ configured: Boolean(d.data?.configured), remaining: d.data?.quota?.remaining }))
      .catch(() => setState({ configured: false }));
  }, []);

  if (!state?.configured) return null;

  async function send(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setWarnings([]);
    try {
      // Une photo de téléphone pèse souvent 4 à 10 Mo : ramenée à 2000 px, elle
      // reste lisible et part vite. Les PDF partent tels quels.
      const compressed = file.type.startsWith("image/") && file.type !== "image/gif";
      const upload = compressed ? dataUrlToBlob(await compressPhoto(file, 2000)) : file;
      // Nom cohérent avec le contenu envoyé (une photo recompressée est un JPEG) :
      // la pièce jointe est contrôlée sur l'extension ET les octets.
      const base = (file.name || "facture").replace(/\.[^.]+$/, "") || "facture";
      const name = compressed ? `${base}.jpg` : file.name || "facture.pdf";
      const body = new FormData();
      body.append("file", upload, name);
      const res = await apiSend("POST", "/api/ai/lire-facture", body);
      if (!res.ok) throw new Error(res.data?.error || "Lecture impossible.");
      const r = res.data.data as ScannedInvoice;
      setWarnings(r.warnings);
      setState(s => s && { ...s, remaining: res.data.data?.quota?.remaining ?? s.remaining });
      onRead(r, { blob: upload, name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lecture impossible.");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-[var(--r-lg)] border border-section/25 bg-section-soft/40 p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-start gap-2">
          <Sparkles size={18} className="text-section mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-ink">Lire une facture</p>
            <p className="text-xs text-ink2">Photographiez la facture ou joignez le PDF : fournisseur, lignes, comptes et TVA sont pré-remplis. Vous vérifiez avant d&apos;enregistrer.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className={buttonClass("primary", "sm")}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Photo
          </button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={buttonClass("secondary", "sm")}>
            <FileUp size={14} /> PDF ou image
          </button>
        </div>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => send(e.target.files)} />
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={e => send(e.target.files)} />
      {busy && <p className="text-xs text-ink2">Lecture en cours… (10 à 30 secondes)</p>}
      {error && <p className="text-xs text-neg">{error}</p>}
      {warnings.length > 0 && (
        <ul className="text-xs text-warn space-y-1">
          {warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{w}</li>)}
        </ul>
      )}
      <p className="text-[11px] text-ink3">Le document est transmis à l&apos;assistant IA (Anthropic) pour lecture ; Kanoo ne le conserve pas.{typeof state.remaining === "number" ? ` Lectures restantes ce mois-ci : ${state.remaining}.` : ""}</p>
    </div>
  );
}
