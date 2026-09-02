"use client";

import { useRouter } from "next/navigation";
import { AccountingEntryForm } from "@/components/pme/AccountingEntryForm";
import { useState } from "react";

export default function NewAccountingEntryPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSave(data: Record<string, unknown>) {
    try {
      setError(null);
      
      // Récupération du jeton CSRF
      const csrfRes = await fetch("/api/auth/csrf"); 
      const { csrfToken } = await csrfRes.json();

      // Envoi de la requête au backend
      const res = await fetch("/api/accounting-entries", { 
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
        // Affiche l'erreur spécifique retournée par Mongoose (ex: accountCode is required)
        throw new Error(d.error || "Erreur lors de l'enregistrement");
      }

      router.push("/accounting");
      router.refresh();
    } catch (err: any) {
      console.error("Erreur de sauvegarde:", err);
      setError(err.message);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <a href="/accounting" className="text-xs text-moss hover:text-ink">← Comptabilité</a>
        <h1 className="text-2xl font-bold text-ink mt-1">Saisie manuelle</h1>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
          <strong>Erreur de validation :</strong> {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-clay/20 p-6">
        <AccountingEntryForm 
          onSave={handleSave} 
          onCancel={() => router.push("/accounting")} 
        />
      </div>
    </div>
  );
}