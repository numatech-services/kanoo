"use client";

import { useRouter } from "next/navigation";
import { CommandeForm } from "@/components/pme/CommandeForm";

export default function NewCommandePage() {
  const router = useRouter();

  async function handleSave(data: Record<string, unknown>) {
    console.log("📤 [BC New] Tentative d'enregistrement avec les données:", data);
    
    try {
      // 1. Récupération du token CSRF
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      console.log("🔑 [BC New] CSRF Token récupéré");

      // 2. Envoi de la commande
      const res = await fetch("/api/commandes", { 
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
        console.error("❌ [BC New] Erreur API:", d.error);
        throw new Error(d.error || "Une erreur est survenue lors de l'enregistrement");
      }

      console.log("✅ [BC New] Commande créée avec succès, redirection...");
      router.push(`/commandes/${d.data._id}`);
      
    } catch (err: any) {
      console.error("🔥 [BC New] Erreur critique:", err.message);
      alert(`Erreur: ${err.message}`);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <button 
          onClick={() => router.push("/commandes")} 
          className="text-xs text-moss hover:text-ink flex items-center gap-1"
        >
          ← Retour aux bons de commande
        </button>
        <h1 className="text-2xl font-bold text-ink mt-1">Nouveau bon de commande</h1>
      </div>
      
      <div className="bg-white rounded-2xl border border-clay/20 p-6 shadow-sm">
        <CommandeForm 
          onSave={handleSave} 
          onCancel={() => router.push("/commandes")} 
        />
      </div>
    </div>
  );
}