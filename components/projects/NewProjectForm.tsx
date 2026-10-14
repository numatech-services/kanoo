"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProjectForm } from "@/components/pme/ProjectForm";
import type { ProjectVocabulary } from "@/lib/vocabulary";

import { apiSend } from "@/lib/api-client";
/**
 * Création d'un projet — écran unique pour les trois profils.
 *
 * Le `projectType` vient du vocabulaire du tenant au lieu d'être écrit en dur
 * dans trois formulaires distincts. C'était la seule différence entre eux.
 */
export function NewProjectForm({ vocabulary }: { vocabulary: ProjectVocabulary }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function handleSave(data: Record<string, unknown>) {
    setError("");
    try {

      const res = await apiSend("POST", "/api/projects", { ...data, projectType: vocabulary.projectType });

      const d = res.data;
      if (!res.ok) {
        setError(d.error || "Enregistrement refusé");
        return;
      }
      router.push(`/projects/${d.data._id}`);
      router.refresh();
    } catch {
      // L'erreur était seulement journalisée : l'utilisateur restait devant un
      // formulaire qui semblait n'avoir rien fait.
      setError("Enregistrement impossible. Vérifiez votre connexion et réessayez.");
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href="/projects" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
          <ArrowLeft size={13} /> {vocabulary.plural}
        </Link>
        <h1 className="page-title mt-1">{vocabulary.createLabel}</h1>
      </div>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>
      )}

      <div className="surface-card p-6">
        <ProjectForm
          defaultType={vocabulary.projectType}
          onSave={handleSave}
          onCancel={() => router.push("/projects")}
        />
      </div>
    </div>
  );
}
