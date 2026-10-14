"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUrlReady } from "@/lib/url-param";
import { InvoiceForm, type InvoiceFormData } from "@/components/pme/InvoiceForm";
export default function NewInvoicePage() {
  const router = useRouter();
  // Client présélectionné depuis sa fiche (« + Facture »).
  const [clientId, setClientId] = useState("");
  const ready = useUrlReady(p => setClientId(p.get("clientId") ?? ""));
  async function handleSave(data: InvoiceFormData) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(data) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    router.push(`/invoices/${d.data._id}`);
  }
  return (
    <div className="max-w-4xl space-y-5">
      <div><a href="/invoices" className="text-xs text-ink2 hover:text-ink">← Factures</a><h1 className="page-title mt-1">Nouvelle facture</h1></div>
      <div className="bg-surface rounded-2xl border border-line p-6">{ready && <InvoiceForm initial={clientId ? { clientId } : undefined} onSave={handleSave} onCancel={() => router.push("/invoices")} />}</div>
    </div>
  );
}
