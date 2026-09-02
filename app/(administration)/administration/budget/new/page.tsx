"use client";
import { useRouter } from "next/navigation";
import { BudgetChapterForm } from "@/components/administration/BudgetChapterForm";
export default function NewBudgetChapterPage() {
  const router = useRouter();
  async function handleSave(data: Record<string, unknown>) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/budget", { method:"POST", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body:JSON.stringify(data) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error);
    router.push("/administration/budget");
  }
  return (
    <div className="max-w-lg space-y-5">
      <div><a href="/administration/budget" className="text-xs text-moss hover:text-ink">← Budget</a><h1 className="text-2xl font-bold text-ink mt-1">Nouveau chapitre budgétaire</h1></div>
      <div className="bg-white rounded-2xl border border-clay/20 p-6"><BudgetChapterForm onSave={handleSave} onCancel={()=>router.push("/administration/budget")} /></div>
    </div>
  );
}
