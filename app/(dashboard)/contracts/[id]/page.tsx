"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function ContractDetailPage() {
  const params = useParams();
  const id = params?.id as string; // Récupération synchrone correcte pour 14.1
  const router = useRouter();
  
  const [mounted, setMounted] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    async function load() {
      if (!id) return;
      try {
        const res = await fetch(`/api/contracts/${id}`, { credentials: "include" });
        const d = await res.json();
        
        // Gestion flexible du format de réponse (d.data ou d)
        if (res.ok && (d.data || d._id)) {
          setContract(d.data || d);
        } else {
          setContract(null);
        }
      } catch (err) {
        console.error("Erreur:", err);
        setContract(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (!mounted) return null;
  if (loading) return <div className="p-6">Chargement...</div>;
  
  // Correction de l'affichage "Contrat introuvable"
  if (!contract) {
    return (
      <div className="p-6">
        <p className="text-moss">Contrat introuvable ou erreur de chargement.</p>
        <Link href="/contracts" className="text-cedar underline mt-2 block">Retour à la liste</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-ink">{contract.title}</h1>
          <p className="font-mono text-sm text-moss">{contract.reference}</p>
        </div>
        <StatusBadge status={contract.status} />
      </div>
      
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Informations Générales</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-moss">Montant:</div>
          <div className="font-medium">{contract.amount?.toLocaleString()} XOF</div>
          <div className="text-moss">Client:</div>
          <div className="font-medium">{contract.clientId?.name || "N/A"}</div>
        </div>
      </div>
    </div>
  );
}