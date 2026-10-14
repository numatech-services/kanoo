"use client";

import { isicBatchFinance } from "@/lib/isic-finance";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, Plus, GraduationCap, BookUser } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { useMe, meCan } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import {apiJson, apiSend } from "@/lib/api-client";
export interface Batch {
  _id: string; reference: string; universityName: string; academicYear?: string;
  status: string; totalCards: number; unitLicenseFee: number; unitSalePrice: number;
  unitPrintCost?: number; unitLanyardCost?: number; costs?: { category: string; amount: number }[]; licensePayments?: { amount: number }[];
  deliveries: { quantity: number }[]; payments: { amount: number }[];
}

export const ISIC_STATUS: Record<string, { label: string; cls: string }> = {
  received: { label: "Reçu", cls: "bg-surface2 text-ink2 border-line" },
  processing: { label: "Traitement", cls: "bg-info-50 text-info border-info/25" },
  submitted: { label: "Envoyé à ISIC", cls: "bg-section-soft text-section border-section/25" },
  numbered: { label: "Numéros reçus", cls: "bg-section-soft text-section border-section/25" },
  printing: { label: "Impression", cls: "bg-warn-50 text-warn border-warn/25" },
  printed: { label: "Imprimées", cls: "bg-warn-50 text-warn border-warn/25" },
  delivering: { label: "Livraison en cours", cls: "bg-info-50 text-info border-info/25" },
  completed: { label: "Terminé", cls: "bg-pos-50 text-pos border-pos/25" },
  cancelled: { label: "Annulé", cls: "bg-neg-50 text-neg border-neg/25" },
};

export const fmt = (n?: number) => formatMoney(n ?? 0);
export const delivered = (b: { deliveries: { quantity: number }[] }) => b.deliveries.reduce((s, d) => s + d.quantity, 0);


export default function IsicListPage() {
  const router = useRouter();
  const { resources } = useMe();
  const canFinance = meCan(resources, "isicFinance");
  const [items, setItems] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiJson("/api/isic")
      .then(d => setItems(d.data?.items || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Marge à terminaison : revente − licences, impression, tours de cou, frais opérationnels et autres.
  const totalMargin = items.reduce((s, b) => s + isicBatchFinance(b).forecastMargin, 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="page-head">
        <div>
          <h1 className="page-title flex items-center gap-2"><CreditCard size={22} /> Cartes ISIC</h1>
          <p className="text-sm text-ink2">Production, envoi à ISIC, impression et livraison au fur et à mesure aux universités.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/isic/registre" className={buttonClass("secondary", "md")}>
            <BookUser size={16} /> Registre &amp; numéros
          </Link>
          <button onClick={() => setOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
            <Plus size={16} /> Nouveau lot
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${canFinance ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Lots</p><p className="text-2xl font-bold text-ink">{items.length}</p></div>
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Cartes (total)</p><p className="text-2xl font-bold text-ink">{items.reduce((s, b) => s + b.totalCards, 0).toLocaleString("fr-FR")}</p></div>
        {canFinance && <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Marge (tous coûts)</p><p className="text-2xl font-bold text-pos">{fmt(totalMargin)}</p></div>}
      </div>

      {loading ? (
        <div className="h-40 surface-card animate-pulse" />
      ) : items.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <GraduationCap size={26} className="mx-auto text-ink3" />
          <p className="mt-2 text-sm text-ink2">Aucun lot. Créez-en un à la réception des fichiers d'une université.</p>
        </div>
      ) : (
        <div className="surface-card divide-y divide-line overflow-hidden">
          {items.map(b => {
            const s = ISIC_STATUS[b.status] || { label: b.status, cls: "bg-surface2 text-ink2" };
            const d = delivered(b); const pct = b.totalCards ? Math.round((d / b.totalCards) * 100) : 0;
            return (
              <button key={b._id} onClick={() => router.push(`/isic/${b._id}`)} className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface2/40">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{b.universityName}</span>
                    {b.academicYear && <span className="text-xs text-ink3">· {b.academicYear}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                  </span>
                  <span className="text-xs text-ink2 font-mono">{b.reference}</span>
                </span>
                <span className="w-40 shrink-0">
                  <span className="flex justify-between text-[11px] text-ink2 mb-0.5"><span>{d}/{b.totalCards} livrées</span><span>{pct}%</span></span>
                  <span className="block h-1.5 rounded-full bg-surface2 overflow-hidden"><span className="block h-full bg-section" style={{ width: `${pct}%` }} /></span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {open && <NewBatch canFinance={canFinance} onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); router.push(`/isic/${id}`); }} />}
    </div>
  );
}

function NewBatch({ canFinance, onClose, onCreated }: { canFinance: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ universityName: "", academicYear: "", totalCards: 0, unitLicenseFee: 0, unitSalePrice: 0, unitPrintCost: 0, unitLanyardCost: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.universityName.trim()) { setError("Nom de l'université requis."); return; }
    setSaving(true); setError(null);
    try {
      const res = await apiSend("POST", "/api/isic", form);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Échec");
      onCreated(d.data._id);
    } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Nouveau lot ISIC" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Université" required>
          <input className={inputCls} value={form.universityName} onChange={e => setForm(f => ({ ...f, universityName: e.target.value }))} placeholder="Swiss Umef University of Niger" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Année académique"><input className={inputCls} value={form.academicYear} onChange={e => setForm(f => ({ ...f, academicYear: e.target.value }))} placeholder="2025-2026" /></FormField>
          <FormField label="Nombre de cartes"><input type="number" min={0} className={inputCls} value={form.totalCards || ""} onChange={e => setForm(f => ({ ...f, totalCards: Number(e.target.value) }))} /></FormField>
        </div>
        {canFinance && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Coût licence / carte (FCFA)" hint="Ce que vous payez à ISIC."><input type="number" min={0} className={inputCls} value={form.unitLicenseFee || ""} onChange={e => setForm(f => ({ ...f, unitLicenseFee: Number(e.target.value) }))} /></FormField>
            <FormField label="Prix de revente / carte (FCFA)" hint="Facturé à l'université."><input type="number" min={0} className={inputCls} value={form.unitSalePrice || ""} onChange={e => setForm(f => ({ ...f, unitSalePrice: Number(e.target.value) }))} /></FormField>
            <FormField label="Impression / carte (FCFA)" hint="Coût prévu d'impression."><input type="number" min={0} className={inputCls} value={form.unitPrintCost || ""} onChange={e => setForm(f => ({ ...f, unitPrintCost: Number(e.target.value) }))} /></FormField>
            <FormField label="Tour de cou / carte (FCFA)" hint="Coût prévu du tour de cou personnalisé."><input type="number" min={0} className={inputCls} value={form.unitLanyardCost || ""} onChange={e => setForm(f => ({ ...f, unitLanyardCost: Number(e.target.value) }))} /></FormField>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Création…" : "Créer le lot"}</button>
        </div>
      </div>
    </Modal>
  );
}
