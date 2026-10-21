"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DevisForm } from "@/components/pme/DevisForm";
import { apiSend } from "@/lib/api-client";
export default function NewDevisPage() {
  const router = useRouter();
  async function handleSave(data: Record<string, unknown>) {
    const res = await apiSend("POST", "/api/devis", data);
    const d = res.data; if (!res.ok) throw new Error(d.error);
    router.push(`/devis/${d.data._id}`);
  }
  return (
    <div className="max-w-4xl space-y-5">
      <div><Link href="/devis" className="text-xs text-ink2 hover:text-ink">← Devis</Link><h1 className="page-title mt-1">Nouveau devis</h1></div>
      <div className="bg-surface rounded-2xl border border-line p-6"><DevisForm onSave={handleSave} onCancel={() => router.push("/devis")} /></div>
    </div>
  );
}
