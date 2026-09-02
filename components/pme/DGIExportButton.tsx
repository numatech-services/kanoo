"use client";
import { useState } from "react";

interface DGIExportButtonProps {
  type: "tva" | "cnss" | "bilan" | "grandlivre";
  annee: number;
  mois?: number;
  label?: string;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  tva: "Déclaration TVA PDF",
  cnss: "Déclaration CNSS PDF",
  bilan: "Bilan DGI PDF",
  grandlivre: "Grand Livre PDF",
};

export function DGIExportButton({ type, annee, mois, label, className = "" }: DGIExportButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, annee: String(annee) });
      if (mois) params.set("mois", String(mois));

      const res = await fetch(`/api/reports/dgi-pdf?${params}`, { credentials: "include" });
      if (!res.ok) { alert("Erreur lors de la génération du PDF"); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `DGI-${type.toUpperCase()}-${mois ? `${String(mois).padStart(2,"0")}-` : ""}${annee}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className={`flex items-center gap-2 px-4 py-2 border border-clay/30 rounded-lg text-sm text-moss hover:bg-sand hover:border-cedar/40 transition-colors disabled:opacity-60 ${className}`}
    >
      {loading ? (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      )}
      {loading ? "Génération…" : (label || TYPE_LABELS[type])}
    </button>
  );
}
