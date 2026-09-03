"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { SupplierForm, type SupplierFormData } from "@/components/pme/SupplierForm";

export default function SupplierDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState<Record<string, unknown>|null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/suppliers/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setItem(d.data));
  },[id]);

  async function handleSave(body: SupplierFormData) {
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/suppliers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const d = await res.json();
    // L'échec était avalé : la modale restait ouverte sans rien dire.
    if (!res.ok) throw new Error(d.error || "Enregistrement impossible.");
    setItem(d.data);
    setEditOpen(false);
  }

  if (!item) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <a href="/suppliers" className="text-xs text-ink2 hover:text-ink">← Fournisseurs</a>
          <h1 className="text-2xl font-bold text-ink mt-1">{String(item.name || item.title || item.reference || item.number || item.object || id)}</h1>
          {item.code ? <p className="text-ink2 text-sm">{String(item.code)}</p> : null}
        </div>
        <button onClick={()=>setEditOpen(true)} className="mt-2 px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">Modifier</button>
      </div>
      <div className="bg-surface rounded-xl border border-line p-5">
        <div className="space-y-2">
          {Object.entries(item).filter(([k]) => !["_id","tenantId","__v","createdAt","updatedAt","lines","approvers","decisions","attendees"].includes(k)).map(([k, v]) => {
            if (v === null || v === undefined) return null;
            const display = typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v);
            return (
              <div key={k} className="flex gap-3 py-2 border-b border-line last:border-0 text-sm">
                <span className="text-ink2 w-36 flex-shrink-0 capitalize">{k.replace(/([A-Z])/g," $1")}</span>
                <span className="text-ink font-medium">{k === "status" ? <StatusBadge status={display}/> : display}</span>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le fournisseur" size="lg">
        <SupplierForm
          initial={item as unknown as Partial<SupplierFormData>}
          onSave={handleSave}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>
    </div>
  );
}
