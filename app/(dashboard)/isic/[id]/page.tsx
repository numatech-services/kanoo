"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Truck, Banknote, Upload, Download, Trash2, ArrowRight, Ban, FileText } from "lucide-react";
import { ISIC_STATUS, fmt, delivered as sumDelivered } from "../page";

interface Delivery { _id: string; date: string; quantity: number; note?: string }
interface Payment { _id: string; date: string; amount: number; method?: string; note?: string }
interface Batch {
  _id: string; reference: string; universityName: string; academicYear?: string; status: string;
  totalCards: number; unitLicenseFee: number; unitSalePrice: number;
  receivedFile?: { name?: string; dataUri?: string }; isicFile?: { name?: string; dataUri?: string };
  submittedAt?: string; numberedAt?: string; deliveries: Delivery[]; payments: Payment[]; notes?: string;
}

const STAGES: { key: string; label: string }[] = [
  { key: "received", label: "Reçu" }, { key: "processing", label: "Traitement" },
  { key: "submitted", label: "Envoyé ISIC" }, { key: "numbered", label: "Numéros reçus" },
  { key: "printing", label: "Impression" }, { key: "printed", label: "Imprimées" },
  { key: "delivering", label: "Livraison" }, { key: "completed", label: "Terminé" },
];
const NEXT: Record<string, string> = { received: "processing", processing: "submitted", submitted: "numbered", numbered: "printing", printing: "printed" };
const dt = (d?: string) => (d ? new Date(d).toLocaleDateString("fr-FR") : "");
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

export default function IsicBatchPage() {
  const { id } = useParams();
  const router = useRouter();
  const [b, setB] = useState<Batch | null>(null);
  const [delivery, setDelivery] = useState({ quantity: 0, note: "" });
  const [payment, setPayment] = useState({ amount: 0, method: "", note: "" });

  const load = useCallback(() => {
    fetch(`/api/isic/${id}`, { credentials: "include" }).then(r => r.json()).then(d => setB(d.data || d));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/isic/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, credentials: "include", body: JSON.stringify(body) });
    if (res.ok) load(); else alert((await res.json()).error || "Échec");
  }
  async function post(path: string, body: Record<string, unknown>, reset: () => void) {
    const res = await fetch(`/api/isic/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, credentials: "include", body: JSON.stringify(body) });
    if (res.ok) { reset(); load(); } else alert((await res.json()).error || "Échec");
  }
  async function del(path: string, qs: string) {
    const res = await fetch(`/api/isic/${id}/${path}?${qs}`, { method: "DELETE", headers: { "x-csrf-token": await csrf() }, credentials: "include" });
    if (res.ok) load();
  }
  async function deleteBatch() {
    if (!confirm("Supprimer ce lot ?")) return;
    const res = await fetch(`/api/isic/${id}`, { method: "DELETE", headers: { "x-csrf-token": await csrf() }, credentials: "include" });
    if (res.ok) router.push("/isic"); else alert("Suppression impossible.");
  }
  function upload(field: "receivedFile" | "isicFile", file: File) {
    if (file.size > 2_500_000) { alert("Fichier trop lourd (2,5 Mo max)."); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ [field]: { name: file.name, dataUri: String(reader.result) } });
    reader.readAsDataURL(file);
  }

  if (!b) return <div className="p-6"><div className="h-32 bg-surface rounded-xl animate-pulse" /></div>;
  const s = ISIC_STATUS[b.status] || { label: b.status, cls: "bg-surface2 text-ink2" };
  const done = sumDelivered(b); const remaining = b.totalCards - done;
  const licenseCost = b.totalCards * b.unitLicenseFee, saleAmount = b.totalCards * b.unitSalePrice;
  const margin = saleAmount - licenseCost;
  const paid = b.payments.reduce((x, p) => x + p.amount, 0); const balance = saleAmount - paid;
  const terminal = b.status === "cancelled" || b.status === "completed";
  const currentIdx = STAGES.findIndex(st => st.key === b.status);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <Link href="/isic" className="text-xs text-ink2 hover:text-ink">← Cartes ISIC</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-ink">{b.universityName}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
          </div>
          <p className="text-sm text-ink2 font-mono">{b.reference}{b.academicYear ? ` · ${b.academicYear}` : ""}</p>
        </div>
        <div className="flex gap-2">
          {NEXT[b.status] && <button onClick={() => patch({ status: NEXT[b.status] })} className="px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 inline-flex items-center gap-1.5">Étape suivante <ArrowRight size={15} /></button>}
          {!terminal && <button onClick={() => { if (confirm("Annuler ce lot ?")) patch({ status: "cancelled" }); }} className="px-3 h-10 rounded-lg border border-warn/25 text-warn text-sm hover:bg-warn-50 inline-flex items-center gap-1.5"><Ban size={15} /> Annuler</button>}
          <button onClick={deleteBatch} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">Supprimer</button>
        </div>
      </div>

      {/* Étapes */}
      <div className="surface-card p-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {STAGES.map((st, i) => (
            <div key={st.key} className="flex items-center gap-1">
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${i <= currentIdx && b.status !== "cancelled" ? "bg-section text-white" : "bg-surface2 text-ink3"}`}>{st.label}</span>
              {i < STAGES.length - 1 && <ArrowRight size={12} className="text-ink3" />}
            </div>
          ))}
        </div>
      </div>

      {/* Finances */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[["Cartes", b.totalCards.toLocaleString("fr-FR")], ["Coût licences ISIC", fmt(licenseCost)], ["Revente université", fmt(saleAmount)], ["Marge", fmt(margin)]].map(([k, v], i) => (
          <div key={k} className="surface-card p-4"><p className="text-[11px] text-ink2 uppercase font-semibold">{k}</p><p className={`text-lg font-bold ${i === 3 ? "text-pos" : "text-ink"}`}>{v}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Livraisons au fur et à mesure */}
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink flex items-center gap-2"><Truck size={17} /> Livraisons</h2>
            <span className="text-sm text-ink2">{done}/{b.totalCards} · reste <b className={remaining ? "text-warn" : "text-pos"}>{remaining}</b></span>
          </div>
          {b.deliveries.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {b.deliveries.map(d => (
                <li key={d._id} className="flex items-center justify-between py-1.5">
                  <span><b className="text-ink">{d.quantity}</b> cartes · <span className="text-ink2">{dt(d.date)}</span>{d.note && <span className="text-ink3"> — {d.note}</span>}</span>
                  <button onClick={() => del("delivery", `deliveryId=${d._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          {remaining > 0 && b.status !== "cancelled" && (
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="text-[11px] text-ink3">Quantité livrée</label><input type="number" min={1} max={remaining} className="w-full p-2 border border-line rounded-lg text-sm" value={delivery.quantity || ""} onChange={e => setDelivery(d => ({ ...d, quantity: Number(e.target.value) }))} /></div>
              <input placeholder="Note (bordereau…)" className="flex-1 p-2 border border-line rounded-lg text-sm" value={delivery.note} onChange={e => setDelivery(d => ({ ...d, note: e.target.value }))} />
              <button onClick={() => post("delivery", delivery, () => setDelivery({ quantity: 0, note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-white text-sm font-semibold">Livrer</button>
            </div>
          )}
        </section>

        {/* Encaissements */}
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink flex items-center gap-2"><Banknote size={17} /> Encaissements</h2>
            <span className="text-sm text-ink2">Payé {fmt(paid)} · reste <b className={balance > 0 ? "text-warn" : "text-pos"}>{fmt(balance)}</b></span>
          </div>
          {b.payments.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {b.payments.map(p => (
                <li key={p._id} className="flex items-center justify-between py-1.5">
                  <span><b className="text-ink">{fmt(p.amount)}</b> · <span className="text-ink2">{dt(p.date)}</span>{p.method && <span className="text-ink3"> — {p.method}</span>}</span>
                  <button onClick={() => del("payment", `paymentId=${p._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1"><label className="text-[11px] text-ink3">Montant (XOF)</label><input type="number" min={1} className="w-full p-2 border border-line rounded-lg text-sm" value={payment.amount || ""} onChange={e => setPayment(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
            <input placeholder="Mode (virement…)" className="flex-1 p-2 border border-line rounded-lg text-sm" value={payment.method} onChange={e => setPayment(p => ({ ...p, method: e.target.value }))} />
            <button onClick={() => post("payment", payment, () => setPayment({ amount: 0, method: "", note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-white text-sm font-semibold">Ajouter</button>
          </div>
        </section>
      </div>

      {/* Fichiers */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Fichiers</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {([["receivedFile", "Fichier reçu de l'université"], ["isicFile", "Fichier ISIC (avec numéros)"]] as const).map(([field, label]) => {
            const f = b[field];
            return (
              <div key={field} className="text-sm">
                <p className="text-ink2 mb-1">{label}</p>
                {f?.dataUri ? (
                  <div className="flex items-center gap-3">
                    <a href={f.dataUri} download={f.name} className="inline-flex items-center gap-1.5 text-section hover:underline"><Download size={14} /> {f.name || "Télécharger"}</a>
                    <button onClick={() => patch({ [field]: null })} className="text-xs text-neg hover:underline">Retirer</button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-ink2 hover:bg-surface2 cursor-pointer">
                    <Upload size={14} /> Joindre (2,5 Mo max)
                    <input type="file" className="hidden" onChange={e => e.target.files?.[0] && upload(field, e.target.files[0])} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface-card p-5">
        <label className="text-sm font-semibold text-ink">Notes</label>
        <textarea className="w-full mt-2 p-2 border border-line rounded-lg text-sm" rows={2} defaultValue={b.notes || ""} onBlur={e => e.target.value !== (b.notes || "") && patch({ notes: e.target.value })} placeholder="Remarques internes…" />
      </section>
    </div>
  );
}
