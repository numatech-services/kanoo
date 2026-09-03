"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CommandeForm } from "@/components/pme/CommandeForm";
import Link from "next/link";
import { Printer, Edit3, ArrowLeft } from "lucide-react";

export default function CommandeDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const r = await fetch(`/api/commandes/${id}`, { credentials: "include" });
      const d = await r.json();
      setItem(d.data);
    } catch (err) {
      console.error("❌ [Détail BC] Erreur lors du fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleUpdate(body: Record<string, unknown>) {
    console.log("📤 [Détail BC] Tentative de mise à jour avec:", body);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`/api/commandes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken
        },
        credentials: "include",
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const d = await res.json();
        console.log("✅ [Détail BC] Mise à jour réussie");
        setItem(d.data);
        setEditOpen(false);
      } else {
        const d = await res.json();
        console.error("❌ [Détail BC] Échec de la mise à jour:", d.error);
        alert("Erreur: " + d.error);
      }
    } catch (err) {
      console.error("🔥 [Détail BC] Erreur critique handleUpdate:", err);
      alert("Erreur lors de la mise à jour");
    }
  }

  const handlePrint = () => {
    // L'indicateur `isPrinting` n'était affiché nulle part : le délai suffit à
    // laisser l'interface se stabiliser avant l'impression.
    setTimeout(() => window.print(), 100);
  };

  // Log à chaque changement d'état de la modal
  useEffect(() => {
    console.log("🔄 [Détail BC] État de editOpen:", editOpen);
  }, [editOpen]);

  if (loading) return <div className="p-6 text-ink2 italic">Chargement du bon de commande...</div>;
  if (!item) return <div className="p-6 text-neg">Commande introuvable.</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <Link href="/commandes" className="text-xs text-ink2 hover:text-ink flex items-center gap-1">
            <ArrowLeft size={12} /> Retour aux bons de commande
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-ink uppercase">BC {item.number}</h1>
            <StatusBadge status={item.status} />
          </div>
        </div>
        
        <div className="flex gap-2">
          <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-surface border border-line rounded-xl text-sm font-medium hover:bg-surface2 transition-colors">
            <Printer size={16} /> Imprimer
          </button>
          
          <button 
            onClick={() => {
              console.log("Click sur MODIFIER détecté");
              setEditOpen(true);
            }} 
            className="flex items-center gap-2 px-4 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95 transition-colors"
          >
            <Edit3 size={16} /> Modifier
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-surface rounded-2xl border border-line p-6 shadow-sm print:border-none">
            <h3 className="text-sm font-bold text-ink2 uppercase mb-4 tracking-wider">Articles</h3>
            <table className="table-dense">
              <thead>
                <tr className="text-left text-ink2 border-b border-line">
                  <th className="pb-3 font-medium">Désignation</th>
                  <th className="pb-3 font-medium text-center">Volume</th>
                  <th className="pb-3 font-medium text-right">P.U HT</th>
                  <th className="pb-3 font-medium text-right">Total HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {item.lines?.map((line: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-3 text-ink font-medium">{line.description}</td>
                    <td className="py-3 text-center text-ink2">{line.quantity}</td>
                    <td className="py-3 text-right font-mono text-xs">{Number(line.unitPrice).toLocaleString()}</td>
                    <td className="py-3 text-right font-mono font-bold text-section">{Number(line.totalHT).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-surface rounded-2xl border border-line p-5 shadow-sm">
            <p className="text-[10px] font-bold text-ink2 uppercase mb-2">Fournisseur</p>
            <p className="text-ink font-bold">{item.supplierId?.name || "—"}</p>
          </div>

          <div className="bg-ink text-white rounded-2xl p-6 shadow-lg print:bg-surface print:text-ink print:border">
            <div className="space-y-3">
              <div className="flex justify-between text-xs opacity-70">
                <span>TOTAL HT</span>
                <span className="font-mono">{item.totalHT?.toLocaleString()} XOF</span>
              </div>
              <div className="flex justify-between text-xs opacity-70">
                <span>TVA (19%)</span>
                <span className="font-mono">{item.totalTVA?.toLocaleString()} XOF</span>
              </div>
              <div className="h-px bg-white/10 my-3" />
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] font-bold">NET À PAYER</span>
                <span className="text-2xl font-mono font-bold">
                  {item.totalTTC?.toLocaleString()} <small className="text-[10px] font-normal">XOF</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TEST DE RENDU DIRECT SI LA MODAL EST CASSÉE */}
      {editOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-line flex justify-between items-center">
              <h2 className="text-xl font-bold text-ink">Modifier le Bon de Commande</h2>
              <button onClick={() => setEditOpen(false)} className="text-ink2 hover:text-ink">✕</button>
            </div>
            
            <div className="p-6">
              {item ? (
                <CommandeForm 
                  initialData={item} 
                  onSave={handleUpdate} 
                  onCancel={() => setEditOpen(false)} 
                />
              ) : (
                <p className="text-neg text-center">Données introuvables</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}