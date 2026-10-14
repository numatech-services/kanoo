"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProductForm } from "@/components/stock/ProductForm";

export default function NewProductPage() {
  const router = useRouter();
  async function save(body: Record<string, unknown>) {
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const res = await fetch("/api/products", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Création impossible");
    router.push(`/stock/${d.data._id}`);
  }
  return (
    <div className="max-w-3xl space-y-5">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-ink2 hover:text-ink"><ArrowLeft size={16} /> Retour au stock</button>
      <h1 className="page-title">Nouvel article</h1>
      <div className="bg-surface rounded-2xl border border-line p-6">
        <ProductForm creating onSave={save} onCancel={() => router.push("/stock")} />
      </div>
    </div>
  );
}
