"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PenLine, ReceiptText } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";

async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

export default function ContractDetailPage() {
  const params = useParams();
  const id = params?.id as string; // Récupération synchrone correcte pour 14.1

  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/contracts/${id}`, { credentials: "include" });
      const d = await res.json();
      setContract(res.ok && (d.data || d._id) ? (d.data || d) : null);
    } catch { setContract(null); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  async function action(path: string, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${id}/${path}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      alert(okMsg); load();
    } catch (e) { alert(e instanceof Error ? e.message : "Action impossible"); } finally { setBusy(false); }
  }

  if (!mounted) return null;
  if (loading) return <div className="p-6">Chargement...</div>;
  
  // Correction de l'affichage "Contrat introuvable"
  if (!contract) {
    return (
      <div className="p-6">
        <p className="text-ink2">Contrat introuvable ou erreur de chargement.</p>
        <Link href="/contracts" className="text-section underline mt-2 block">Retour à la liste</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">{contract.title}</h1>
          <p className="font-mono text-sm text-ink2">{contract.reference}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={contract.status} />
          {contract.status === "draft" && (
            <button onClick={() => action("sign", "Contrat signé.")} disabled={busy}
              className="px-4 h-9 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60 inline-flex items-center gap-1.5">
              <PenLine size={15} /> Signer le contrat
            </button>
          )}
          {["active", "signed", "renewed"].includes(contract.status) && (
            <button onClick={() => action("generate-invoice", "Facture générée à partir du contrat.")} disabled={busy}
              className="px-4 h-9 rounded-lg border border-line2 text-ink text-sm font-semibold hover:bg-surface2 disabled:opacity-60 inline-flex items-center gap-1.5">
              <ReceiptText size={15} /> Générer une facture
            </button>
          )}
        </div>
      </div>

      {Array.isArray(contract.invoiceIds) && contract.invoiceIds.length > 0 && (
        <p className="text-sm text-ink2">
          {contract.invoiceIds.length} facture{contract.invoiceIds.length > 1 ? "s" : ""} liée{contract.invoiceIds.length > 1 ? "s" : ""} —{" "}
          <Link href="/invoices" className="text-section hover:underline">voir les factures</Link>
        </p>
      )}
      
      <div className="bg-surface rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Informations Générales</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-ink2">Montant:</div>
          <div className="font-medium">{contract.amount?.toLocaleString()} XOF</div>
          <div className="text-ink2">Client:</div>
          <div className="font-medium">{contract.clientId?.name || "N/A"}</div>
        </div>
      </div>

      {/* Le contrat signé, ses avenants, les courriers échangés. Un contrat
          dont le PDF vit dans une boîte mail n'est pas opposable le jour où
          l'on en a besoin. */}
      <AttachmentPanel
        host="contracts"
        hostId={String(id)}
        title="Documents du contrat"
        hint="Contrat signé, avenants, courriers. PDF, Word, Excel ou image."
        categories={["contrat", "avenant", "courrier", "autre"]}
        defaultCategory="contrat"
      />
    </div>
  );
}