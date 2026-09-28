"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Truck, Banknote, Upload, Download, Trash2, ArrowRight, Ban, FileText } from "lucide-react";
import { ISIC_STATUS, fmt, delivered as sumDelivered } from "../page";
import { useMe, meCan } from "@/lib/useMe";

interface Delivery { _id: string; date: string; quantity: number; note?: string }
interface Payment { _id: string; date: string; amount: number; method?: string; note?: string }
interface Batch {
  _id: string; reference: string; universityName: string; academicYear?: string; status: string;
  totalCards: number; unitLicenseFee: number; unitSalePrice: number;
  receivedFile?: { name?: string; dataUri?: string }; isicFile?: { name?: string; dataUri?: string };
  submittedAt?: string; numberedAt?: string; deliveries: Delivery[]; payments: Payment[];
  licensePayments?: Payment[]; universityId?: { _id?: string; name?: string } | string; invoiceId?: string; notes?: string;
}
interface ClientOpt { _id: string; name: string }

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
  const { resources } = useMe();
  const canFinance = meCan(resources, "isicFinance");
  const [b, setB] = useState<Batch | null>(null);
  const [delivery, setDelivery] = useState({ quantity: 0, note: "" });
  const [payment, setPayment] = useState({ amount: 0, method: "", note: "" });
  const [licPay, setLicPay] = useState({ amount: 0, note: "" });
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<{ _id: string; studentName: string; matricule?: string; isicNumber?: string; status: string }[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    fetch(`/api/isic/${id}`, { credentials: "include" }).then(r => r.json()).then(d => setB(d.data || d));
  }, [id]);
  const loadCards = useCallback(() => {
    fetch(`/api/isic/${id}/cards`, { credentials: "include" }).then(r => r.json())
      .then(d => { setCards(d.data?.cards || []); setCounts(d.data?.counts || {}); }).catch(() => {});
  }, [id]);
  useEffect(() => { load(); loadCards(); }, [load, loadCards]);

  async function cardsAction(bodyOrFile: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/isic/${id}/cards`, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, credentials: "include", body: JSON.stringify(bodyOrFile) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      loadCards();
    } catch (e) { alert(e instanceof Error ? e.message : "Action impossible"); } finally { setBusy(false); }
  }
  function importCsv(action: "import-students" | "import-numbers", file: File) {
    const reader = new FileReader();
    reader.onload = () => cardsAction({ action, csv: String(reader.result) });
    reader.readAsText(file);
  }
  useEffect(() => {
    if (!canFinance) return;
    fetch("/api/clients?limit=500", { credentials: "include" }).then(r => r.json())
      .then(d => setClients(Array.isArray(d.data) ? d.data : d.data?.items || [])).catch(() => {});
  }, [canFinance]);

  async function generateInvoice() {
    const uniId = typeof b!.universityId === "object" ? b!.universityId?._id : b!.universityId;
    if (!uniId) { alert("Liez d'abord un client (université) pour facturer."); return; }
    setBusy(true);
    try {
      const token = await csrf();
      const today = new Date(); const due = new Date(today); due.setDate(due.getDate() + 30);
      const res = await fetch("/api/invoices", {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": token }, credentials: "include",
        body: JSON.stringify({
          clientId: uniId, issueDate: today.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10),
          lines: [{ description: `Cartes ISIC ${b!.academicYear || ""} — ${b!.reference}`.trim(), quantity: b!.totalCards, unitPrice: b!.unitSalePrice, tvaRate: 0 }],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      const invId = d.data?._id || d.data?.id;
      await patch({ invoiceId: invId });
      alert("Facture générée.");
    } catch (e) { alert(e instanceof Error ? e.message : "Génération impossible"); } finally { setBusy(false); }
  }

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
  const licPaid = (b.licensePayments || []).reduce((x, p) => x + p.amount, 0);
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

      {/* Cartes — suivi détaillé (production, visible aussi de l'opérateur). */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Cartes (suivi détaillé)</h2>
          <div className="flex gap-1.5 text-[11px]">
            {[["pending", "À traiter"], ["numbered", "Numérotées"], ["printed", "Imprimées"], ["delivered", "Livrées"]].map(([k, l]) => (
              <span key={k} className="px-2 py-0.5 rounded-full bg-surface2 text-ink2">{l} <b className="text-ink">{counts[k] || 0}</b></span>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
            <Upload size={14} /> Importer les étudiants (CSV)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && importCsv("import-students", e.target.files[0])} />
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
            <Upload size={14} /> Importer les numéros ISIC (CSV)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && importCsv("import-numbers", e.target.files[0])} />
          </label>
          {(counts.numbered || 0) > 0 && <button disabled={busy} onClick={() => cardsAction({ action: "advance", from: "numbered", to: "printed" })} className="px-3 h-9 rounded-lg bg-ink text-white text-sm font-semibold">Marquer imprimées</button>}
          {(counts.printed || 0) > 0 && <button disabled={busy} onClick={() => cardsAction({ action: "advance", from: "printed", to: "delivered" })} className="px-3 h-9 rounded-lg bg-section text-white text-sm font-semibold">Marquer livrées</button>}
        </div>
        {cards.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
            <table className="table-dense w-full">
              <thead><tr className="bg-surface2/50"><th>Étudiant</th><th>Matricule</th><th>N° ISIC</th><th>Statut</th></tr></thead>
              <tbody>
                {cards.slice(0, 200).map(c => (
                  <tr key={c._id} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink">{c.studentName}</td>
                    <td className="px-3 py-1.5 text-ink2 font-mono text-xs">{c.matricule || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{c.isicNumber || <span className="text-ink3">—</span>}</td>
                    <td className="px-3 py-1.5 text-xs">{({ pending: "À traiter", numbered: "Numérotée", printed: "Imprimée", delivered: "Livrée" } as Record<string, string>)[c.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cards.length > 200 && <p className="text-[11px] text-ink3 px-3 py-1.5">… et {cards.length - 200} autres.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink3">Importez le fichier étudiants pour un suivi carte par carte (facultatif — le suivi par lot reste dispo).</p>
        )}
      </section>

      {/* Finances — visibles seulement pour un rôle financier. */}
      {canFinance && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[["Cartes", b.totalCards.toLocaleString("fr-FR")], ["Coût licences ISIC", fmt(licenseCost)], ["Revente université", fmt(saleAmount)], ["Marge", fmt(margin)]].map(([k, v], i) => (
            <div key={k} className="surface-card p-4"><p className="text-[11px] text-ink2 uppercase font-semibold">{k}</p><p className={`text-lg font-bold ${i === 3 ? "text-pos" : "text-ink"}`}>{v}</p></div>
          ))}
        </div>
      )}

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

        {/* Encaissements — volet financier. */}
        {canFinance && (
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
        )}
      </div>

      {/* Achat licences + facturation (financier) */}
      {canFinance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="surface-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink flex items-center gap-2"><Banknote size={17} /> Frais de licence ISIC</h2>
              <span className="text-sm text-ink2">Payé {fmt(licPaid)} / {fmt(licenseCost)}</span>
            </div>
            {(b.licensePayments || []).length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {(b.licensePayments || []).map(p => (
                  <li key={p._id} className="flex items-center justify-between py-1.5">
                    <span><b className="text-ink">{fmt(p.amount)}</b> · <span className="text-ink2">{dt(p.date)}</span></span>
                    <button onClick={() => del("license-payment", `paymentId=${p._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="text-[11px] text-ink3">Montant versé à ISIC (XOF)</label><input type="number" min={1} className="w-full p-2 border border-line rounded-lg text-sm" value={licPay.amount || ""} onChange={e => setLicPay(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
              <button onClick={() => post("license-payment", licPay, () => setLicPay({ amount: 0, note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-white text-sm font-semibold">Enregistrer</button>
            </div>
          </section>

          <section className="surface-card p-5 space-y-3">
            <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Facturation université</h2>
            <div>
              <label className="text-[11px] text-ink3">Client (université) à facturer</label>
              <select className="w-full mt-1 p-2 border border-line rounded-lg text-sm" value={(typeof b.universityId === "object" ? b.universityId?._id : b.universityId) || ""} onChange={e => patch({ universityId: e.target.value })}>
                <option value="">— Lier un client —</option>
                {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            {b.invoiceId ? (
              <Link href={`/invoices/${b.invoiceId}`} className="inline-flex items-center gap-1.5 text-sm text-pos hover:underline">Facture générée — l&apos;ouvrir →</Link>
            ) : (
              <button onClick={generateInvoice} disabled={busy || !b.unitSalePrice} className="w-full py-2.5 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
                {busy ? "Génération…" : "Générer la facture de revente"}
              </button>
            )}
            {!b.unitSalePrice && <p className="text-[11px] text-warn">Renseignez le prix de revente pour facturer.</p>}
          </section>
        </div>
      )}

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
