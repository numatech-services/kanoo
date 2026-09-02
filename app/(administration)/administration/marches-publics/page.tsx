"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { LIBELLES_PROCEDURES, determineProcedureMarche } from "@/lib/niger-fiscal";

interface Tender { 
  _id: string; 
  reference: string; 
  object: string; 
  estimatedAmount: number; 
  procedure: string; 
  status: string; 
  bidsDeadline?: string; 
}

export default function MarchesPublicsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(""); 
  const LIMIT = 20;
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ object: "", estimatedAmount: 0, notes: "" });
  const [saving, setSaving] = useState(false);

  // --- CHARGEMENT DES DONNÉES ---
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set("status", status);
    
    try {
      const res = await fetch(`/api/marches?${params}`, { credentials: "include" });
      const d = await res.json(); 
      setTenders(d.data?.items || []); 
      setTotal(d.data?.pagination?.total || 0);
    } catch (error) {
      console.error("Erreur de chargement:", error);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { 
    setMounted(true); 
    load(); 
  }, [load]);

  const detectedProcedure = form.estimatedAmount > 0 ? determineProcedureMarche(form.estimatedAmount) : null;

  // --- CRÉATION ---
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); 
    setSaving(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf"); 
      const { csrfToken } = await csrfRes.json();
      
      const res = await fetch("/api/marches", { 
          method: "POST", 
          headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, 
          credentials: "include", 
          body: JSON.stringify(form) 
      });

      if (res.ok) {
        setModalOpen(false); 
        setForm({ object: "", estimatedAmount: 0, notes: "" });
        load();
      }
    } catch (error) {
      console.error("Erreur de création:", error);
    } finally {
      setSaving(false);
    }
  }

  // --- CONFIGURATION DES COLONNES ---
  const columns: Column<Tender>[] = [
    { 
        key: "reference", 
        label: "Référence", 
        className: "font-mono text-cedar font-bold text-sm",
        // On rend la référence cliquable pour plus de sécurité
        render: (v, item) => (
          <button 
            onClick={() => router.push(`/administration/marches-publics/${item._id}`)}
            className="hover:underline text-left hover:text-ink transition-colors"
          >
            {String(v)}
          </button>
        )
    },
    { key: "object", label: "Objet du marché" },
    { 
        key: "estimatedAmount", 
        label: "Montant (XOF)", 
        className: "text-right font-mono", 
        render: (v) => Number(v).toLocaleString("fr-FR") 
    },
    { 
        key: "procedure", 
        label: "Procédure", 
        render: (v) => <span className="text-[10px] uppercase font-bold text-moss/70">{String(v).replace(/_/g," ")}</span> 
    },
    { key: "status", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
    { 
        key: "_id", 
        label: "Action", 
        className: "text-right",
        render: (id) => (
          <button 
            onClick={() => router.push(`/administration/marches-publics/${id}`)}
            className="px-3 py-1 bg-cedar text-white rounded-lg text-xs font-bold hover:bg-ink transition-all shadow-sm"
          >
            Gérer
          </button>
        )
    }
  ];

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-bold text-ink">Marchés Publics</h1>
            <p className="text-sm text-moss mt-0.5">Code des Marchés Publics Niger 2017</p>
        </div>
        <button 
          onClick={() => setModalOpen(true)} 
          className="px-4 py-2 bg-cedar text-white rounded-xl text-sm font-bold shadow-sm hover:bg-ink transition-all"
        >
            + Nouveau marché
        </button>
      </div>

      {/* Seuils Niger */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 shadow-sm">
        <strong>Seuils Niger :</strong> &lt; 5M = Achat direct — 5M–30M = Restreinte — 30M–100M = AO ouvert — &gt; 100M = Publicité nationale
      </div>

      {/* Filtre de Statut */}
      <div className="flex justify-end">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border border-clay/30 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-cedar/20">
            <option value="">Tous les statuts</option>
            {["planning","published","evaluation","attributed","cancelled"].map(s=>(
                <option key={s} value={s}>{s.replace(/_/g," ").toUpperCase()}</option>
            ))}
        </select>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-2xl border border-clay/10 shadow-sm overflow-x-auto transition-all">
        <DataTable 
          columns={columns} 
          data={tenders} 
          loading={loading} 
          keyExtractor={(t) => t._id} 
          emptyMessage="Aucun marché trouvé." 
        />
      </div>

      {/* Pagination */}
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      {/* Modal de Création */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau marché" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-moss uppercase mb-1">Objet du marché *</label>
            <textarea className="w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:ring-2 focus:ring-cedar/20 outline-none" value={form.object} onChange={e=>setForm(p=>({...p,object:e.target.value}))} required />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-moss uppercase mb-1">Montant estimé (XOF) *</label>
            <input type="number" className="w-full px-3 py-2 border border-clay/30 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-cedar/20" value={form.estimatedAmount} onChange={e=>setForm(p=>({...p,estimatedAmount:Number(e.target.value)}))} min={0} required />
            {detectedProcedure && (
              <p className="mt-2 text-[11px] text-cedar font-bold italic">→ Procédure : {LIBELLES_PROCEDURES[detectedProcedure]}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-moss font-medium hover:underline">Annuler</button>
            <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-bold shadow-md hover:bg-ink disabled:opacity-50 transition-all">
                {saving ? "Création..." : "Créer le marché"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}