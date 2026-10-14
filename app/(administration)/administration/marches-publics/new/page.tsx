"use client";

import { useRouter } from "next/navigation";
import { MarcheForm } from "@/components/pme/MarcheForm";
import { errorMessage } from "@/lib/errors";

import { showToast } from "@/components/ui/Toast";
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
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  }

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <div>
        <a href="/administration/marches-publics" className="text-xs text-ink2 hover:text-ink">
          ← Retour aux marchés publics
        </a>
        <h1 className="page-title mt-1">Nouveau marché public</h1>
      </div>
      
      <div className="bg-surface rounded-2xl border border-line p-6">
        <MarcheForm 
          onSave={handleSave} 
          onCancel={() => router.push("/administration/marches-publics")} 
        />
      </div>
    </div>
  );
}