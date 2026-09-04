"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

/**
 * Sélecteur de logo réutilisable (client, fournisseur, organisation).
 * Le fichier est encodé en data-URI côté navigateur, borné en taille, et remonté
 * via `onChange`. Une chaîne vide signifie « pas de logo ».
 */
export function LogoPicker({
  value,
  onChange,
  maxBytes = 150_000,
  label = "Logo",
  hint = "PNG ou JPEG, 150 Ko max.",
}: {
  value?: string;
  onChange: (dataUri: string) => void;
  maxBytes?: number;
  label?: string;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file: File) {
    setError(null);
    if (file.size > maxBytes) {
      setError(`Logo trop lourd (${Math.round(maxBytes / 1000)} Ko max).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.onerror = () => setError("Lecture du fichier impossible.");
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <span className="block text-xs font-medium text-ink2 mb-1">{label}</span>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg border border-line2 bg-surface2 grid place-items-center overflow-hidden shrink-0">
          {value
            ? <img src={value} alt="Logo" className="max-w-full max-h-full object-contain" />
            : <span className="text-[10px] text-ink3 text-center px-1">Aucun</span>}
        </div>
        <div className="space-y-1">
          <button type="button" onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            <Upload size={14} /> {value ? "Remplacer" : "Choisir un logo"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange("")}
              className="ml-2 inline-flex items-center gap-1 text-xs text-neg hover:underline">
              <X size={12} /> Retirer
            </button>
          )}
          <p className="text-[11px] text-ink3">{hint}</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden"
        onChange={e => e.target.files?.[0] && pick(e.target.files[0])} />
      {error && <p className="mt-1 text-xs text-neg">{error}</p>}
    </div>
  );
}
