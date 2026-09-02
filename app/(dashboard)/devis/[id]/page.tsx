"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

function calcLine(l: any) {
  const qty = l.quantity || 0; 
  const price = l.unitPrice || 0; 
  const disc = l.discount || 0; 
  const tva = l.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price * (1 - disc / 100)); 
  const tvaAmt = calculerTVA(ht, tva);
  return { 
    ...l,
    description: l.description || "", 
    quantity: qty, 
    unitPrice: price, 
    tvaRate: tva, 
    discount: disc, 
    totalHT: ht, 
    totalTVA: tvaAmt, 
    totalTTC: ht + tvaAmt 
  };
}

export default function DevisDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [item, setItem] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [editLines, setEditLines] = useState<any[]>([]);

  useEffect(() => {
    setMounted(true);
    fetch(`/api/devis/${id}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setItem(d.data);
        setEditLines(d.data.lines || []);
      });
  }, [id]);

  function updateLine(i: number, field: string, value: any) {
    setEditLines(prev => prev.map((l, idx) => idx === i ? calcLine({ ...l, [field]: value }) : l));
  }

  const totalHT = editLines.reduce((s, l) => s + (l.totalHT || 0), 0);
  const totalTVA = editLines.reduce((s, l) => s + (l.totalTVA || 0), 0);
  const totalTTC = totalHT + totalTVA;

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body = {
      issueDate: formData.get("issueDate"),
      validUntil: formData.get("validUntil"),
      notes: formData.get("notes"),
      lines: editLines,
      totalHT,
      totalTVA,
      totalTTC
    };

    const res = await fetch(`/api/devis/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const d = await res.json();
      setItem(d.data);
      setEditOpen(false);
      router.refresh();
    }
  }

  if (!mounted || !item) return null;

  return (
    <div className="space-y-6 max-w-5xl p-4">
      {/* SECTION EN-TÊTE */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => router.back()} className="text-xs text-moss hover:underline italic">← Retour</button>
          <h1 className="text-3xl font-black text-ink mt-1 uppercase tracking-tighter italic">{item.number}</h1>
          <StatusBadge status={item.status} />
        </div>
        <button onClick={() => setEditOpen(true)} className="px-6 py-2.5 bg-ink text-white rounded-2xl font-bold shadow-lg hover:scale-105 transition-all">
          Modifier le devis
        </button>
      </div>

      {/* MODE VUE : AFFICHAGE DE TOUS LES DÉTAILS */}
      <div className="bg-white rounded-[2rem] border border-clay/10 p-8 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <p className="text-[10px] font-black text-moss uppercase tracking-widest mb-1">Client</p>
            <p className="text-lg font-bold text-ink italic">{item.clientId?.name || "Client"}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-moss uppercase tracking-widest mb-1">Total Hors Taxe</p>
            <p className="text-lg font-semibold text-ink">{item.totalHT?.toLocaleString()} F CFA</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-moss uppercase tracking-widest mb-1">Total TVA (19%)</p>
            <p className="text-lg font-semibold text-moss">{item.totalTVA?.toLocaleString()} F CFA</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-moss uppercase tracking-widest mb-1">Total TTC</p>
            <p className="text-2xl font-black text-cedar">{item.totalTTC?.toLocaleString()} F CFA</p>
          </div>
        </div>
      </div>

      {/* MODALE DE MODIFICATION */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le devis" size="xl">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-moss uppercase mb-1">Date d'émission</label>
              <input type="date" name="issueDate" defaultValue={item.issueDate?.slice(0, 10)} className="w-full p-3 border rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-moss uppercase mb-1">Validité</label>
              <input type="date" name="validUntil" defaultValue={item.validUntil?.slice(0, 10)} className="w-full p-3 border rounded-xl text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-black text-moss uppercase">Articles / Services</p>
            {editLines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 bg-sand/30 p-2 rounded-xl items-center">
                <input className="col-span-5 p-2 border rounded-lg text-sm" value={line.description} onChange={e => updateLine(i, "description", e.target.value)} placeholder="Description" />
                <input type="number" className="col-span-2 p-2 border rounded-lg text-sm text-center" value={line.quantity} onChange={e => updateLine(i, "quantity", parseFloat(e.target.value))} />
                <input type="number" className="col-span-3 p-2 border rounded-lg text-sm" value={line.unitPrice} onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value))} placeholder="P.U." />
                <div className="col-span-2 text-right font-bold text-xs text-ink">{line.totalTTC?.toLocaleString()}</div>
              </div>
            ))}
            <button type="button" onClick={() => setEditLines([...editLines, calcLine({ quantity: 1, unitPrice: 0 })])} className="text-xs text-ink font-bold hover:underline">+ Ajouter une ligne</button>
          </div>

          {/* RÉSUMÉ DES CALCULS DANS LA MODALE */}
          <div className="border-t border-clay/10 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-moss">Sous-total HT</span>
              <span className="font-semibold">{totalHT.toLocaleString()} F CFA</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-moss">TVA (19%)</span>
              <span className="font-semibold">{totalTVA.toLocaleString()} F CFA</span>
            </div>
            <div className="bg-ink text-white p-4 rounded-2xl flex justify-between items-center mt-2">
              <span className="text-xs font-bold uppercase tracking-wider">Nouveau Total TTC</span>
              <span className="text-2xl font-black">{totalTTC.toLocaleString()} F CFA</span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditOpen(false)} className="px-6 py-2 text-sm font-bold text-moss">Annuler</button>
            <button type="submit" className="px-10 py-2 bg-cedar text-white rounded-xl font-black shadow-xl hover:bg-ink transition-colors">
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}