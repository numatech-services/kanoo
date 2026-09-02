"use client";
import { useRouter } from "next/navigation";
import { ProjectForm } from "@/components/pme/ProjectForm";
export default function NewProjectPage() {
  const router = useRouter();
  async function handleSave(data: Record<string, unknown>) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(data) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error);
    router.push(`/projects/${d.data._id}`);
  }
  return (
    <div className="max-w-2xl space-y-5">
      <div><a href="/projects" className="text-xs text-moss hover:text-ink">← Projets</a><h1 className="text-2xl font-bold text-ink mt-1">Nouveau projet</h1></div>
      <div className="bg-white rounded-2xl border border-clay/20 p-6"><ProjectForm onSave={handleSave} onCancel={() => router.push("/projects")} /></div>
    </div>
  );
}
