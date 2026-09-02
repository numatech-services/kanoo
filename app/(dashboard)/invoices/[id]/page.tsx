"use client";


import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { PaymentForm } from "@/components/pme/PaymentForm";

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
}



export default function InvoiceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  
  


  const [user, setUser] = useState<{ firstName: string; lastName: string } | null>(null);
  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
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
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (res.ok) { setPaymentOpen(false); load(); }
  }

  async function sendInvoice() {
    if (!confirm("Marquer cette facture comme émise ?")) return;
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    await fetch(`/api/invoices/${id}/send`, { method: "POST", headers: { "x-csrf-token": csrfToken }, credentials: "include" });
    load();
  }

  async function cancelInvoice() {
    if (!confirm("Annuler cette facture ? Cette action est irréversible.")) return;
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    await fetch(`/api/invoices/${id}/cancel`, { method: "POST", headers: { "x-csrf-token": csrfToken }, credentials: "include" });
    load();
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-xl animate-pulse border border-clay/20" /></div>;
  if (!invoice) return <div className="p-6 text-moss">Facture introuvable</div>;

  const remaining = Math.max(0, invoice.totalTTC - invoice.paidAmount);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.push("/invoices")} className="text-xs text-moss hover:text-ink">
            Retour aux factures
          </button>
          <h1 className="text-2xl font-bold text-ink mt-1">{invoice.number}</h1>
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button
            onClick={() => router.push(`/invoices/${id}/edit`)}
            className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand"
          >
            Modifier
          </button>

          {/* Remplacement du lien <a> par le bouton d'impression directe */}
          <button
            onClick={handlePrintDirect}
            disabled={isPrinting}
            className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand transition-colors disabled:opacity-50"
          >
            {isPrinting ? "Préparation..." : "Imprimer"}
          </button>

          {invoice.status === "draft" && (
            <button onClick={sendInvoice} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
              Émettre
            </button>
          )}
          {["sent", "partial"].includes(invoice.status) && remaining > 0 && (
            <button onClick={() => setPaymentOpen(true)} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">
              Paiement
            </button>
          )}
          {["draft", "sent"].includes(invoice.status) && (
            <button onClick={cancelInvoice} className="px-4 py-2 border border-red-300 text-red-600 rounded-xl text-sm hover:bg-red-50">
              Annuler
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-clay/20 p-4 flex flex-wrap gap-6">
        <div><p className="text-xs text-moss">Statut</p><div className="mt-1"><StatusBadge status={invoice.status}/></div></div>
        <div><p className="text-xs text-moss">Émission</p><p className="font-medium text-ink mt-1 text-sm">{new Date(invoice.issueDate).toLocaleDateString("fr-FR")}</p></div>
        <div><p className="text-xs text-moss">Échéance</p>
          <p className={`font-medium mt-1 text-sm ${invoice.status !== "paid" && new Date(invoice.dueDate) < new Date() ? "text-red-600" : "text-ink"}`}>
            {new Date(invoice.dueDate).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div><p className="text-xs text-moss">Total TTC</p><p className="font-mono font-bold text-ink mt-1">{invoice.totalTTC.toLocaleString("fr-FR")} XOF</p></div>
        <div><p className="text-xs text-moss">Encaissé</p><p className="font-mono font-bold text-green-700 mt-1">{invoice.paidAmount.toLocaleString("fr-FR")} XOF</p></div>
        {remaining > 0 && <div><p className="text-xs text-moss">Reste dû</p><p className="font-mono font-bold text-red-600 mt-1">{remaining.toLocaleString("fr-FR")} XOF</p></div>}
      </div>

      {invoice.clientId && (
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss font-semibold uppercase tracking-wide mb-2">Client</p>
          <p className="font-semibold text-ink">{invoice.clientId.name}</p>
          {invoice.clientId.nif && <p className="text-xs text-moss mt-0.5">NIF : {invoice.clientId.nif}</p>}
          {invoice.clientId.address && <p className="text-xs text-moss mt-0.5">{invoice.clientId.address}</p>}
        </div>
      )}

      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-sand/50">
              {["Description", "Volume", "P.U. HT", "TVA", "Total TTC"].map((h, index) => (
                <th key={h} className={`px-4 py-2 text-xs font-semibold text-moss uppercase ${index === 1 || index === 3 ? "text-center" : index === 2 || index === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i} className="border-t border-clay/10">
                <td className="px-4 py-3">{line.description}</td>
                <td className="px-4 py-3 text-moss text-center">{line.quantity}</td>
                <td className="px-4 py-3 font-mono text-moss text-right">{line.unitPrice.toLocaleString("fr-FR")}</td>
                <td className="px-4 py-3 text-moss text-center">{Math.round(line.tvaRate * 100)}%</td>
                <td className="px-4 py-3 font-mono font-semibold text-right">{line.totalTTC.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-clay/20 p-4 flex justify-end">
          <div className="w-56 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-moss">Sous-total HT</span>
              <span className="font-mono">{invoice.totalHT.toLocaleString("fr-FR")} XOF</span>
            </div>
            {invoice.totalTVA > 0 && (
              <div className="flex justify-between">
                <span className="text-moss">TVA</span>
                <span className="font-mono">{invoice.totalTVA.toLocaleString("fr-FR")} XOF</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-clay/20 pt-2 text-base">
              <span>Total TTC</span>
              <span className="font-mono text-cedar">{invoice.totalTTC.toLocaleString("fr-FR")} XOF</span>
            </div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss font-semibold uppercase tracking-wide mb-2">Notes</p>
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
                  <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{line.totalTTC.toLocaleString("fr-FR")} XOF</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* SECTION CALCULS FINAUX */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: "260px", gap: "8px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                <span>Sous-total HT :</span>
                <span>{invoice.totalHT.toLocaleString("fr-FR")} XOF</span>
              </div>
              {invoice.totalTVA > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                  <span>TVA :</span>
                  <span>{invoice.totalTVA.toLocaleString("fr-FR")} XOF</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #333", paddingTop: "8px", fontSize: "14px", fontWeight: "bold", color: "#000" }}>
                <span>TOTAL TTC :</span>
                <span>{invoice.totalTTC.toLocaleString("fr-FR")} XOF</span>
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
    </div>
  );
}