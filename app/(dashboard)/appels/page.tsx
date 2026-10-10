"use client";

import { IfCan } from "@/components/shared/IfCan";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Clock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";

export interface Appel {
  _id: string; title: string; organism?: string; reference?: string;
  submissionDeadline?: string; status: string; estimatedAmount: number;
  requiredDocuments?: { label: string; provided: boolean }[];
}

export const APPEL_STATUS: Record<string, { label: string; cls: string }> = {
  identified: { label: "Identifié", cls: "bg-surface2 text-ink2 border-line" },
  preparing: { label: "En préparation", cls: "bg-info-50 text-info border-info/25" },
  submitted: { label: "Déposé", cls: "bg-section-soft text-section border-section/25" },
  won: { label: "Gagné", cls: "bg-pos-50 text-pos border-pos/25" },
  lost: { label: "Perdu", cls: "bg-neg-50 text-neg border-neg/25" },
  cancelled: { label: "Annulé", cls: "bg-surface2 text-ink3 border-line" },
};

/** Jours restants avant la date limite + classe d'urgence. */
export function deadlineInfo(iso?: string): { text: string; cls: string } | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `Dépassé de ${-days} j`, cls: "text-neg" };
  if (days === 0) return { text: "Aujourd'hui", cls: "text-neg font-semibold" };
  if (days <= 3) return { text: `${days} j restants`, cls: "text-warn font-semibold" };
  return { text: `${days} j restants`, cls: "text-ink2" };
}

async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

export default function AppelsListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Appel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/appels", { credentials: "include" }).then(r => r.json())
      .then(d => setItems(d.data?.items || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = items.filter(a => !["won", "lost", "cancelled"].includes(a.status));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Megaphone size={22} /> Appels à candidatures</h1>
          <p className="text-sm text-ink2">Suivez les appels d'offres auxquels vous répondez : pièces à fournir, date limite, étapes.</p>
        </div>
        <IfCan resource="appels">
        <button onClick={() => setOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouvel appel
        </button>
        </IfCan>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">En cours</p><p className="text-2xl font-bold text-ink">{active.length}</p></div>
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Gagnés</p><p className="text-2xl font-bold text-pos">{items.filter(a => a.status === "won").length}</p></div>
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Total</p><p className="text-2xl font-bold text-ink">{items.length}</p></div>
      </div>

      {loading ? (
        <div className="h-40 surface-card animate-pulse" />
      ) : items.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <Megaphone size={26} className="mx-auto text-ink3" />
          <p className="mt-2 text-sm text-ink2">Aucun appel suivi. Créez-en un dès que vous en repérez un.</p>
        </div>
      ) : (
        <div className="surface-card divide-y divide-line overflow-hidden">
          {items.map(a => {
            const s = APPEL_STATUS[a.status] || { label: a.status, cls: "bg-surface2 text-ink2" };
            const dl = deadlineInfo(a.submissionDeadline);
            const req = a.requiredDocuments || []; const done = req.filter(d => d.provided).length;
            return (
              <button key={a._id} onClick={() => router.push(`/appels/${a._id}`)} className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface2/40">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink truncate">{a.title}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                  </span>
                  <span className="text-xs text-ink2">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}{req.length > 0 ? ` · pièces ${done}/${req.length}` : ""}</span>
                </span>
                {dl && <span className={`text-xs shrink-0 inline-flex items-center gap-1 ${dl.cls}`}><Clock size={13} /> {dl.text}</span>}
              </button>
            );
          })}
        </div>
      )}

      {open && <NewAppel onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); router.push(`/appels/${id}`); }} />}
    </div>
  );
}

function NewAppel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", organism: "", reference: "", submissionDeadline: "", estimatedAmount: 0, docs: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.title.trim()) { setError("Intitulé requis."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/appels", {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, credentials: "include",
        body: JSON.stringify({ ...form, requiredDocuments: form.docs.split("\n").map(s => s.trim()).filter(Boolean) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      onCreated(d.data._id);
    } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Nouvel appel à candidatures" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Intitulé de l'appel" required>
          <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Équipement salle informatique — Université X" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Émetteur"><input className={inputCls} value={form.organism} onChange={e => setForm(f => ({ ...f, organism: e.target.value }))} placeholder="Université, ministère…" /></FormField>
          <FormField label="Référence"><input className={inputCls} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date limite de dépôt"><input type="date" className={inputCls} value={form.submissionDeadline} onChange={e => setForm(f => ({ ...f, submissionDeadline: e.target.value }))} /></FormField>
          <FormField label="Montant estimé (XOF)"><input type="number" min={0} className={inputCls} value={form.estimatedAmount || ""} onChange={e => setForm(f => ({ ...f, estimatedAmount: Number(e.target.value) }))} /></FormField>
        </div>
        <FormField label="Pièces exigées" hint="Une par ligne — elles deviendront une check-list.">
          <textarea className={textareaCls} rows={4} value={form.docs} onChange={e => setForm(f => ({ ...f, docs: e.target.value }))} placeholder={"Attestation fiscale\nRCCM\nCatalogue produits\nCaution de soumission"} />
        </FormField>
        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">{saving ? "Création…" : "Créer"}</button>
        </div>
      </div>
    </Modal>
  );
}
