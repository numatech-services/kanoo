"use client";
import { useRouter } from "next/navigation";
import { ContractForm, type ContractFormData } from "@/components/pme/ContractForm";
export default function NewContractPage() {
  const router = useRouter();
  async function handleSave(data: ContractFormData) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/contracts", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(data) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error);
    router.push(`/contracts/${d.data._id}`);
  }
  return (
    <div className="max-w-2xl space-y-5">
      <div><a href="/contracts" className="text-xs text-ink2 hover:text-ink">← Contrats</a><h1 className="text-2xl font-bold text-ink mt-1">Nouveau contrat</h1></div>
      <div className="bg-surface rounded-2xl border border-line p-6"><ContractForm onSave={handleSave} onCancel={() => router.push("/contracts")} /></div>
    </div>
  );
}
