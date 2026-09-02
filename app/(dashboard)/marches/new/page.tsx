"use client";
import { useRouter } from "next/navigation";
import { MarcheForm } from "@/components/pme/MarcheForm";
import { useState } from "react";

export default function NewMarchePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave(data: Record<string, unknown>) {
    setIsSubmitting(true);
    try {
      // 1. Récupération du Token CSRF
      const csrfRes = await fetch("/api/auth/csrf");
      if (!csrfRes.ok) throw new Error("Impossible de récupérer le jeton de sécurité (CSRF)");
      
      const { csrfToken } = await csrfRes.json();

      // 2. Envoi des données
      const res = await fetch("/api/marches", { 
        method: "POST", 
        headers: { 
          "Content-Type": "application/json", 
          "x-csrf-token": csrfToken 
        }, 
        credentials: "include", 
        body: JSON.stringify(data) 
      });

      const d = await res.json();

      if (!res.ok) {
        throw new Error(d.error || "Une erreur est survenue lors de la création");
      }

      // 3. Redirection vers le détail du nouveau marché
      // Assure-toi que ton API renvoie bien l'objet dans d.data
      const newId = d.data?._id || d._id;
      router.push(`/marches/${newId}`);
      router.refresh(); // Force le rafraîchissement des données

    } catch (err: any) {
      console.error("Erreur création marché:", err);
      alert(err.message); // Pour que l'utilisateur sache pourquoi ça n'avance pas
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <button 
          onClick={() => router.push("/marches")} 
          className="text-xs text-moss hover:text-ink flex items-center gap-1"
        >
          ← Retour aux marchés
        </button>
        <h1 className="text-2xl font-bold text-ink mt-1">Nouveau marché</h1>
      </div>

      <div className={`bg-white rounded-2xl border border-clay/20 p-6 ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}>
        <MarcheForm 
          onSave={handleSave} 
          onCancel={() => router.push("/marches")} 
        />
        {isSubmitting && (
          <p className="text-center text-xs text-cedar mt-4 animate-pulse font-medium">
            Création du marché en cours...
          </p>
        )}
      </div>
    </div>
  );
}