"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { InvoiceForm, type InvoiceFormData } from "@/components/pme/InvoiceForm";
import { showToast } from "@/components/ui/Toast";

import { apiJson, apiSend } from "@/lib/api-client";
import { PageLoading } from "@/components/ui/PageState";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { promptDialog } from "@/components/ui/Dialogs";
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
export default function EditInvoicePage() {
  const { id } = useParams();
  const router = useRouter();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [loading, setLoading] = useState(true);
  const [invoiceData, setInvoiceData] = useState<Partial<InvoiceFormData> | null>(null);
  // Facture émise : son contenu ne change que par la correction contrôlée de l'administrateur.
  const [issued, setIssued] = useState<{ number: string; admin: boolean } | null>(null);

  // Pré-remplissage du formulaire : les états ne changent qu'à l'arrivée de la réponse.
  useEffect(() => {
    Promise.all([apiJson(`/api/invoices/${id}`), apiJson("/api/auth/me").catch(() => null)])
      .then(([d, me]) => {
        const invoice = d.data || d;
        if (!invoice) return;
        if (["paid", "cancelled"].includes(invoice.status)) {
          showToast("Une facture soldée ou annulée ne peut plus être modifiée.", "warning");
          router.push(`/invoices/${id}`);
          return;
        }

        if (invoice.status !== "draft") setIssued({ number: invoice.number, admin: hasTenantAdminRole(me?.data?.user ?? {}) });
        setInvoiceData({
          clientId: invoice.clientId?._id || invoice.clientId,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          lines: invoice.lines || [],
          notes: invoice.notes || "",
          termsAndConditions: invoice.termsAndConditions || "",
          object: invoice.object || "", reference: invoice.reference || "", period: invoice.period || "", attention: invoice.attention || "",
        });
      })
      .catch(err => console.error("Erreur de chargement de la facture :", err))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (!mounted) return <PageLoading />;
  
  if (loading) {
    return (
      <div className="p-6">
        <div className="h-64 bg-surface rounded-xl animate-pulse border border-line" />
      </div>
    );
  }

  async function handleUpdate(updatedData: InvoiceFormData) {

    let res = await apiSend("PATCH", `/api/invoices/${id}`, updatedData);
    // Correction d'une facture émise : le serveur exige un motif ; on le demande puis on renvoie.
    if (!res.ok && /motif de la correction/.test(res.data?.error ?? "")) {
      const reason = await promptDialog({
        title: `Corriger la facture ${issued?.number ?? ""} ?`,
        message: "Elle garde son numéro et portera « rectifiée le … ». Si le client l'a déjà reçue, prévenez-le et envoyez-lui la nouvelle version.",
        label: "Motif de la correction",
        confirmLabel: "Corriger la facture",
        required: true,
        multiline: true,
      });
      if (!reason?.trim()) throw new Error("Correction abandonnée : aucun motif saisi.");
      res = await apiSend("PATCH", `/api/invoices/${id}`, { ...updatedData, correctionReason: reason.trim() });
    }
    // Facture émise dont seul le projet ou le secteur change : motif demandé, gardé au journal d'audit.
    if (!res.ok && /motif de la correction d'imputation/.test(res.data?.error ?? "")) {
      const reason = await promptDialog({
        title: issued?.number ? `Corriger l'imputation de la facture ${issued.number} ?` : "Corriger l'imputation de la facture ?",
        message: "Le projet ou le secteur change sur la facture et sur son écriture de vente ; les montants restent tels quels.",
        label: "Motif de la correction (5 caractères au moins)",
        confirmLabel: "Corriger l'imputation",
        required: true,
        multiline: true,
      });
      if (!reason?.trim()) throw new Error("Correction abandonnée : aucun motif saisi.");
      if (reason.trim().length < 5) throw new Error("Motif trop court : 5 caractères au moins.");
      res = await apiSend("PATCH", `/api/invoices/${id}`, { ...updatedData, imputationReason: reason.trim() });
    }

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
        <h1 className="page-title mt-1">{issued ? `Corriger la facture ${issued.number}` : "Modifier la facture"}</h1>
      </div>

      {issued && (
        <div className={`px-4 py-3 rounded-xl text-sm border ${issued.admin ? "bg-info-50 border-info/25 text-ink" : "bg-warn-50 border-warn/25 text-warn"}`}>
          {issued.admin ? (
            <>Facture déjà émise : l&apos;échéance, les mentions, les conditions et les notes se modifient librement.
              Changer la date ou les lignes la <strong>corrige</strong> : même numéro, mention « rectifiée » sur le PDF, motif et avant/après gardés.
              Impossible si elle est payée, livrée, certifiée SECeF ou déclarée en TVA, ou pour changer de client : émettez alors un avoir.
              Seules les déclarations de TVA saisies dans Kanoo sont connues : vérifiez celles déposées ailleurs.</>
          ) : (
            <>Facture déjà émise : vous pouvez modifier l&apos;échéance, les mentions, les conditions et les notes.
              Seul l&apos;administrateur de l&apos;organisation peut corriger la date ou les lignes ; sinon, émettez un avoir.</>
          )}
        </div>
      )}

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