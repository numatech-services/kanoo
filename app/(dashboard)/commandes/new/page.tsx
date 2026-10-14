"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUrlReady } from "@/lib/url-param";
import { CommandeForm } from "@/components/pme/CommandeForm";
import { errorMessage } from "@/lib/errors";

import { showToast } from "@/components/ui/Toast";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
export default function NewCommandePage() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const ready = useUrlReady(p => setSupplierId(p.get("supplierId") ?? ""));

  async function handleSave(data: Record<string, unknown>) {
    
    try {
      // 1. Récupération du token CSRF
      const csrfToken = await getCsrfToken();

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
        console.error("[BC New] Erreur API:", d.error);
        throw new Error(d.error || "Une erreur est survenue lors de l'enregistrement");
      }
      router.push(`/commandes/${d.data._id}`);
      
    } catch (err) {
      console.error("[BC New] Erreur critique:", errorMessage(err));
      showToast(`Erreur: ${errorMessage(err)}`, "error");
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
        <h1 className="page-title mt-1">Nouveau bon de commande</h1>
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