"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";

interface Approbation { _id: string; resource: string; resourceId: string; requestedBy: { firstName: string; lastName: string } | string; amount?: number; status: string; currentLevel: number; notes?: string; createdAt: string; }

export default function ApprobationsPage() {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Approbation[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(false); const [status, setStatus] = useState("");
  const [decideModal, setDecideModal] = useState<{ id: string; resource: string } | null>(null);
  const [decision, setDecision] = useState<"approved"|"rejected">("approved"); const [comment, setComment] = useState(""); const [deciding, setDeciding] = useState(false);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (mineOnly) params.set("mine", "true");
    if (status) params.set("status", status);
    const res = await fetch(`/api/approbations?${params}`, { credentials: "include" });
    const d = await res.json(); setItems(d.data?.items || []); setTotal(d.data?.pagination?.total || 0); setLoading(false);
  }, [page, mineOnly, status]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  async function handleDecide() {
    if (!decideModal) return; setDeciding(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/approbations/${decideModal.id}/decide`, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify({ decision, comment }) });
    if (res.ok) { setDecideModal(null); setComment(""); load(); }
    setDeciding(false);
  }

  if (!mounted) return null;

  const columns: Column<Approbation>[] = [
    { key: "resource", label: "Ressource", render: (v) => <span className="text-sm font-medium text-cedar capitalize">{String(v)}</span> },
    { key: "requestedBy", label: "Demandeur", render: (v) => typeof v === "object" && v ? `${(v as {firstName:string;lastName:string}).firstName} ${(v as {firstName:string;lastName:string}).lastName}` : "—" },
    { key: "amount", label: "Montant (XOF)", className: "text-right font-mono", render: (v) => v ? Number(v).toLocaleString("fr-FR") : "—" },
    { key: "currentLevel", label: "Niveau", render: (v) => <span className="text-xs bg-cedar/10 text-cedar px-2 py-0.5 rounded font-mono">N{String(v)}</span> },
    { key: "status", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
    { key: "createdAt", label: "Date", render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") },
    { key: "_id", label: "Action", render: (v, row) => row.status === "pending" ? (
      <button onClick={e => { e.stopPropagation(); setDecideModal({ id: String(v), resource: row.resource }); }} className="px-3 py-1 bg-cedar text-white text-xs rounded hover:bg-ink">Décider</button>
    ) : null },
  ];

  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold text-ink">Approbations</h1><p className="text-sm text-moss mt-0.5">{total} demande{total > 1 ? "s" : ""}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={mineOnly} onChange={e => { setMineOnly(e.target.checked); setPage(1); }} className="accent-cedar" />Mes validations en attente</label>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border border-clay/30 rounded-lg text-sm"><option value="">Tous</option><option value="pending">En attente</option><option value="approved">Approuvées</option><option value="rejected">Refusées</option></select>
      </div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={(a) => a._id} emptyMessage="Aucune approbation" />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
      <Modal open={!!decideModal} onClose={() => setDecideModal(null)} title="Décision d'approbation" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-moss">Ressource : <strong className="text-ink">{decideModal?.resource}</strong></p>
          <div className="flex gap-3">
            {(["approved","rejected"] as const).map(d => (
              <button key={d} onClick={() => setDecision(d)} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-all ${decision===d ? (d==="approved"?"border-green-500 bg-green-50 text-green-700":"border-red-500 bg-red-50 text-red-700") : "border-clay/30 text-moss"}`}>{d==="approved"?"✅ Approuver":"❌ Refuser"}</button>
            ))}
          </div>
          <div><label className={lbl}>Commentaire {decision==="rejected"?"(obligatoire)":""}</label><textarea className={inp} rows={3} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Motif de la décision…" /></div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDecideModal(null)} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">Annuler</button>
            <button onClick={handleDecide} disabled={deciding || (decision==="rejected" && !comment.trim())} className={`px-5 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-60 ${decision==="approved"?"bg-green-600 hover:bg-green-700":"bg-red-600 hover:bg-red-700"}`}>{deciding?"Traitement…":"Confirmer"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
