"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { useMe, meCanDo } from "@/lib/useMe";
import { ToMarketDialog } from "@/components/devis/ToMarketDialog";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";

// Ligne de devis : champs saisis, totaux recalculés par calcLine
interface DevisLine {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  tvaRate?: number;
  totalHT?: number;
  totalTVA?: number;
  totalTTC?: number;
  [key: string]: unknown;
}

// Devis tel que renvoyé par /api/devis/[id] (client peuplé)
interface DevisDetail {
  _id: string;
  number: string;
  status: string;
  contractId?: string;
  convertedToInvoiceId?: string;
  clientId?: { name?: string } | null;
  totalHT: number;
  totalTVA?: number;
  totalTTC?: number;
  issueDate?: string;
  validUntil?: string;
  lines?: DevisLine[];
}

function calcLine(l: DevisLine) {
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
  const me = useMe();
  const canDeleteDevis = meCanDo(me, "devis", "delete");
  const canEditDevis = meCanDo(me, "devis", "update");
  const canMarket = meCanDo(me, "contracts", "create");
  const [marketOpen, setMarketOpen] = useState(false);
  const [item, setItem] = useState<DevisDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [editLines, setEditLines] = useState<DevisLine[]>([]);

  useEffect(() => {
    setMounted(true);
    apiJson(`/api/devis/${id}`)
      .then(d => {
        setItem(d.data);
        setEditLines(d.data.lines || []);
      });
  }, [id]);

  function updateLine(i: number, field: string, value: string | number) {
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

    const res = await apiSend("PATCH", `/api/devis/${id}`, body);

    if (res.ok) {
      const d = res.data;
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
          <button onClick={() => router.back()} className="text-xs text-ink2 hover:underline italic">← Retour</button>
          <h1 className="page-title mt-1">{item.number}</h1>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex items-center gap-2">
          {item.contractId
            ? <a href={`/contracts/${item.contractId}`} className="px-5 py-2.5 border border-section/30 text-section rounded-2xl font-bold hover:bg-section-soft">Voir le marché</a>
            : canMarket && !["rejected", "expired"].includes(item.status) && <button onClick={() => setMarketOpen(true)} className={buttonClass("primary", "md")}>Créer le marché</button>}
          <a href={`/api/devis/${item._id}/pdf`} target="_blank" rel="noopener"
            className={buttonClass("secondary", "md")}>
            PDF
          </a>
          {canEditDevis && !item.convertedToInvoiceId && (
            <select value={item.status} onChange={async e => {
              const res = await apiSend("PATCH", `/api/devis/${id}`, { status: e.target.value });
              const d = res.data;
              if (res.ok) setItem(d.data); else showToast(d.error || "Changement impossible", "error");
            }} className="h-11 px-3 rounded-2xl border border-line2 text-sm font-semibold" aria-label="Statut du devis">
              <option value="draft">Brouillon</option><option value="sent">Envoyé</option><option value="accepted">Accepté</option>
              <option value="rejected">Refusé</option><option value="expired">Expiré</option>
            </select>
          )}
          {canDeleteDevis && !item.convertedToInvoiceId && (
            <button onClick={async () => {
              if (!(await confirmDialog({ title: "Supprimer ce devis ?", danger: true }))) return;
              const res = await apiSend("DELETE", `/api/devis/${id}`);
              if (res.ok) router.push("/devis"); else { const d = res.data; showToast(d.error || "Suppression impossible", "error"); }
            }} className="px-5 py-2.5 border border-neg/25 text-neg rounded-2xl font-bold hover:bg-neg-50">Supprimer</button>
          )}
          <button onClick={() => setEditOpen(true)} className="px-6 py-2.5 bg-ink text-onink rounded-2xl font-bold shadow-lg hover:scale-105 transition-all">
            Modifier le devis
          </button>
        </div>
      </div>

      {/* MODE VUE : AFFICHAGE DE TOUS LES DÉTAILS */}
      <div className="bg-surface rounded-[2rem] border border-line p-8 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Client</p>
            <p className="text-lg font-bold text-ink italic">{item.clientId?.name || "Client"}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Total Hors Taxe</p>
            <p className="text-lg font-semibold text-ink">{item.totalHT?.toLocaleString("fr-FR")} FCFA</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Total TVA (19%)</p>
            <p className="text-lg font-semibold text-ink2">{item.totalTVA?.toLocaleString("fr-FR")} FCFA</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Total TTC</p>
            <p className="text-2xl font-black text-section">{item.totalTTC?.toLocaleString("fr-FR")} FCFA</p>
          </div>
        </div>
      </div>

      {/* MODALE DE MODIFICATION */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le devis" size="xl">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-ink2 uppercase mb-1">Date d'émission</label>
              <input type="date" name="issueDate" defaultValue={item.issueDate?.slice(0, 10)} className="w-full p-3 border rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-ink2 uppercase mb-1">Validité</label>
              <input type="date" name="validUntil" defaultValue={item.validUntil?.slice(0, 10)} className="w-full p-3 border rounded-xl text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-black text-ink2 uppercase">Articles / Services</p>
            {editLines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 bg-surface2/30 p-2 rounded-xl items-center">
                <input className="col-span-5 p-2 border rounded-lg text-sm" value={line.description} onChange={e => updateLine(i, "description", e.target.value)} placeholder="Description" />
                <input type="number" className="col-span-2 p-2 border rounded-lg text-sm text-center" value={line.quantity} onChange={e => updateLine(i, "quantity", parseFloat(e.target.value))} />
                <input type="number" className="col-span-3 p-2 border rounded-lg text-sm" value={line.unitPrice} onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value))} placeholder="P.U." />
                <div className="col-span-2 text-right font-bold text-xs text-ink">{line.totalTTC?.toLocaleString("fr-FR")}</div>
              </div>
            ))}
            <button type="button" onClick={() => setEditLines([...editLines, calcLine({ quantity: 1, unitPrice: 0 })])} className="text-xs text-ink font-bold hover:underline">+ Ajouter une ligne</button>
          </div>

          {/* RÉSUMÉ DES CALCULS DANS LA MODALE */}
          <div className="border-t border-line pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ink2">Sous-total HT</span>
              <span className="font-semibold">{totalHT.toLocaleString("fr-FR")} FCFA</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink2">TVA (19%)</span>
              <span className="font-semibold">{totalTVA.toLocaleString("fr-FR")} FCFA</span>
            </div>
            <div className="bg-ink text-onink p-4 rounded-2xl flex justify-between items-center mt-2">
              <span className="text-xs font-bold uppercase tracking-wider">Nouveau Total TTC</span>
              <span className="text-2xl font-black">{totalTTC.toLocaleString("fr-FR")} FCFA</span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditOpen(false)} className="px-6 py-2 text-sm font-bold text-ink2">Annuler</button>
            <button type="submit" className={buttonClass("primary", "md")}>
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
      {marketOpen && <ToMarketDialog devis={item} onClose={() => setMarketOpen(false)} />}
    </div>
  );
}