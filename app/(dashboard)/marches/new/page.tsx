"use client";
import { useRouter } from "next/navigation";
import { MarcheForm } from "@/components/pme/MarcheForm";
import { useState } from "react";
import { errorMessage } from "@/lib/errors";

import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
export default function NewMarchePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave(data: Record<string, unknown>) {
    setIsSubmitting(true);
    try {
      const res = await apiSend("POST", "/api/marches", data);
      const d = res.data;

      if (!res.ok) {
        throw new Error(d.error || "Une erreur est survenue lors de la création");
      }

      // 3. Redirection vers le détail du nouveau marché
      // Assure-toi que ton API renvoie bien l'objet dans d.data
      const newId = d.data?._id || d._id;
      router.push(`/marches/${newId}`);
      router.refresh(); // Force le rafraîchissement des données

    } catch (err) {
      console.error("Erreur création marché:", err);
      showToast(errorMessage(err), "error"); // Pour que l'utilisateur sache pourquoi ça n'avance pas
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <button 
          onClick={() => router.push("/marches")} 
          className="text-xs text-ink2 hover:text-ink flex items-center gap-1"
        >
          ← Retour aux marchés
        </button>
        <h1 className="page-title mt-1">Nouveau marché</h1>
      </div>

      <div className={`bg-surface rounded-2xl border border-line p-6 ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}>
        <MarcheForm 
          onSave={handleSave} 
          onCancel={() => router.push("/marches")} 
        />
        {isSubmitting && (
          <p className="text-center text-xs text-section mt-4 animate-pulse font-medium">
            Création du marché en cours...
          </p>
        )}
      </div>
    </div>
  );
}