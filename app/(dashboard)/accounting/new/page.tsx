"use client";

import { useRouter } from "next/navigation";
import { AccountingEntryForm } from "@/components/pme/AccountingEntryForm";
import { useState } from "react";
import { errorMessage } from "@/lib/errors";

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
    } catch (err) {
      console.error("Erreur de sauvegarde:", err);
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <a href="/accounting" className="text-xs text-ink2 hover:text-ink">← Comptabilité</a>
        <h1 className="text-2xl font-bold text-ink mt-1">Saisie manuelle</h1>
      </div>

      {error && (
        <div className="p-4 bg-neg-50 border border-neg/25 text-neg rounded-xl text-sm">
          <strong>Erreur de validation :</strong> {error}
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-line p-6">
        <AccountingEntryForm 
          onSave={handleSave} 
          onCancel={() => router.push("/accounting")} 
        />
      </div>
    </div>
  );
}