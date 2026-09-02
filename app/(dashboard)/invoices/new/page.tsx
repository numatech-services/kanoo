"use client";
import { useRouter } from "next/navigation";
import { InvoiceForm } from "@/components/pme/InvoiceForm";
export default function NewInvoicePage() {
  const router = useRouter();
  async function handleSave(data: Record<string, unknown>) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(data) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    router.push(`/invoices/${d.data._id}`);
  }
  return (
    <div className="max-w-4xl space-y-5">
      <div><a href="/invoices" className="text-xs text-moss hover:text-ink">← Factures</a><h1 className="text-2xl font-bold text-ink mt-1">Nouvelle facture</h1></div>
      <div className="bg-white rounded-2xl border border-clay/20 p-6"><InvoiceForm onSave={handleSave} onCancel={() => router.push("/invoices")} /></div>
    </div>
  );
}
