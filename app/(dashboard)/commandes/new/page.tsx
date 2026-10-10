"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUrlReady } from "@/lib/url-param";
import { CommandeForm } from "@/components/pme/CommandeForm";
import { errorMessage } from "@/lib/errors";

export default function NewCommandePage() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const ready = useUrlReady(p => setSupplierId(p.get("supplierId") ?? ""));

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
      
    } catch (err) {
      console.error("🔥 [BC New] Erreur critique:", errorMessage(err));
      alert(`Erreur: ${errorMessage(err)}`);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <button 
          onClick={() => router.push("/commandes")} 
          className="text-xs text-ink2 hover:text-ink flex items-center gap-1"
        >
          ← Retour aux bons de commande
        </button>
        <h1 className="text-2xl font-bold text-ink mt-1">Nouveau bon de commande</h1>
      </div>
      
      <div className="bg-surface rounded-2xl border border-line p-6 shadow-sm">
        {/* Fournisseur présélectionné depuis sa fiche (« + Commande »). */}
        {ready && <CommandeForm 
          initialData={supplierId ? { supplierId, orderDate: new Date().toISOString() } : undefined}
          onSave={handleSave} 
          onCancel={() => router.push("/commandes")} 
        />}
      </div>
    </div>
  );
}