"use client";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { MarcheForm } from "@/components/pme/MarcheForm";
import { errorMessage } from "@/lib/errors";

import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
export default function NewMarchePublicPage() {
  const router = useRouter();

  async function handleSave(data: Record<string, unknown>) {
    try {

      const res = await apiSend("POST", "/api/marches", data);

      const d = res.data;
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
        <Link href="/administration/marches-publics" className="text-xs text-ink2 hover:text-ink">
          ← Retour aux marchés publics
        </Link>
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