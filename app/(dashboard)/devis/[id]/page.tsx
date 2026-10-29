"use client";
import Link from "next/link";

import { Fragment, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { DevisForm } from "@/components/pme/DevisForm";
import { ClaudeQuoteAssistant } from "@/components/docs/ClaudeQuoteAssistant";
import { useMe, meCanDo } from "@/lib/useMe";
import { ToMarketDialog } from "@/components/devis/ToMarketDialog";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
import { PageLoading, PageError } from "@/components/ui/PageState";

interface DevisLine {
  description?: string; details?: string; section?: string; unit?: string;
  quantity?: number; unitPrice?: number; discount?: number; tvaRate?: number;
  totalHT?: number; totalTVA?: number; totalTTC?: number;
}

// Devis tel que renvoyé par /api/devis/[id] (client peuplé)
interface DevisDetail {
  _id: string;
  number: string;
  status: string;
  docKind?: "devis" | "proforma";
  contractId?: string;
  convertedToInvoiceId?: string;
  clientId?: { _id?: string; name?: string } | null;
  totalHT: number;
  totalTVA?: number;
  totalTTC?: number;
  issueDate?: string;
  validUntil?: string;
  object?: string; reference?: string; period?: string; attention?: string;
  termsAndConditions?: string; notes?: string;
  lines?: DevisLine[];
}

const fcfa = (n?: number) => `${Math.round(n ?? 0).toLocaleString("fr-FR")} FCFA`;

export default function DevisDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canDeleteDevis = meCanDo(me, "devis", "delete");
  const canEditDevis = meCanDo(me, "devis", "update");
  const canMarket = meCanDo(me, "contracts", "create");
  const canInvoice = meCanDo(me, "invoices", "create");
  const [converting, setConverting] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [item, setItem] = useState<DevisDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    apiJson(`/api/devis/${id}`)
      .then(d => {
        // Lecture refusée (devis introuvable, réseau) : un message et « Réessayer », pas une page blanche.
        if (!d?.data) { setLoadError(d?.error || "Devis introuvable."); return; }
        setLoadError("");
        setItem(d.data);
      });
  }, [id, attempt]);

  async function handleSave(body: Record<string, unknown>) {
    const res = await apiSend("PATCH", `/api/devis/${id}`, body);
    if (!res.ok) throw new Error(res.data?.error || "Enregistrement impossible");
    // Le client reste peuplé à l'affichage : relecture complète.
    const fresh = await apiJson(`/api/devis/${id}`);
    setItem(fresh?.data ?? res.data.data);
    setEditOpen(false);
    showToast(body.docKind === "proforma" ? "Proforma enregistrée" : "Devis enregistré", "success");
  }

  // Le devis n'arrive qu'après le montage : squelette, ou l'erreur de lecture.
  if (!item) return loadError ? <PageError message={loadError} onRetry={() => { setLoadError(""); setAttempt(a => a + 1); }} /> : <PageLoading />;
  const isProforma = item.docKind === "proforma";
  const mentions = ([["Objet", item.object], ["Référence", item.reference], ["Période", item.period], ["À l'attention de", item.attention]] as const).filter(([, v]) => v);

  return (
    <div className="space-y-6 max-w-5xl p-4">
      {/* SECTION EN-TÊTE */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <button onClick={() => router.back()} className="text-xs text-ink2 hover:underline italic">← Retour</button>
          <h1 className="page-title mt-1">{isProforma ? "Proforma" : "Devis"} {item.number}</h1>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {item.contractId
            ? <a href={`/contracts/${item.contractId}`} className="px-5 py-2.5 border border-section/30 text-section rounded-2xl font-bold hover:bg-section-soft">Voir le marché</a>
            : canMarket && !["rejected", "expired"].includes(item.status) && <button onClick={() => setMarketOpen(true)} className={buttonClass("primary", "md")}>Créer le marché</button>}
          {item.convertedToInvoiceId
            ? <Link href={`/invoices/${item.convertedToInvoiceId}`} className={buttonClass("secondary", "md")}>Voir la facture</Link>
            : !item.contractId && canInvoice && !["rejected", "expired"].includes(item.status) && (
              <button disabled={converting} onClick={async () => {
                if (!(await confirmDialog({ title: "Transformer en facture ?", message: "Un brouillon de facture reprend les lignes, mentions et conditions du devis. Il prendra son numéro définitif à l'émission." }))) return;
                setConverting(true);
                const res = await apiSend("POST", `/api/devis/${id}/to-invoice`, { type: "invoice" });
                setConverting(false);
                if (res.ok) router.push(`/invoices/${res.data.data.invoice._id}`); else showToast(res.data?.error || "Transformation impossible", "error");
              }} className={buttonClass("primary", "md")}>Transformer en facture</button>
            )}
          <a href={`/api/devis/${item._id}/pdf`} target="_blank" rel="noopener"
            className={buttonClass("secondary", "md")}>
            {isProforma ? "PDF proforma" : "PDF devis"}
          </a>
          <a href={`/api/devis/${item._id}/pdf?proforma=${isProforma ? 0 : 1}`} target="_blank" rel="noopener"
            className={buttonClass("ghost", "md")} title="Le même document, sous l'autre intitulé">
            {isProforma ? "En devis" : "En proforma"}
          </a>
          {canEditDevis && !item.convertedToInvoiceId && (
            <select value={item.status} onChange={async e => {
              const res = await apiSend("PATCH", `/api/devis/${id}`, { status: e.target.value });
              const d = res.data;
              if (res.ok) setItem(d.data); else showToast(d.error || "Changement impossible", "error");
            }} className="h-11 px-3 rounded-2xl border border-line2 text-sm font-semibold" aria-label="Statut du devis">
              <option value="draft">Brouillon</option><option value="sent">Envoyé</option><option value="accepted">Accepté</option>
              <option value="rejected">Refusé</option><option value="expired">Expiré</option>
            </select>
          )}
          {canDeleteDevis && !item.convertedToInvoiceId && !item.contractId && (
            <button onClick={async () => {
              if (!(await confirmDialog({ title: isProforma ? "Supprimer cette proforma ?" : "Supprimer ce devis ?", danger: true }))) return;
              const res = await apiSend("DELETE", `/api/devis/${id}`);
              if (res.ok) router.push("/devis"); else { const d = res.data; showToast(d.error || "Suppression impossible", "error"); }
            }} className={buttonClass("danger", "md")}>Supprimer</button>
          )}
          {canEditDevis && !item.convertedToInvoiceId && !item.contractId && (
            <button onClick={() => setEditOpen(true)} className={buttonClass("primary", "md")}>
              Modifier
            </button>
          )}
        </div>
      </div>

      {/* MODE VUE : AFFICHAGE DE TOUS LES DÉTAILS */}
      <div className="bg-surface rounded-[2rem] border border-line p-8 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Client</p>
            <p className="text-lg font-bold text-ink italic">{item.clientId?.name || "Client"}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Total Hors Taxe</p>
            <p className="text-lg font-semibold text-ink">{fcfa(item.totalHT)}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">TVA</p>
            <p className="text-lg font-semibold text-ink2">{fcfa(item.totalTVA)}</p>
          </div>
          <div>
            <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-1">Total TTC</p>
            <p className="text-2xl font-black text-section">{fcfa(item.totalTTC)}</p>
          </div>
        </div>
      </div>

      {(mentions.length > 0 || item.issueDate) && (
        <div className="bg-surface rounded-2xl border border-line p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><span className="text-ink2">Date : </span>{item.issueDate ? new Date(item.issueDate).toLocaleDateString("fr-FR") : "—"}</div>
          <div><span className="text-ink2">Validité : jusqu&apos;au </span>{item.validUntil ? new Date(item.validUntil).toLocaleDateString("fr-FR") : "—"}</div>
          {mentions.map(([k, v]) => <div key={k} className={k === "Objet" ? "sm:col-span-2" : ""}><span className="text-ink2">{k} : </span>{v}</div>)}
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-line overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead><tr className="text-left text-xs text-ink2 border-b border-line">
            <th className="p-3 w-8">N°</th><th className="p-3">Désignation</th><th className="p-3 text-right">Qté</th><th className="p-3 text-right">P.U. HT</th><th className="p-3 text-right">Total HT</th>
          </tr></thead>
          <tbody>
            {(item.lines ?? []).map((l, i, all) => (
              <Fragment key={i}>
                {l.section && l.section !== all[i - 1]?.section && (
                  <tr className="bg-surface2"><td colSpan={5} className="px-3 py-1.5 text-xs font-bold text-section uppercase tracking-wide">{l.section}</td></tr>
                )}
                <tr className="border-b border-line/60 align-top">
                  <td className="p-3 text-ink2">{i + 1}</td>
                  <td className="p-3"><p className="font-semibold text-ink">{l.description}</p>{l.details && <p className="text-xs text-ink2 whitespace-pre-line mt-0.5">{l.details}</p>}</td>
                  <td className="p-3 text-right whitespace-nowrap">{l.quantity?.toLocaleString("fr-FR")} {l.unit ?? ""}</td>
                  <td className="p-3 text-right font-mono whitespace-nowrap">{l.unitPrice?.toLocaleString("fr-FR")}</td>
                  <td className="p-3 text-right font-mono whitespace-nowrap">{l.totalHT?.toLocaleString("fr-FR")}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {(item.termsAndConditions || item.notes) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {item.termsAndConditions && <div className="bg-surface rounded-2xl border border-line p-4"><p className="text-xs text-ink2 mb-1">Conditions imprimées</p><p className="whitespace-pre-line">{item.termsAndConditions}</p></div>}
          {item.notes && <div className="bg-surface2 rounded-2xl border border-line p-4"><p className="text-xs text-ink2 mb-1">Notes internes</p><p className="whitespace-pre-line">{item.notes}</p></div>}
        </div>
      )}

      {/* MODIFICATION : le même formulaire qu'à la création (mentions, postes, descriptifs, conditions). */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={isProforma ? "Modifier la proforma" : "Modifier le devis"} size="xl">
        {editOpen && (
          <DevisForm
            initial={{ ...item, clientId: item.clientId?._id ?? "" } as unknown as Record<string, unknown>}
            draftKey={`devis-${item._id}`}
            onSave={handleSave}
            onCancel={() => setEditOpen(false)}
            assistant={(fill, ctx) => <ClaudeQuoteAssistant fill={fill} docKind={ctx.docKind} filledLines={ctx.filledLines} />}
          />
        )}
      </Modal>
      {marketOpen && <ToMarketDialog devis={item} onClose={() => setMarketOpen(false)} />}
    </div>
  );
}