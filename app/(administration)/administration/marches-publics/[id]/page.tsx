"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { errorMessage } from "@/lib/errors";
import { Plus, Trash2, Award, Ban, FileCheck, Landmark } from "lucide-react";

interface Bid { _id?: string; bidderName: string; amount: number; compliant?: boolean; notes?: string }
interface Tender {
  _id: string; reference: string; object: string; estimatedAmount: number;
  procedure: string; status: string; createdAt: string;
  publishDate?: string; bidsDeadline?: string; openingDate?: string; attributionDate?: string;
  winnerId?: string; winnerName?: string; winnerAmount?: number;
  budgetChapterId?: string; bids?: Bid[]; cancelReason?: string; engagementId?: string;
}
interface Chapter { _id: string; code: string; label: string }

const fmt = (n?: number) => `${(n || 0).toLocaleString("fr-FR")} XOF`;
const dt = (d?: string) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

const STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Planification", cls: "bg-warn-50 text-warn border-warn/25" },
  draft: { label: "Brouillon", cls: "bg-surface2 text-ink2 border-line" },
  published: { label: "Publié", cls: "bg-info-50 text-info border-info/25" },
  bids_open: { label: "Soumissions ouvertes", cls: "bg-info-50 text-info border-info/25" },
  bids_closed: { label: "Dépôts clôturés", cls: "bg-section-soft text-section border-section/25" },
  evaluation: { label: "Évaluation", cls: "bg-section-soft text-section border-section/25" },
  attributed: { label: "Attribué", cls: "bg-pos-50 text-pos border-pos/25" },
  cancelled: { label: "Annulé", cls: "bg-neg-50 text-neg border-neg/25" },
  completed: { label: "Terminé", cls: "bg-pos-50 text-pos border-pos/25" },
};

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
  return csrfToken as string;
}

export default function TenderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [tender, setTender] = useState<Tender | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(false);
  const [newBid, setNewBid] = useState<Bid>({ bidderName: "", amount: 0, compliant: true });
  const [winnerBidId, setWinnerBidId] = useState("");

  const load = useCallback(() => {
    fetch(`/api/marches/${id}`, { credentials: "include" })
      .then((r) => r.json()).then((d) => setTender(d.data || d)).catch(() => toast.error("Erreur de chargement"));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/budget", { credentials: "include" }).then((r) => r.json())
      .then((d) => setChapters(Array.isArray(d.data) ? d.data : d.data?.items || [])).catch(() => {});
  }, []);

  async function patch(updates: Partial<Tender>, msg = "Marché mis à jour") {
    setLoading(true);
    try {
      const res = await fetch(`/api/marches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      setTender(d.data || d); toast.success(msg); router.refresh();
    } catch (err) { toast.error(errorMessage(err)); } finally { setLoading(false); }
  }

  async function del() {
    if (!confirm("Supprimer ce marché ? Action irréversible.")) return;
    const res = await fetch(`/api/marches/${id}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    if (res.ok) { toast.success("Marché supprimé"); router.push("/administration/marches-publics"); }
    else toast.error("Suppression impossible");
  }

  function addBid() {
    if (!newBid.bidderName.trim() || newBid.amount <= 0) return toast.error("Nom du soumissionnaire et montant requis.");
    patch({ bids: [...(tender!.bids || []), newBid] }, "Soumission enregistrée");
    setNewBid({ bidderName: "", amount: 0, compliant: true });
  }
  function removeBid(i: number) {
    patch({ bids: (tender!.bids || []).filter((_, idx) => idx !== i) }, "Soumission retirée");
  }

  function attribute() {
    const bid = (tender!.bids || []).find((b) => (b._id || "") === winnerBidId);
    if (!bid) return toast.error("Sélectionnez le soumissionnaire retenu.");
    patch({ status: "attributed", winnerName: bid.bidderName, winnerAmount: bid.amount, attributionDate: new Date().toISOString() }, "Marché attribué");
  }

  async function createEngagement() {
    setLoading(true);
    try {
      const res = await fetch(`/api/marches/${id}/engagement`, { method: "POST", credentials: "include", headers: { "x-csrf-token": await csrf() } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      toast.success(`Engagement ${d.data.reference} créé`); load();
    } catch (err) { toast.error(errorMessage(err)); } finally { setLoading(false); }
  }

  function cancel() {
    const reason = prompt("Motif d'annulation du marché ?");
    if (reason === null) return;
    patch({ status: "cancelled", cancelReason: reason }, "Marché annulé");
  }

  if (!tender) return <div className="p-6"><div className="h-32 bg-surface rounded-xl animate-pulse" /></div>;
  const s = STATUS[tender.status] || { label: tender.status, cls: "bg-surface2 text-ink2 border-line" };
  const terminal = tender.status === "cancelled" || tender.status === "completed";
  const canBid = ["bids_open", "bids_closed", "evaluation"].includes(tender.status);
  const chapterLabel = chapters.find((c) => c._id === tender.budgetChapterId);

  // Bouton d'avancement de statut selon l'étape.
  const NEXT: Record<string, { to: string; label: string; extra?: Partial<Tender> }> = {
    planning: { to: "published", label: "Publier l'appel d'offres", extra: { publishDate: new Date().toISOString() } },
    draft: { to: "published", label: "Publier l'appel d'offres", extra: { publishDate: new Date().toISOString() } },
    published: { to: "bids_open", label: "Ouvrir les soumissions" },
    bids_open: { to: "bids_closed", label: "Clôturer les dépôts" },
    bids_closed: { to: "evaluation", label: "Ouvrir les plis (évaluation)", extra: { openingDate: new Date().toISOString() } },
    attributed: { to: "completed", label: "Marquer le marché terminé" },
  };
  const next = NEXT[tender.status];

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Link href="/administration/marches-publics" className="text-xs text-ink2 hover:text-ink">← Retour aux marchés publics</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-3xl font-bold text-ink">{tender.reference}</h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${s.cls}`}>{s.label}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {next && (
            <button onClick={() => patch({ status: next.to, ...next.extra }, next.label)} disabled={loading}
              className="bg-section text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:brightness-95 disabled:opacity-50">{next.label}</button>
          )}
          {!terminal && (
            <button onClick={cancel} className="border border-warn/25 text-warn px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-warn-50 inline-flex items-center gap-1.5"><Ban size={15} /> Annuler</button>
          )}
          <button onClick={del} className="border border-neg/25 text-neg px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-neg-50">Supprimer</button>
        </div>
      </div>

      {tender.status === "cancelled" && tender.cancelReason && (
        <p className="px-4 py-3 rounded-xl bg-neg-50 border border-neg/25 text-sm text-neg">Marché annulé — motif : {tender.cancelReason}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Détails + chapitre + soumissions */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface rounded-2xl border border-line p-6">
            <h2 className="text-lg font-bold text-ink mb-4 border-b border-line pb-2">Détails techniques</h2>
            <div className="space-y-3 text-sm">
              {([["Objet", tender.object], ["Montant estimé", fmt(tender.estimatedAmount)], ["Procédure", tender.procedure],
                ["Publication", dt(tender.publishDate)], ["Date limite de dépôt", dt(tender.bidsDeadline)],
                ["Ouverture des plis", dt(tender.openingDate)]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line pb-2 last:border-0"><span className="text-ink3">{k}</span><span className="text-ink font-semibold text-right">{v}</span></div>
              ))}
            </div>
            {/* Rattachement chapitre budgétaire */}
            <div className="mt-4 pt-3 border-t border-line">
              <label className="text-[11px] font-bold text-ink3 uppercase">Chapitre budgétaire</label>
              <select value={tender.budgetChapterId || ""} disabled={terminal}
                onChange={(e) => patch({ budgetChapterId: e.target.value }, "Chapitre rattaché")}
                className="w-full mt-1 p-2 bg-surface2 rounded-lg text-sm border border-line">
                <option value="">— Aucun —</option>
                {chapters.map((c) => <option key={c._id} value={c._id}>{c.code} — {c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Dépouillement des plis */}
          {(canBid || (tender.bids && tender.bids.length > 0)) && (
            <div className="bg-surface rounded-2xl border border-line p-6">
              <h2 className="text-lg font-bold text-ink mb-4 border-b border-line pb-2">Soumissions ({tender.bids?.length || 0})</h2>
              {tender.bids && tender.bids.length > 0 ? (
                <table className="table-dense w-full mb-3">
                  <thead><tr className="bg-surface2/50"><th>Soumissionnaire</th><th>Montant</th><th>Conforme</th><th></th></tr></thead>
                  <tbody>
                    {tender.bids.map((b, i) => (
                      <tr key={b._id || i} className="border-t border-line">
                        <td className="px-3 py-2 text-ink font-medium">{b.bidderName}</td>
                        <td className="px-3 py-2 text-right">{fmt(b.amount)}</td>
                        <td className="px-3 py-2">{b.compliant !== false ? "✓" : <span className="text-neg">non</span>}</td>
                        <td className="px-3 py-2 text-right">{canBid && <button onClick={() => removeBid(i)} className="text-ink3 hover:text-neg"><Trash2 size={14} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-ink3 mb-3">Aucune soumission enregistrée.</p>}
              {canBid && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                  <input className="p-2 bg-surface2 rounded-lg text-sm border border-line" placeholder="Nom du soumissionnaire"
                    value={newBid.bidderName} onChange={(e) => setNewBid({ ...newBid, bidderName: e.target.value })} />
                  <input type="number" className="p-2 bg-surface2 rounded-lg text-sm border border-line w-32" placeholder="Montant"
                    value={newBid.amount || ""} onChange={(e) => setNewBid({ ...newBid, amount: Number(e.target.value) })} />
                  <label className="flex items-center gap-1 text-xs text-ink2"><input type="checkbox" className="accent-section" checked={newBid.compliant !== false} onChange={(e) => setNewBid({ ...newBid, compliant: e.target.checked })} /> Conforme</label>
                  <button onClick={addBid} disabled={loading} className="bg-ink text-white px-3 h-9 rounded-lg text-sm font-bold inline-flex items-center gap-1"><Plus size={14} /> Ajouter</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Attribution / engagement */}
        <div className="space-y-6">
          <div className="bg-surface2/20 rounded-2xl border border-line p-6">
            <h2 className="text-lg font-bold text-ink mb-4">Attribution</h2>
            {tender.status === "attributed" || tender.status === "completed" ? (
              <div className="space-y-3">
                <div className="bg-pos-50 p-4 rounded-xl border border-pos/25">
                  <p className="text-[10px] font-bold text-pos uppercase flex items-center gap-1"><Award size={13} /> Titulaire</p>
                  <p className="font-bold text-ink mt-1">{tender.winnerName || "—"}</p>
                  <p className="text-xs text-ink3 mt-2">Montant d'attribution</p>
                  <p className="font-bold text-ink text-lg">{fmt(tender.winnerAmount)}</p>
                  <p className="text-[11px] text-ink3 mt-1">le {dt(tender.attributionDate)}</p>
                </div>
                {/* Pont budgétaire */}
                {tender.engagementId ? (
                  <p className="text-sm text-pos flex items-center gap-1.5"><FileCheck size={15} /> Engagement budgétaire créé.</p>
                ) : tender.budgetChapterId ? (
                  <button onClick={createEngagement} disabled={loading}
                    className="w-full py-2.5 rounded-xl bg-ink text-white text-sm font-bold hover:bg-section inline-flex items-center justify-center gap-2"><Landmark size={15} /> Créer l'engagement budgétaire</button>
                ) : (
                  <p className="text-xs text-ink3 italic">Rattachez un chapitre budgétaire pour générer l'engagement.</p>
                )}
              </div>
            ) : ["bids_closed", "evaluation"].includes(tender.status) ? (
              <div className="space-y-3">
                <p className="text-xs text-ink3">Sélectionnez le soumissionnaire retenu :</p>
                <select value={winnerBidId} onChange={(e) => setWinnerBidId(e.target.value)} className="w-full p-2 bg-surface rounded-lg text-sm border border-line">
                  <option value="">— Choisir —</option>
                  {(tender.bids || []).filter((b) => b.compliant !== false).map((b, i) => (
                    <option key={b._id || i} value={b._id || ""}>{b.bidderName} — {fmt(b.amount)}</option>
                  ))}
                </select>
                <button onClick={attribute} disabled={loading || !winnerBidId} className="w-full py-3 rounded-xl bg-section text-white text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"><Award size={15} /> Attribuer le marché</button>
                {(tender.bids || []).length === 0 && <p className="text-[11px] text-warn">Enregistrez d'abord les soumissions.</p>}
              </div>
            ) : (
              <p className="text-xs text-ink3 italic">L'attribution sera possible une fois les dépôts clôturés et les plis ouverts (étape « Évaluation »).</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
