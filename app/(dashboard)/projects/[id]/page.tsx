"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params?.id;
  const router = useRouter();
  
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

useEffect(() => {
  async function load() {
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: "include" });
      const d = await res.json();
      
      if (res.ok) {
        // Supporte les deux formats de réponse : d.data ou d direct
        setItem(d.data || d); 
      } else {
        setErrorInfo(d.message || "Ressource introuvable");
      }
    } catch (err) {
      setErrorInfo("Erreur réseau");
    }
  }
  if (id) load();
}, [id]);

  // État de chargement
  if (loading) {
    return (
      <div className="p-6">
        <div className="h-48 bg-white rounded-xl animate-pulse border border-clay/20" />
        <p className="mt-4 text-xs text-moss">Vérification des logs en cours...</p>
      </div>
    );
  }

  // État d'erreur
  if (errorInfo || !item) {
    return (
      <div className="p-6 space-y-4">
        <div className="p-4 border border-red-200 bg-red-50 text-red-700 rounded-xl">
          <h2 className="font-bold">Erreur de chargement</h2>
          <p className="text-sm">Message: {errorInfo || "Projet introuvable"}</p>
          <p className="text-xs mt-2 font-mono">ID URL: {String(id)}</p>
        </div>
        <button onClick={() => router.push("/projects")} className="text-sm text-cedar underline">
          ← Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.push("/projects")} className="text-xs text-moss hover:text-ink">
            ← Projets
          </button>
          <h1 className="text-2xl font-bold text-ink mt-1">
            {item.name || "Sans titre"}
          </h1>
          {item.code && <p className="text-moss text-sm font-mono">{item.code}</p>}
        </div>
        <button className="mt-2 px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">
          Modifier
        </button>
      </div>

      <div className="bg-white rounded-xl border border-clay/20 p-5 shadow-sm">
        <div className="space-y-2">
          {/* Debug: Affiche toutes les clés reçues si le tableau est vide */}
          {Object.entries(item).length === 0 && <p className="text-xs text-red-500">L'objet projet est vide.</p>}
          
          {Object.entries(item)
            .filter(([k]) => !["_id", "tenantId", "__v", "createdAt", "updatedAt"].includes(k))
            .map(([k, v]) => {
              if (v === null || v === undefined) return null;
              const display = typeof v === "object" ? JSON.stringify(v) : String(v);
              
              return (
                <div key={k} className="flex gap-3 py-2 border-b border-clay/10 last:border-0 text-sm">
                  <span className="text-moss w-36 flex-shrink-0 capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                  <span className="text-ink font-medium">
                    {k === "status" ? <StatusBadge status={display} /> : display}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}