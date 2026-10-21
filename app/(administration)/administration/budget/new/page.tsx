"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BudgetChapterForm } from "@/components/administration/BudgetChapterForm";
import { apiSend } from "@/lib/api-client";
export default function NewBudgetChapterPage() {
  const router = useRouter();
  async function handleSave(data: Record<string, unknown>) {
    const res = await apiSend("POST", "/api/budget", data);
    const d = res.data; if (!res.ok) throw new Error(d.error);
    router.push("/administration/budget");
  }
  return (
    <div className="max-w-lg space-y-5">
      <div><Link href="/administration/budget" className="text-xs text-ink2 hover:text-ink">← Budget</Link><h1 className="page-title mt-1">Nouveau chapitre budgétaire</h1></div>
      <div className="bg-surface rounded-2xl border border-line p-6"><BudgetChapterForm onSave={handleSave} onCancel={()=>router.push("/administration/budget")} /></div>
    </div>
  );
}
