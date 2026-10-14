"use client";


import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CreditNoteDialog } from "@/components/pme/CreditNoteDialog";
import { Modal } from "@/components/ui/Modal";
import { PaymentForm } from "@/components/pme/PaymentForm";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson, api, apiErrorMessage, apiSend } from "@/lib/api-client";
import { RefundPanel } from "@/components/invoices/RefundPanel";
import { showToast } from "@/components/ui/Toast";
interface InvoiceLine { 
  description: string; 
  quantity: number; 
  unitPrice: number; 
  tvaRate: number; 
  discount: number; 
  totalHT: number; 
  totalTVA: number; 
  totalTTC: number; 
}

interface Invoice { 
  _id: string; 
  number: string; 
  clientId: { name: string; code: string; nif?: string; address?: string } | null; 
  lines: InvoiceLine[]; 
  totalHT: number; 
  totalTVA: number; 
  totalTTC: number; 
  paidAmount: number; 
  status: string; 
  issueDate: string; 
  dueDate: string; 
  notes?: string; 
  /** Litige ouvert : suspend les relances automatiques. */
  disputedAt?: string;
  disputeReason?: string;
  documentType?: "invoice" | "credit_note";
  originalInvoiceId?: string;
  creditReason?: string;
  creditedAmount?: number;
  /** Retenue de garantie du marché (non exigible avant la réception définitive). */
  retentionAmount?: number;
  retentionRate?: number;
  contractId?: string | { _id: string; reference?: string };
}



export default function InvoiceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [creditOpen, setCreditOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningNote, setDunningNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  
  


  const [user, setUser] = useState<{ firstName: string; lastName: string } | null>(null);
  useEffect(() => {
    setMounted(true);
    apiJson("/api/auth/me")
      .then((d) => setUser(d.data?.user || null))
      .catch(() => {});
  }, []);

  









  // État de gestion pour l'état d'impression
  const [isPrinting, setIsPrinting] = useState(false);

 const load = useCallback(async () => {
  setLoading(true);
  try {
    const res = await fetch(`/api/invoices/${id}`, { 
      credentials: "include",
      cache: "no-store" //   mis à jour
    });
    const d = await res.json();
    setInvoice(d.data || d);
  } catch (err) {
    console.error("Erreur de récupération :", err);
  } finally {
    setLoading(false);
  }
}, [id]);


  useEffect(() => { 
    setMounted(true); 
    load(); 
  }, [load]);

  if (!mounted) return null;

  // Déclencheur natif window.print
  const handlePrintDirect = () => {
    setIsPrinting(true);
    // On attend un court instant pour laisser l'interface se stabiliser si nécessaire
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  };

  async function handlePayment(data: Record<string, unknown>) {
    const res = await apiSend("POST", "/api/payments", data);
    // Un refus (montant, date, compte…) s'affiche dans le formulaire au lieu de ne rien faire.
    if (!res.ok) { const d = res.data; throw new Error(d.error || "Paiement refusé"); }
    setPaymentOpen(false); load();
  }

  async function relancer() {
    setDunningBusy(true);
    setDunningNote(null);
    const res = await apiSend("POST", `/api/invoices/${id}/relance`, { tone: "reminder", channels: ["email"] });
    const d = res.data;
    // Un échec d'envoi doit se lire : une relance qu'on croit partie et qui
    // n'est jamais arrivée est pire que pas de relance du tout.
    setDunningNote({ ok: res.ok, text: res.ok ? d.data.message : (d.error || "Envoi impossible") });
    setDunningBusy(false);
  }

  async function toggleLitige() {
    const open = !invoice?.disputedAt;
    const reason = open
      ? await promptDialog({ title: "Que conteste le client ?\nSans motif, personne ne saura de quoi il s'agissait dans trois mois.", multiline: true })
      : null;
    if (open && !reason?.trim()) return;

    setDunningBusy(true);
    const res = await apiSend("POST", `/api/invoices/${id}/litige`, { open, reason });
    const d = res.data;
    setDunningNote({ ok: res.ok, text: res.ok ? d.data.message : (d.error || "Action impossible") });
    setDunningBusy(false);
    if (res.ok) load();
  }

  async function sendInvoice() {
    if (!(await confirmDialog({ title: "Émettre cette facture ?", message: "Elle devient opposable et entre en comptabilité (écriture de vente)." }))) return;
    try { await api.post(`/api/invoices/${id}/send`); showToast("Facture émise et comptabilisée.", "success"); }
    catch (e) { showToast(apiErrorMessage(e, "Émission impossible."), "error"); }
    load();
  }

  async function cancelInvoice() {
    if (!(await confirmDialog({ title: "Annuler cette facture ?", message: "Cette action est irréversible.", danger: true }))) return;
    try { await api.post(`/api/invoices/${id}/cancel`); showToast("Facture annulée.", "success"); }
    catch (e) { showToast(apiErrorMessage(e, "Annulation impossible."), "error"); }
    load();
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  if (!invoice) return <div className="p-6 text-ink2">Facture introuvable</div>;

  // Reste à payer net des avoirs déjà émis.
  const remaining = Math.max(0, invoice.totalTTC - (invoice.creditedAmount || 0) - invoice.paidAmount - (invoice.status === "cancelled" ? 0 : invoice.retentionAmount || 0));
  const credited = invoice.creditedAmount || 0;
  const isCreditNote = invoice.documentType === "credit_note";

  return (
    <div className="space-y-5 max-w-4xl">
      {isCreditNote && (
        <p className="px-4 py-3 rounded-xl bg-neg-50 border border-neg/25 text-sm text-neg">
          <strong>Facture d&apos;avoir.</strong> Ce document se retranche du chiffre
          d&apos;affaires.
          {invoice.creditReason && <> Motif&nbsp;: {invoice.creditReason}.</>}
        </p>
      )}
      {isCreditNote && <RefundPanel creditNoteId={invoice._id} onDone={load} />}
      {!isCreditNote && credited > 0 && (
        <p className="px-4 py-3 rounded-xl bg-warn-50 border border-warn/25 text-sm text-warn">
          <strong className="num">{credited.toLocaleString("fr-FR")} FCFA</strong> déjà
          couverts par un ou plusieurs avoirs
          {credited >= invoice.totalTTC ? " — cette facture est intégralement créditée." : "."}
        </p>
      )}
      {invoice.disputedAt && (
        <p className="px-4 py-3 rounded-xl bg-warn-50 border border-warn/25 text-sm text-warn">
          <strong>Litige ouvert</strong> depuis le{" "}
          {new Date(invoice.disputedAt).toLocaleDateString("fr-FR")}. Les relances
          automatiques sont suspendues sur cette facture.
          {invoice.disputeReason && <> Motif&nbsp;: {invoice.disputeReason}.</>}
        </p>
      )}
      {dunningNote && (
        <p className={`px-4 py-3 rounded-xl text-sm border ${
          dunningNote.ok ? "bg-pos-50 border-pos/25 text-pos" : "bg-neg-50 border-neg/25 text-neg"
        }`}>
          {dunningNote.text}
        </p>
      )}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.push("/invoices")} className="text-xs text-ink2 hover:text-ink">
            Retour aux factures
          </button>
          <h1 className="page-title mt-1">{invoice.number}</h1>
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button
            onClick={() => router.push(`/invoices/${id}/edit`)}
            className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2"
          >
            Modifier
          </button>

          {/* Remplacement du lien <a> par le bouton d'impression directe */}
          <button
            onClick={handlePrintDirect}
            disabled={isPrinting}
            className={buttonClass("secondary", "md")}
          >
            {isPrinting ? "Préparation..." : "Imprimer"}
          </button>

          {invoice.status === "draft" && (
            <button onClick={sendInvoice} className="px-4 py-2 bg-info text-white rounded-xl text-sm font-medium hover:brightness-95">
              Émettre
            </button>
          )}
          {["sent", "partial"].includes(invoice.status) && remaining > 0 && (
            <button onClick={() => setPaymentOpen(true)} className="px-4 py-2 bg-pos text-white rounded-xl text-sm font-medium hover:brightness-95">
              Paiement
            </button>
          )}
          {!isCreditNote && ["sent", "partial", "overdue"].includes(invoice.status) && remaining > 0 && (
            <>
              <button onClick={relancer} disabled={dunningBusy}
                className={buttonClass("secondary", "md")}>
                {dunningBusy ? "Envoi…" : "Relancer"}
              </button>
              <button onClick={toggleLitige} disabled={dunningBusy}
                className={`px-4 py-2 rounded-xl text-sm disabled:opacity-50 ${
                  invoice.disputedAt
                    ? "bg-warn text-white hover:brightness-95"
                    : "border border-line text-ink2 hover:bg-surface2"
                }`}>
                {invoice.disputedAt ? "Clore le litige" : "Litige"}
              </button>
            </>
          )}
          {/* Un brouillon s'annule ; une facture émise ne s'annule plus, elle
              se corrige par un avoir. Les deux actions ne coexistent jamais. */}
          {invoice.status === "draft" && (
            <button onClick={cancelInvoice} className="px-4 py-2 border border-neg/40 text-neg rounded-xl text-sm hover:bg-neg-50">
              Annuler le brouillon
            </button>
          )}
          {invoice.documentType !== "credit_note"
            && ["sent", "partial", "paid", "overdue"].includes(invoice.status)
            && (invoice.creditedAmount || 0) < invoice.totalTTC && (
            <button onClick={() => setCreditOpen(true)}
              className="px-4 py-2 border border-neg/40 text-neg rounded-xl text-sm font-medium hover:bg-neg-50">
              Émettre un avoir
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-line p-4 flex flex-wrap gap-6">
        <div><p className="text-xs text-ink2">Statut</p><div className="mt-1"><StatusBadge status={invoice.status}/></div></div>
        <div><p className="text-xs text-ink2">Émission</p><p className="font-medium text-ink mt-1 text-sm">{new Date(invoice.issueDate).toLocaleDateString("fr-FR")}</p></div>
        <div><p className="text-xs text-ink2">Échéance</p>
          <p className={`font-medium mt-1 text-sm ${invoice.status !== "paid" && new Date(invoice.dueDate) < new Date() ? "text-neg" : "text-ink"}`}>
            {new Date(invoice.dueDate).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div><p className="text-xs text-ink2">Total TTC</p><p className="font-mono font-bold text-ink mt-1">{invoice.totalTTC.toLocaleString("fr-FR")} FCFA</p></div>
        {(invoice.retentionAmount ?? 0) > 0 && <div><p className="text-xs text-ink2" title="Gardée par le client jusqu'à la réception définitive du marché">Retenue de garantie ({Math.round((invoice.retentionRate ?? 0) * 1000) / 10} %)</p><p className="font-mono font-bold text-ink2 mt-1">{(invoice.retentionAmount ?? 0).toLocaleString("fr-FR")} FCFA</p></div>}
        <div><p className="text-xs text-ink2">Encaissé</p><p className="font-mono font-bold text-pos mt-1">{invoice.paidAmount.toLocaleString("fr-FR")} FCFA</p></div>
        {remaining > 0 && <div><p className="text-xs text-ink2">Reste dû</p><p className="font-mono font-bold text-neg mt-1">{remaining.toLocaleString("fr-FR")} FCFA</p></div>}
      </div>

      {invoice.clientId && (
        <div className="bg-surface rounded-xl border border-line p-4">
          <p className="text-xs text-ink2 font-semibold uppercase tracking-wide mb-2">Client</p>
          <p className="font-semibold text-ink">{invoice.clientId.name}</p>
          {invoice.clientId.nif && <p className="text-xs text-ink2 mt-0.5">NIF : {invoice.clientId.nif}</p>}
          {invoice.clientId.address && <p className="text-xs text-ink2 mt-0.5">{invoice.clientId.address}</p>}
        </div>
      )}

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
        <table className="table-dense">
          <thead>
            <tr className="bg-surface2/50">
              {["Description", "Volume", "P.U. HT", "TVA", "Total TTC"].map((h, index) => (
                <th key={h} className={`px-4 py-2 text-xs font-semibold text-ink2 uppercase ${index === 1 || index === 3 ? "text-center" : index === 2 || index === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-4 py-3">{line.description}</td>
                <td className="px-4 py-3 text-ink2 text-center">{line.quantity}</td>
                <td className="px-4 py-3 font-mono text-ink2 text-right">{line.unitPrice.toLocaleString("fr-FR")}</td>
                <td className="px-4 py-3 text-ink2 text-center">{Math.round(line.tvaRate * 100)}%</td>
                <td className="px-4 py-3 font-mono font-semibold text-right">{line.totalTTC.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <div className="border-t border-line p-4 flex justify-end">
          <div className="w-56 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-ink2">Sous-total HT</span>
              <span className="font-mono">{invoice.totalHT.toLocaleString("fr-FR")} FCFA</span>
            </div>
            {invoice.totalTVA > 0 && (
              <div className="flex justify-between">
                <span className="text-ink2">TVA</span>
                <span className="font-mono">{invoice.totalTVA.toLocaleString("fr-FR")} FCFA</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-line pt-2 text-base">
              <span>Total TTC</span>
              <span className="font-mono text-section">{invoice.totalTTC.toLocaleString("fr-FR")} FCFA</span>
            </div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-surface rounded-xl border border-line p-4">
          <p className="text-xs text-ink2 font-semibold uppercase tracking-wide mb-2">Notes</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      )}

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Enregistrer un paiement" size="md">
        <PaymentForm invoiceId={invoice._id} remainingAmount={remaining} onSave={handlePayment} onCancel={() => setPaymentOpen(false)} />
      </Modal>

      {/* ── ZONE FANTÔME D'IMPRESSION PROPRE (SÉCURISÉE CONTRE LES PAGES BLANCHES) ── */}
      <div className="screen-hidden-only">
        <style>{`
          .screen-hidden-only {
            display: none;
          }

          @media print {
            body * { 
              visibility: hidden; 
            }
            
            .screen-hidden-only, .screen-hidden-only * { 
              visibility: visible; 
            }
            
            .screen-hidden-only {
              display: block !important;
              position: absolute; 
              left: 0; 
              top: 0; 
              width: 100%; 
              background: #ffffff !important; 
              color: #000000 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            
            tr { page-break-inside: avoid; }
          }
        `}</style>

        <div style={{ padding: "40px", fontFamily: "sans-serif", fontSize: "12px", color: "#111" }}>
          {/* EN-TÊTE DE LA FACTURE */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px" }}>
            
            <div>
          {/* NOM ET PRÉNOM DE L'UTILISATEUR CONNECTÉ */}
          <div style={{ textAlign: "left", marginBottom: "8px" }}>
            <p style={{ fontSize: "14px", fontWeight: "500", color: "#111", margin: 0, lineHeight: 1 }}>
              {user ? `${user.firstName || ""} ${user.lastName || ""}` : ""}
            </p>
          </div>
          <p style={{ margin: 0, color: "#555" }}>Niamey, Niger</p>
        </div>
            <div style={{ textAlign: "right" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: "0 0 5px 0", letterSpacing: "1px" }}>FACTURE</h2>
              <p style={{ margin: "0 0 10px 0", fontFamily: "monospace", fontSize: "13px" }}><b>{invoice.number || "—"}</b></p>
              <p style={{ margin: "2px 0", color: "#555" }}>Émise le : {new Date(invoice.issueDate).toLocaleDateString("fr-FR")}</p>
              <p style={{ margin: "2px 0", color: "#555" }}>Échéance : {new Date(invoice.dueDate).toLocaleDateString("fr-FR")}</p>
            </div>
          </div>

          {/* COORDONNÉES CLIENT */}
          {invoice.clientId && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "30px" }}>
              <div style={{ textAlign: "right", width: "280px" }}>
                <h3 style={{ fontSize: "10px", fontWeight: "bold", color: "#999", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 5px 0" }}>Facturé à</h3>
                <p style={{ fontSize: "14px", fontWeight: "bold", margin: "0 0 4px 0" }}>{invoice.clientId.name}</p>
                {invoice.clientId.nif && <p style={{ margin: "2px 0", color: "#444" }}>NIF: {invoice.clientId.nif}</p>}
                {invoice.clientId.address && <p style={{ margin: "2px 0", color: "#444" }}>{invoice.clientId.address}</p>}
              </div>
            </div>
          )}

          {/* TABLEAU DES ARTICLES */}
          <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "30px" }}>
            <thead>
              <tr style={{ background: "#f5f5f5", borderBottom: "2px solid #ddd", textAlign: "left", fontSize: "11px", fontWeight: "bold" }}>
                <th style={{ padding: "10px 12px" }}>Description</th>
                <th style={{ padding: "10px 12px", textAlign: "center", width: "60px" }}>Volume</th>
                <th style={{ padding: "10px 12px", textAlign: "right", width: "100px" }}>P.U. HT</th>
                <th style={{ padding: "10px 12px", textAlign: "right", width: "120px" }}>Total TTC</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "10px 12px" }}>{line.description}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>{line.quantity}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>{line.unitPrice.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{line.totalTTC.toLocaleString("fr-FR")} FCFA</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          {/* SECTION CALCULS FINAUX */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: "260px", gap: "8px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                <span>Sous-total HT :</span>
                <span>{invoice.totalHT.toLocaleString("fr-FR")} FCFA</span>
              </div>
              {invoice.totalTVA > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                  <span>TVA :</span>
                  <span>{invoice.totalTVA.toLocaleString("fr-FR")} FCFA</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #333", paddingTop: "8px", fontSize: "14px", fontWeight: "bold", color: "#000" }}>
                <span>TOTAL TTC :</span>
                <span>{invoice.totalTTC.toLocaleString("fr-FR")} FCFA</span>
              </div>
            </div>
          </div>
          
          {/* NOTES DE CONDITIONS */}
          {invoice.notes && (
            <div style={{ marginTop: "40px", borderTop: "1px solid #eee", paddingTop: "15px" }}>
              <p style={{ margin: "0 0 5px 0", fontWeight: "bold", color: "#555" }}>Notes & Conditions :</p>
              <p style={{ margin: 0, color: "#666", fontStyle: "italic" }}>{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
      {/* Bon de commande du client, procès-verbal de réception, justificatif
          de virement : les pièces qui rendent la facture défendable en cas de
          contestation, rangées avec elle plutôt que dans une boîte mail. */}
      <div className="print:hidden">
        <AttachmentPanel
          host="invoices"
          hostId={String(id)}
          title="Pièces du dossier"
          hint="Bon de commande, PV de réception, preuve de règlement."
          categories={["facture", "justificatif", "courrier", "autre"]}
          defaultCategory="justificatif"
        />
      </div>

      <CreditNoteDialog
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        invoiceId={String(id)}
        invoiceNumber={invoice.number}
        totalTTC={invoice.totalTTC}
        creditedAmount={credited}
        lines={invoice.lines}
        onIssued={load}
      />
    </div>
  );
}