"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Upload, Download, Trash2, Plus, Check, ArrowRight, Ban, Trophy, X } from "lucide-react";
import { APPEL_STATUS, deadlineInfo } from "../page";

interface ReqDoc { _id?: string; label: string; provided: boolean }
interface Doc { _id: string; name?: string; dataUri?: string }
interface Appel {
  _id: string; title: string; organism?: string; reference?: string; status: string;
  submissionDeadline?: string; estimatedAmount: number;
  requiredDocuments: ReqDoc[]; documents: Doc[]; notes?: string;
}

const NEXT: Record<string, { to: string; label: string }> = {
  identified: { to: "preparing", label: "Démarrer la préparation" },
  preparing: { to: "submitted", label: "Marquer déposé" },
};
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

export default function AppelDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [a, setA] = useState<Appel | null>(null);
  const [newDoc, setNewDoc] = useState("");

  const load = useCallback(() => {
    fetch(`/api/appels/${id}`, { credentials: "include" }).then(r => r.json()).then(d => setA(d.data || d));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/appels/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, credentials: "include", body: JSON.stringify(body) });
    if (res.ok) load(); else alert((await res.json()).error || "Échec");
  }
  async function del() {
    if (!confirm("Supprimer cet appel ?")) return;
    const res = await fetch(`/api/appels/${id}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    if (res.ok) router.push("/appels");
  }
  function toggleReq(i: number) {
    const req = a!.requiredDocuments.map((d, idx) => idx === i ? { label: d.label, provided: !d.provided } : { label: d.label, provided: d.provided });
    patch({ requiredDocuments: req });
  }
  function addReq() {
    if (!newDoc.trim()) return;
    patch({ requiredDocuments: [...a!.requiredDocuments.map(d => ({ label: d.label, provided: d.provided })), { label: newDoc.trim(), provided: false }] });
    setNewDoc("");
  }
  function removeReq(i: number) {
    patch({ requiredDocuments: a!.requiredDocuments.filter((_, idx) => idx !== i).map(d => ({ label: d.label, provided: d.provided })) });
  }
  function uploadDoc(file: File) {
    if (file.size > 2_500_000) { alert("Fichier trop lourd (2,5 Mo max)."); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ documents: [...(a!.documents || []).map(d => ({ name: d.name, dataUri: d.dataUri })), { name: file.name, dataUri: String(reader.result) }] });
    reader.readAsDataURL(file);
  }
  function removeDoc(did: string) { patch({ documents: (a!.documents || []).filter(d => d._id !== did).map(d => ({ name: d.name, dataUri: d.dataUri })) }); }

  if (!a) return <div className="p-6"><div className="h-32 bg-surface rounded-xl animate-pulse" /></div>;
  const s = APPEL_STATUS[a.status] || { label: a.status, cls: "bg-surface2 text-ink2" };
  const dl = deadlineInfo(a.submissionDeadline);
  const req = a.requiredDocuments || []; const done = req.filter(d => d.provided).length;
  const terminal = ["won", "lost", "cancelled"].includes(a.status);
  const next = NEXT[a.status];

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <Link href="/appels" className="text-xs text-ink2 hover:text-ink">← Appels à candidatures</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-ink">{a.title}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
          </div>
          <p className="text-sm text-ink2">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {next && <button onClick={() => patch({ status: next.to })} className="px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 inline-flex items-center gap-1.5">{next.label} <ArrowRight size={15} /></button>}
          {a.status === "submitted" && <>
            <button onClick={() => patch({ status: "won" })} className="px-3 h-10 rounded-lg bg-pos text-white text-sm font-semibold inline-flex items-center gap-1.5"><Trophy size={15} /> Gagné</button>
            <button onClick={() => patch({ status: "lost" })} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm inline-flex items-center gap-1.5"><X size={15} /> Perdu</button>
          </>}
          {!terminal && <button onClick={() => patch({ status: "cancelled" })} className="px-3 h-10 rounded-lg border border-line2 text-ink2 text-sm hover:bg-surface2 inline-flex items-center gap-1.5"><Ban size={14} /> Annuler</button>}
          <button onClick={del} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">Supprimer</button>
        </div>
      </div>

      {/* Date limite */}
      {dl && (
        <div className="surface-card p-4 flex items-center justify-between">
          <span className="text-sm text-ink2 flex items-center gap-2"><Clock size={16} /> Date limite de dépôt : <b className="text-ink">{a.submissionDeadline ? new Date(a.submissionDeadline).toLocaleDateString("fr-FR", { dateStyle: "long" }) : "—"}</b></span>
          <span className={`text-sm ${dl.cls}`}>{dl.text}</span>
        </div>
      )}

      {/* Pièces exigées */}
      <section className="surface-card p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Pièces exigées</h2>
          <span className="text-sm text-ink2">{done}/{req.length} prêtes</span>
        </div>
        <ul className="divide-y divide-line">
          {req.map((d, i) => (
            <li key={i} className="flex items-center gap-2 py-2">
              <input type="checkbox" className="accent-section" checked={d.provided} onChange={() => toggleReq(i)} />
              <span className={`flex-1 text-sm ${d.provided ? "text-ink line-through" : "text-ink"}`}>{d.label}</span>
              <button onClick={() => removeReq(i)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input className="flex-1 p-2 border border-line rounded-lg text-sm" placeholder="Ajouter une pièce…" value={newDoc} onChange={e => setNewDoc(e.target.value)} onKeyDown={e => e.key === "Enter" && addReq()} />
          <button onClick={addReq} className="px-3 h-9 rounded-lg bg-ink text-white text-sm inline-flex items-center gap-1"><Plus size={14} /> Ajouter</button>
        </div>
      </section>

      {/* Documents joints */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">Documents du dossier (devis, contrats, pièces…)</h2>
        {(a.documents || []).length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {a.documents.map(d => (
              <li key={d._id} className="flex items-center justify-between py-1.5">
                <a href={d.dataUri} download={d.name} className="inline-flex items-center gap-1.5 text-section hover:underline"><Download size={14} /> {d.name || "Document"}</a>
                <button onClick={() => removeDoc(d._id)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        <label className="inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
          <Upload size={15} /> Joindre un document (2,5 Mo max)
          <input type="file" className="hidden" onChange={e => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
        </label>
      </section>

      <section className="surface-card p-5">
        <label className="text-sm font-semibold text-ink flex items-center gap-2"><Check size={15} /> Notes</label>
        <textarea className="w-full mt-2 p-2 border border-line rounded-lg text-sm" rows={3} defaultValue={a.notes || ""} onBlur={e => e.target.value !== (a.notes || "") && patch({ notes: e.target.value })} placeholder="Stratégie, contacts, points de vigilance…" />
      </section>
    </div>
  );
}
