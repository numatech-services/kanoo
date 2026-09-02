"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";

export default function SupplierDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [item, setItem] = useState<Record<string, unknown>|null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/suppliers/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setItem(d.data));
  },[id]);

  async function handleSave(body: Record<string, unknown>) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/suppliers/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body:JSON.stringify(body) });
    const d = await res.json(); if (res.ok) { setItem(d.data); setEditOpen(false); }
  }

  if (!item) return <div className="p-6"><div className="h-48 bg-white rounded-xl animate-pulse border border-clay/20" /></div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <a href="/suppliers" className="text-xs text-moss hover:text-ink">← Fournisseurs</a>
          <h1 className="text-2xl font-bold text-ink mt-1">{String(item.name || item.title || item.reference || item.number || item.object || id)}</h1>
          {item.code && <p className="text-moss text-sm">{String(item.code)}</p>}
        </div>
        <button onClick={()=>setEditOpen(true)} className="mt-2 px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Modifier</button>
      </div>
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <div className="space-y-2">
          {Object.entries(item).filter(([k]) => !["_id","tenantId","__v","createdAt","updatedAt","lines","approvers","decisions","attendees"].includes(k)).map(([k, v]) => {
            if (v === null || v === undefined) return null;
            const display = typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v);
            return (
              <div key={k} className="flex gap-3 py-2 border-b border-clay/10 last:border-0 text-sm">
                <span className="text-moss w-36 flex-shrink-0 capitalize">{k.replace(/([A-Z])/g," $1")}</span>
                <span className="text-ink font-medium">{k === "status" ? <StatusBadge status={display}/> : display}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
