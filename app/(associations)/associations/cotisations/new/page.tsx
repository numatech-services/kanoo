"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CotisationForm } from "@/components/associations/CotisationForm";

export default function NewCotisationPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSave(data: Record<string, unknown>) {
    try {
      setError("");
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      
      const res = await fetch("/api/cotisations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      const d = await res.json();
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
            <a href="/associations/cotisations" className="text-xs text-moss hover:text-ink">← Cotisations</a>
            <h1 className="text-2xl font-bold text-ink mt-1">Enregistrer un paiement</h1>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="bg-white rounded-2xl border border-clay/20 p-6">
            <CotisationForm onSave={handleSave} onCancel={() => router.push("/associations/cotisations")} />
          </div>
        </div>
      )}
    </>
  );
}
