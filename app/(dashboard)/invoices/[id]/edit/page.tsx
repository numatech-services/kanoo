"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { InvoiceForm } from "@/components/pme/InvoiceForm";

export default function EditInvoicePage() {
  const { id } = useParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoiceData, setInvoiceData] = useState<any>(null);

  const loadInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`, { credentials: "include" });
      const d = await res.json();
      const invoice = d.data || d;
      
      if (invoice) {
        if (["paid", "cancelled"].includes(invoice.status)) {
          alert("Une facture soldée ou annulée ne peut plus être modifiée.");
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
        <div className="h-64 bg-white rounded-xl animate-pulse border border-clay/20" />
      </div>
    );
  }

  async function handleUpdate(updatedData: any) {
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();

    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      credentials: "include",
      body: JSON.stringify(updatedData),
    });

    // Gestion sécurisée si le serveur renvoie une réponse vide (ex: status 204)
    if (!res.ok) {
      let errorMessage = "Impossible de mettre à jour la facture";
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
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
        <button onClick={() => router.push(`/invoices/${id}`)} className="text-xs text-moss hover:text-ink">
          Retour au détail
        </button>
        <h1 className="text-2xl font-bold text-ink mt-1">Modifier la facture</h1>
      </div>

      <div className="bg-white rounded-2xl border border-clay/20 p-6">
        <InvoiceForm 
          initial={invoiceData} 
          onSave={handleUpdate} 
          onCancel={() => router.push(`/invoices/${id}`)} 
        />
      </div>
    </div>
  );
}