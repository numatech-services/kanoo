"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AssembleeForm } from "@/components/associations/AssembleeForm";

import { apiSend } from "@/lib/api-client";
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
      
      const res = await apiSend("POST", "/api/assemblee", data);
      
      const d = res.data;
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
            <Link href="/associations/assemblee" className="text-xs text-ink2 hover:text-ink">← Assemblées</Link>
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
