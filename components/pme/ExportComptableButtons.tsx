"use client";
import { useState } from "react";

interface ExportBtnProps {
  annee: number;
  mois?: number;
}

const FORMATS = [
  { key: "fec",    label: "FEC (DGI Niger)",    icon: "📋", color: "text-cedar border-cedar/30 hover:bg-cedar/5" },
  { key: "sage",   label: "SAGE 100",            icon: "📊", color: "text-blue-600 border-blue-200 hover:bg-blue-50" },
  { key: "ohada",  label: "OHADA Grand Livre",   icon: "📒", color: "text-green-700 border-green-200 hover:bg-green-50" },
  { key: "cegid",  label: "Cegid",               icon: "📁", color: "text-purple-600 border-purple-200 hover:bg-purple-50" },
  { key: "ebp",    label: "EBP",                 icon: "📁", color: "text-orange-600 border-orange-200 hover:bg-orange-50" },
  { key: "divalto",label: "Divalto",             icon: "📁", color: "text-indigo-600 border-indigo-200 hover:bg-indigo-50" },
];

export function ExportComptableButtons({ annee, mois }: ExportBtnProps) {
  const [loading, setLoading] = useState<string|null>(null);

  async function handleExport(format: string) {
    setLoading(format);
    try {
      const isGeneric = ["cegid","ebp","divalto","fec"].includes(format);
      const base = isGeneric ? "/api/exports/generic" : `/api/exports/${format}`;
      const params = new URLSearchParams({ annee: String(annee) });
      if (mois) params.set("mois", String(mois));
      if (isGeneric) params.set("format", format);

      const res = await fetch(`${base}?${params}`, { credentials: "include" });
      if (!res.ok) { alert(`Erreur lors de l'export ${format.toUpperCase()}`); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "fec" || format === "ebp" ? "txt" : "csv";
      a.download = `${format.toUpperCase()}-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.${ext}`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <p className="w-full text-xs font-medium text-moss mb-1">Exporter la comptabilité :</p>
      {FORMATS.map(f => (
        <button key={f.key} onClick={() => handleExport(f.key)} disabled={loading === f.key}
          className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${f.color}`}>
          {loading === f.key
            ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/></svg>
            : <span className="text-sm">{f.icon}</span>
          }
          {loading === f.key ? "Export…" : f.label}
        </button>
      ))}
    </div>
  );
}
