"use client";

import { useRouter } from "next/navigation";
import { MarcheForm } from "@/components/pme/MarcheForm";
import { toast } from "react-hot-toast"; // Si tu l'as, sinon utilise alert

export default function NewMarchePublicPage() {
  const router = useRouter();

  async function handleSave(data: Record<string, unknown>) {
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

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
      if (!res.ok) throw new Error(d.error || "Erreur lors de la création");

      router.push("/administration/marches-publics");
      router.refresh(); // Important pour voir le nouveau marché dans la liste
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div>
        <a href="/administration/marches-publics" className="text-xs text-moss hover:text-ink">
          ← Retour aux marchés publics
        </a>
        <h1 className="text-2xl font-bold text-ink mt-1">Nouveau marché public</h1>
      </div>
      
      <div className="bg-white rounded-2xl border border-clay/20 p-6">
        <MarcheForm 
          onSave={handleSave} 
          onCancel={() => router.push("/administration/marches-publics")} 
        />
      </div>
    </div>
  );
}