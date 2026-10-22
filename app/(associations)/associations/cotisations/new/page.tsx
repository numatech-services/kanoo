"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CotisationForm } from "@/components/associations/CotisationForm";

import { apiSend } from "@/lib/api-client";
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};

export default function NewCotisationPage() {
  const router = useRouter();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [error, setError] = useState("");

  async function handleSave(data: Record<string, unknown>) {
    try {
      setError("");
      
      const res = await apiSend("POST", "/api/cotisations", data);
      
      const d = res.data;
      if (!res.ok) {
        setError(d.error || "Une erreur est survenue");
        return;
      }
      
      router.push("/associations/cotisations");
      router.refresh();
    } catch (err) {
      console.error("Error:", err);
      setError("Une erreur inattendue s'est produite");
    }
  }

  return (
    <>
      {!mounted ? null : (
        <div className="max-w-lg space-y-5">
          <div>
            <a href="/associations/cotisations" className="text-xs text-ink2 hover:text-ink">← Cotisations</a>
            <h1 className="page-title mt-1">Enregistrer un paiement</h1>
          </div>
          {error && (
            <div className="bg-neg-50 border border-neg/25 rounded-lg p-4 text-sm text-neg">
              {error}
            </div>
          )}
          <div className="bg-surface rounded-2xl border border-line p-6">
            <CotisationForm onSave={handleSave} onCancel={() => router.push("/associations/cotisations")} />
          </div>
        </div>
      )}
    </>
  );
}
