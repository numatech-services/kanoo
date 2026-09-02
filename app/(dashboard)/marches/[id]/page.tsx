"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { MarcheForm } from "@/components/pme/MarcheForm";

export default function MarcheDetailPage() {
  const params = useParams(); // Récupération sécurisée des paramètres
  const id = params?.id;
  const router = useRouter();
  
  const [item, setItem] = useState<Record<string, any> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Chargement des données
  useEffect(() => {
    if (!id) return;
    
    fetch(`/api/marches/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success === false) {
          setError(d.error || "Erreur de chargement");
        } else {
          setItem(d.data || d);
        }
      })
      .catch(err => setError(err.message));
  }, [id]);

  // 2. Sauvegarde des modifications (PATCH)
  async function handleSave(body: Record<string, any>) {
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      
      const res = await fetch(`/api/marches/${id}`, { 
        method: "PATCH", 
        headers: { 
          "Content-Type": "application/json", 
          "x-csrf-token": csrfToken 
        }, 
        credentials: "include", 
        body: JSON.stringify(body) 
      });

      const d = await res.json();
      if (res.ok) { 
        setItem(d.data || d); 
        setEditOpen(false); 
      } else {
        alert(d.error);
      }
    } catch (err: any) {
      console.error(err);
    }
  }

  // État de chargement ou erreur
  if (error) return <div className="p-6 text-red-500 font-bold bg-white rounded-xl border">Erreur : {error}</div>;
  if (!item) return <div className="p-6"><div className="h-48 bg-white rounded-xl animate-pulse border border-clay/20" /></div>;

  return (
    <div className="space-y-5 max-w-3xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.push("/marches")} className="text-xs text-moss hover:text-ink">
            ← Retour aux marchés
          </button>
          <h1 className="text-2xl font-bold text-ink mt-1">
            {String(item.reference || item.object || "Détail du marché")}
          </h1>
        </div>
        <button 
          onClick={() => setEditOpen(true)} 
          className="mt-2 px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand transition-colors"
        >
          Modifier
        </button>
      </div>

      <div className="bg-white rounded-xl border border-clay/20 p-5 shadow-sm">
        <div className="space-y-2">
          {Object.entries(item)
            .filter(([k]) => !["_id", "tenantId", "__v", "createdAt", "updatedAt", "lines", "approvers", "decisions", "attendees"].includes(k))
            .map(([k, v]) => {
              if (v === null || v === undefined) return null;
              const display = typeof v === "object" ? JSON.stringify(v) : String(v);
              return (
                <div key={k} className="flex gap-3 py-2 border-b border-clay/10 last:border-0 text-sm">
                  <span className="text-moss w-40 flex-shrink-0 capitalize font-medium">{k.replace(/([A-Z])/g, " $1")}</span>
                  <span className="text-ink font-semibold">
                    {k === "status" ? <StatusBadge status={display} /> : display}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Modal d'édition */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Modifier le marché">
        <div className="p-6 bg-white">
          <MarcheForm 
            initialData={item} 
            onSave={handleSave} 
            onCancel={() => setEditOpen(false)} 
          />
        </div>
      </Modal>
    </div>
  );
}