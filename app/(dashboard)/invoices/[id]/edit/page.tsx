"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { InvoiceForm, type InvoiceFormData } from "@/components/pme/InvoiceForm";
import { showToast } from "@/components/ui/Toast";

import { apiJson, apiSend } from "@/lib/api-client";
export default function EditInvoicePage() {
  const { id } = useParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoiceData, setInvoiceData] = useState<Partial<InvoiceFormData> | null>(null);

  const loadInvoice = useCallback(async () => {
    try {
      const d = await apiJson(`/api/invoices/${id}`);
      const invoice = d.data || d;
      
      if (invoice) {
        if (["paid", "cancelled"].includes(invoice.status)) {
          showToast("Une facture soldée ou annulée ne peut plus être modifiée.", "warning");
          router.push(`/invoices/${id}`);
          return;
        }

        setInvoiceData({
          clientId: invoice.clientId?._id || invoice.clientId,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          lines: invoice.lines || [],
          notes: invoice.notes || "",
        });
      }
    } catch (err) {
      console.error("Erreur de chargement de la facture :", err);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    setMounted(true);
    loadInvoice();
  }, [loadInvoice]);

  if (!mounted) return null;
  
  if (loading) {
    return (
      <div className="p-6">
        <div className="h-64 bg-surface rounded-xl animate-pulse border border-line" />
      </div>
    );
  }

  async function handleUpdate(updatedData: InvoiceFormData) {

    const res = await apiSend("PATCH", `/api/invoices/${id}`, updatedData);

    // Gestion sécurisée si le serveur renvoie une réponse vide (ex: status 204)
    if (!res.ok) {
      let errorMessage = "Impossible de mettre à jour la facture";
      try {
        const errorData = res.data;
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Le JSON était vide ou invalide mais le statut est en erreur
      }
      throw new Error(errorMessage);
    }
    
    // Si res.ok est vrai, on redirige directement sans parser le JSON potentiellement vide
    router.push(`/invoices/${id}`);
    router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <button onClick={() => router.push(`/invoices/${id}`)} className="text-xs text-ink2 hover:text-ink">
          Retour au détail
        </button>
        <h1 className="page-title mt-1">Modifier la facture</h1>
      </div>

      <div className="bg-surface rounded-2xl border border-line p-6">
        <InvoiceForm 
          initial={invoiceData ?? undefined} 
          onSave={handleUpdate} 
          onCancel={() => router.push(`/invoices/${id}`)} 
        />
      </div>
    </div>
  );
}