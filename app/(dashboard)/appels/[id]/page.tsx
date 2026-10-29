"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Upload, Download, Trash2, Plus, Check, ArrowRight, Ban, Trophy, X, Briefcase } from "lucide-react";
import { APPEL_STATUS, deadlineInfo } from "../page";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import {apiJson, apiSend } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { GUARANTEE_TYPES } from "@/lib/guarantees";
import { GoNoGoPanel } from "@/components/appels/GoNoGoPanel";
import { buttonClass } from "@/components/ui/button-class";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";

/** Motifs de rejet (models/AppelCandidature, LOSS_REASONS). */
const LOSS_LABEL: Record<string, string> = {
  prix: "Prix plus élevé", technique: "Offre technique insuffisante", administratif: "Pièce administrative manquante ou non conforme",
  hors_delai: "Déposé hors délai", non_conforme: "Offre non conforme", infructueux: "Appel déclaré infructueux", autre: "Autre motif",
};
interface ReqDoc { _id?: string; label: string; provided: boolean }
interface Doc { _id: string; name?: string; dataUri?: string }
interface Appel {
  _id: string; title: string; organism?: string; reference?: string; status: string;
  submissionDeadline?: string; estimatedAmount: number;
  requiredDocuments: ReqDoc[]; documents: Doc[]; notes?: string;
  contractId?: { _id: string; reference?: string; title?: string } | null;
  projectId?: { _id: string; name?: string } | null;
  result?: { offerAmount?: number; winnerName?: string; winnerAmount?: number; rank?: number; lossReason?: string; notes?: string };
}

const NEXT: Record<string, { to: string; label: string }> = {
  identified: { to: "preparing", label: "Démarrer la préparation" },
  preparing: { to: "submitted", label: "Marquer déposé" },
  submitted: { to: "evaluation", label: "Passer en évaluation" },
};

export default function AppelDetailPage() {
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const me = useMe();
  const canDelete = meCanDo(me, "appels", "delete");
  const canContract = meCanDo(me, "contracts", "create");
  const { id } = useParams();
  const router = useRouter();
  const [a, setA] = useState<Appel | null>(null);
  const [newDoc, setNewDoc] = useState("");
  const [clients, setClients] = useState<Array<{ _id: string; name: string }>>([]);
  const [award, setAward] = useState({ amount: "", clientId: "", project: true });
  const [busy, setBusy] = useState(false);
  // Résultat : la décision gagné / perdu se saisit avec son contexte (prix, attributaire, motif).
  const [resultFor, setResultFor] = useState<"won" | "lost" | null>(null);
  const [result, setResult] = useState({ offerAmount: "", winnerName: "", winnerAmount: "", rank: "", lossReason: "", notes: "" });
  const [cautions, setCautions] = useState<Array<{ _id: string; type: string; amount: number; status: string; expiryDate?: string }>>([]);
  useEffect(() => { apiJson(`/api/cautions?appelId=${id}`).then(d => setCautions(d?.data?.items ?? [])); }, [id]);

  const load = useCallback(() => {
    apiJson(`/api/appels/${id}`).then(d => setA(d.data || d));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const awardable = !!a && ["submitted", "evaluation", "won"].includes(a.status) && !a.contractId && canContract;
  useEffect(() => {
    if (!awardable) return;
    apiJson("/api/clients?picker=1&isActive=true").then(d => {
      const list: Array<{ _id: string; name: string }> = d?.data?.items ?? [];
      setClients(list);
      const match = list.find(c => c.name.trim().toLowerCase() === (a?.organism || "").trim().toLowerCase());
      setAward(w => ({ ...w, amount: w.amount || String(a?.estimatedAmount || ""), clientId: w.clientId || match?._id || "" }));
    });
  }, [awardable, a?.organism, a?.estimatedAmount]);

  async function toContract() {
    const amount = Math.round(Number(award.amount.replace(/\s/g, "")) || 0);
    if (!(amount > 0)) { showToast("Indiquez le montant attribué.", "warning"); return; }
    if (!award.clientId && !a!.organism) { showToast("Choisissez le client du marché.", "warning"); return; }
    if (!(await confirmDialog({ title: "Créer le marché ?", message: `Marché client de ${formatMoney(amount)} HT${award.project ? ", avec son projet d'exécution" : ""}. L'appel passe à « Gagné ».`, confirmLabel: "Créer le marché" }))) return;
    setBusy(true);
    try {
      const res = await apiSend("POST", `/api/appels/${id}/to-contract`, { amount, clientId: award.clientId || undefined, createProject: award.project });
      if (!res.ok) { showToast(res.data?.error || "Création refusée.", "error"); return; }
      showToast(`Marché ${res.data.data.reference ?? ""} créé${res.data.data.newClient ? ", client ajouté" : ""}.`, "success");
      router.push(`/contracts/${res.data.data.contractId}`);
    } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await apiSend("PATCH", `/api/appels/${id}`, body);
    if (res.ok) load(); else showToast((res.data).error || "Échec", "error");
  }
  async function del() {
    if (!(await confirmDialog({ title: "Supprimer cet appel ?", danger: true }))) return;
    const res = await apiSend("DELETE", `/api/appels/${id}`);
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
    if (file.size > 2_500_000) { showToast("Fichier trop lourd (2,5 Mo max).", "warning"); return; }
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
            <h1 className="page-title">{a.title}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
          </div>
          <p className="text-sm text-ink2">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {next && <button onClick={() => patch({ status: next.to })} className={buttonClass("primary", "md")}>{next.label} <ArrowRight size={15} /></button>}
          {["submitted", "evaluation"].includes(a.status) && <>
            <button onClick={() => setResultFor("won")} className="px-3 h-10 rounded-lg bg-pos text-onink text-sm font-semibold inline-flex items-center gap-1.5"><Trophy size={15} /> Gagné</button>
            <button onClick={() => setResultFor("lost")} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm inline-flex items-center gap-1.5"><X size={15} /> Perdu</button>
          </>}
          {!terminal && <button onClick={() => patch({ status: "cancelled" })} className="px-3 h-10 rounded-lg border border-line2 text-ink2 text-sm hover:bg-surface2 inline-flex items-center gap-1.5"><Ban size={14} /> Annuler</button>}
          {canDelete && <button onClick={del} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">Supprimer</button>}
        </div>
      </div>

      {a.result && (a.result.lossReason || a.result.winnerName || a.result.offerAmount) && (
        <div className="surface-card p-4 text-sm space-y-1">
          <p className="font-semibold text-ink">Résultat</p>
          {a.result.offerAmount ? <p><span className="text-ink2">Notre offre : </span>{formatMoney(a.result.offerAmount)}{a.result.rank ? ` · rang ${a.result.rank}` : ""}</p> : null}
          {a.result.winnerName ? <p><span className="text-ink2">Attributaire : </span>{a.result.winnerName}{a.result.winnerAmount ? ` · ${formatMoney(a.result.winnerAmount)}` : ""}</p> : null}
          {a.result.lossReason ? <p><span className="text-ink2">Motif du rejet : </span>{LOSS_LABEL[a.result.lossReason] ?? a.result.lossReason}</p> : null}
          {a.result.notes ? <p className="text-ink2 whitespace-pre-line">{a.result.notes}</p> : null}
          {a.status === "lost" && cautions.some(c => c.status === "active") && (
            <p className="text-warn pt-1">Offre perdue : demandez la mainlevée de la caution de soumission (elle coûte des commissions tant qu&apos;elle court).</p>
          )}
        </div>
      )}

      {resultFor && (
        <Modal open onClose={() => setResultFor(null)} title={resultFor === "won" ? "Offre retenue" : "Offre non retenue"}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Montant de notre offre (FCFA)"><input type="number" min={0} className={inputCls} value={result.offerAmount} onChange={e => setResult(r => ({ ...r, offerAmount: e.target.value }))} /></FormField>
              <FormField label="Rang obtenu"><input type="number" min={1} className={inputCls} value={result.rank} onChange={e => setResult(r => ({ ...r, rank: e.target.value }))} /></FormField>
            </div>
            {resultFor === "lost" && (<>
              <FormField label="Motif du rejet" required>
                <select className={selectCls} value={result.lossReason} onChange={e => setResult(r => ({ ...r, lossReason: e.target.value }))}>
                  <option value="">Choisir…</option>
                  {Object.entries(LOSS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Attributaire"><input className={inputCls} value={result.winnerName} onChange={e => setResult(r => ({ ...r, winnerName: e.target.value }))} /></FormField>
                <FormField label="Son prix (FCFA)"><input type="number" min={0} className={inputCls} value={result.winnerAmount} onChange={e => setResult(r => ({ ...r, winnerAmount: e.target.value }))} /></FormField>
              </div>
            </>)}
            <FormField label="Observations"><textarea className={textareaCls} rows={2} value={result.notes} onChange={e => setResult(r => ({ ...r, notes: e.target.value }))} /></FormField>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button onClick={() => setResultFor(null)} className={buttonClass("secondary", "md")}>Annuler</button>
              <button disabled={resultFor === "lost" && !result.lossReason}
                onClick={async () => { await patch({ status: resultFor, result }); setResultFor(null); }}
                className={buttonClass("primary", "md")}>Enregistrer le résultat</button>
            </div>
          </div>
        </Modal>
      )}

      {a.contractId && (
        <div className="surface-card p-4 flex flex-wrap items-center gap-3 text-sm">
          <Briefcase size={16} className="text-pos" />
          <span className="text-ink">Devenu le marché <Link href={`/contracts/${a.contractId._id}`} className="text-section font-semibold hover:underline">{a.contractId.reference || a.contractId.title}</Link></span>
          {a.projectId && <span className="text-ink2">· projet <Link href={`/projects/${a.projectId._id}`} className="text-section hover:underline">{a.projectId.name}</Link></span>}
        </div>
      )}

      {awardable && (
        <section className="surface-card p-5 space-y-3 border-pos/30">
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><Trophy size={16} className="text-pos" /> {a.status === "won" ? "Passer ce marché en exécution" : "Attribué ? Créez le marché"}</h2>
          <p className="text-xs text-ink2">Le contrat client et son projet d&apos;exécution sont créés d&apos;un coup : les dépenses s&apos;y imputent et les factures s&apos;y rattachent.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-ink">Montant attribué (HT)
              <input inputMode="numeric" className="w-full mt-1 p-2 border border-line rounded-lg text-sm text-right num bg-surface" value={award.amount} onChange={e => setAward(w => ({ ...w, amount: e.target.value }))} />
            </label>
            <label className="text-sm text-ink">Client
              <select className="w-full mt-1 p-2 border border-line rounded-lg text-sm bg-surface" value={award.clientId} onChange={e => setAward(w => ({ ...w, clientId: e.target.value }))}>
                {a.organism ? <option value="">{`${a.organism} (créé comme client)`}</option> : <option value="">— Choisir —</option>}
                {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <label className="text-sm text-ink2 inline-flex items-center gap-2"><input type="checkbox" className="accent-section" checked={award.project} onChange={e => setAward(w => ({ ...w, project: e.target.checked }))} /> Créer le projet d&apos;exécution</label>
          <div><button onClick={toContract} disabled={busy} className="px-4 h-10 rounded-lg bg-pos text-onink text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"><Briefcase size={15} /> {busy ? "…" : "Créer le marché"}</button></div>
        </section>
      )}

      {/* Date limite */}
      {dl && (
        <div className="surface-card p-4 flex items-center justify-between">
          <span className="text-sm text-ink2 flex items-center gap-2"><Clock size={16} /> Date limite de dépôt : <b className="text-ink">{a.submissionDeadline ? new Date(a.submissionDeadline).toLocaleDateString("fr-FR", { dateStyle: "long" }) : "—"}</b></span>
          <span className={`text-sm ${dl.cls}`}>{dl.text}</span>
        </div>
      )}

      <GoNoGoPanel appelId={String(id)} editable={!terminal && meCanDo(me, "appels", "update")}
        onDecision={async d => { if (d === "no_go" && a.status !== "cancelled" && await confirmDialog({ title: "Abandonner cet appel ?", message: "Décision No-Go : l'appel passe à « Annulé » et ne fera plus l'objet de rappels.", confirmLabel: "Abandonner" })) patch({ status: "cancelled" }); }} />

      {/* Cautions bancaires */}
      <section className="surface-card p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">Cautions bancaires</h2>
          <Link href={`/cautions?appelId=${id}&new=1`} className="text-sm text-section font-semibold hover:underline inline-flex items-center gap-1"><Plus size={14} /> Ajouter</Link>
        </div>
        {cautions.length === 0 ? <p className="text-sm text-ink3">Aucune caution (soumission, bonne exécution…) liée à cet appel.</p> : (
          <ul className="divide-y divide-line text-sm">
            {cautions.map(c => (
              <li key={c._id} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 text-ink">{GUARANTEE_TYPES[c.type as keyof typeof GUARANTEE_TYPES] ?? c.type}</span>
                <span className="text-xs text-ink2">{c.status === "active" ? (c.expiryDate ? `échéance ${new Date(c.expiryDate).toLocaleDateString("fr-FR")}` : "en cours") : c.status === "released" ? "mainlevée" : "appelée"}</span>
                <span className="num font-semibold">{formatMoney(c.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          <button onClick={addReq} className="px-3 h-9 rounded-lg bg-ink text-onink text-sm inline-flex items-center gap-1"><Plus size={14} /> Ajouter</button>
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
        <label className={buttonClass("secondary", "md", "cursor-pointer")}>
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
