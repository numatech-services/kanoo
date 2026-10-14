"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AssembleeForm } from "@/components/associations/AssembleeForm";

import { csrfToken as getCsrfToken } from "@/lib/api-client";
export default function NewAssembleePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSave(data: Record<string, unknown>) {
    try {
      setError("");
      const csrfToken = await getCsrfToken();
      
      const res = await fetch("/api/assemblee", {
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
      
      router.push("/associations/assemblee");
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
            <a href="/associations/assemblee" className="text-xs text-ink2 hover:text-ink">← Assemblées</a>
            <h1 className="page-title mt-1">Convoquer une AG</h1>
          </div>
          {error && (
            <div className="bg-neg-50 border border-neg/25 rounded-lg p-4 text-sm text-neg">
              {error}
            </div>
          )}
          <div className="bg-surface rounded-2xl border border-line p-6">
            <AssembleeForm onSave={handleSave} onCancel={() => router.push("/associations/assemblee")} />
          </div>
        </div>
      )}
    </>
  );
}
