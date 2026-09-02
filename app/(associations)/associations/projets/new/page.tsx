"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProjectForm } from "@/components/pme/ProjectForm";

export default function NewProjetAssoPage() {
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
      
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ ...data, projectType: "ong" }),
      });
      
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Une erreur est survenue");
        return;
      }
      
      router.push(`/associations/projets/${d.data._id}`);
      router.refresh();
    } catch (err) {
      console.error("Error:", err);
      setError("Une erreur inattendue s'est produite");
    }
  }

  return (
    <>
      {!mounted ? null : (
        <div className="space-y-5 max-w-2xl">
          <div>
            <Link href="/associations/projets" className="text-xs text-moss hover:text-ink">
              ← Projets / ONG
            </Link>
            <h1 className="text-2xl font-bold text-ink mt-1">Nouveau projet</h1>
            <p className="text-sm text-moss mt-0.5">
              Créez un projet ONG, bailleurs de fonds ou projet associatif.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-clay/20 p-6">
            <ProjectForm
              onSave={handleSave}
              onCancel={() => router.push("/associations/projets")}
              defaultType="ong"
            />
          </div>
        </div>
      )}
    </>
  );
}
