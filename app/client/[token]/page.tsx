"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, CreditCard, CheckCircle2, AlertTriangle, Phone, Mail } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/format";
import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";

interface Portal {
  supplier: { name?: string; logo?: string; phone?: string; email?: string; address?: string; color?: string; paymentInstructions?: string };
  client: { name: string };
  totals: { due: number; overdue: number };
  invoices: Array<{ _id: string; number: string; issueDate: string; dueDate: string; totalTTC: number; due: number; status: string; canPay: boolean }>;
  creditNotes: Array<{ _id: string; number: string; issueDate: string; totalTTC: number }>;
  quotes: Array<{ _id: string; number: string; issueDate: string; validUntil: string; totalTTC: number; status: string; canAccept: boolean; acceptedOnline?: { at: string; name: string } }>;
  onlinePayment: boolean;
}

const INVOICE_STATUS: Record<string, [string, string]> = {
  paid: ["Réglée", "text-pos bg-pos-50"], overdue: ["En retard", "text-neg bg-neg-50"],
  partial: ["Réglée en partie", "text-warn bg-warn-50"], sent: ["À régler", "text-info bg-info-50"],
  credited: ["Annulée (avoir)", "text-ink2 bg-surface2"],
};
const QUOTE_STATUS: Record<string, [string, string]> = {
  sent: ["En attente de votre accord", "text-info bg-info-50"], accepted: ["Accepté", "text-pos bg-pos-50"],
  rejected: ["Refusé", "text-ink2 bg-surface2"], expired: ["Expiré", "text-ink2 bg-surface2"],
};

/**
 * Portail client public : ouvert par le lien personnel envoyé au client.
 * Aucune donnée interne n'y figure ; le lien peut être révoqué à tout moment.
 */
export default function ClientPortalPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/client-portal/${token}`);
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) { setError(d?.error || "Ce lien n'est pas valide."); return; }
      setData(d.data);
    } catch { setError("Connexion impossible. Vérifiez votre réseau."); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const paid = new URLSearchParams(window.location.search).get("paid");
    if (paid) showToast(`Merci : le paiement de la facture ${paid} est en cours de confirmation.`, "success");
  }, []);

  async function pay(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/public/client-portal/${token}/invoices/${id}/pay`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.data?.paymentUrl) { showToast(d?.error || "Paiement indisponible pour le moment.", "error"); return; }
      window.location.href = d.data.paymentUrl;
    } finally { setBusy(null); }
  }

  async function accept(id: string, number: string) {
    const name = await promptDialog({ title: `Accepter le devis ${number}`, message: "Votre nom vaut accord sur ce devis, aux conditions indiquées.", label: "Nom et fonction", required: true, confirmLabel: "J'accepte le devis" });
    if (!name) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/public/client-portal/${token}/quotes/${id}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { showToast(d?.error || "Acceptation impossible.", "error"); return; }
      showToast(`Devis ${number} accepté. Votre fournisseur est prévenu.`, "success");
      load();
    } finally { setBusy(null); }
  }

  const pdf = (kind: "invoice" | "quote", id: string) => `/api/public/client-portal/${token}/pdf?kind=${kind}&id=${id}`;

  if (error) return (
    <main className="min-h-screen grid place-items-center bg-bg px-4">
      <div className="surface-card p-6 max-w-sm text-center space-y-2">
        <AlertTriangle className="mx-auto text-warn" size={28} />
        <p className="font-semibold text-ink">Lien indisponible</p>
        <p className="text-sm text-ink2">{error}</p>
      </div>
    </main>
  );
  if (!data) return <main className="min-h-screen bg-bg p-6"><div className="max-w-3xl mx-auto h-64 surface-card animate-pulse" /></main>;

  const { supplier } = data;
  return (
    <main className="min-h-screen bg-bg pb-16" style={supplier.color ? { ["--portal" as string]: supplier.color } : undefined}>
      <header className="bg-surface border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3">
          {supplier.logo && <img src={supplier.logo} alt="" className="w-11 h-11 object-contain rounded-lg border border-line bg-surface" />}
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{supplier.name}</p>
            <p className="text-xs text-ink2">Espace client de <strong>{data.client.name}</strong></p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 mt-5 space-y-6">
        <section className="surface-card p-5 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-ink3">Reste à régler</p><p className="text-2xl font-bold num text-ink">{formatMoney(data.totals.due)}</p></div>
          <div><p className="text-xs text-ink3">Dont en retard</p><p className={`text-2xl font-bold num ${data.totals.overdue ? "text-neg" : "text-pos"}`}>{formatMoney(data.totals.overdue)}</p></div>
        </section>

        <section className="space-y-2">
          <h1 className="font-semibold text-ink">Factures</h1>
          {data.invoices.length === 0 ? <p className="text-sm text-ink3">Aucune facture.</p> : data.invoices.map(i => {
            const [label, cls] = INVOICE_STATUS[i.status] ?? INVOICE_STATUS.sent;
            return (
              <article key={i._id} className="surface-card p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[10rem]">
                  <p className="font-mono text-sm font-semibold text-ink whitespace-nowrap">{i.number}</p>
                  <p className="text-xs text-ink2">Émise le {formatDate(i.issueDate)} · échéance {formatDate(i.dueDate)}</p>
                </div>
                <div className="text-right">
                  <p className="num font-semibold text-ink whitespace-nowrap">{formatMoney(i.due > 0 ? i.due : i.totalTTC)}</p>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <a href={pdf("invoice", i._id)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-9 flex-1 sm:flex-none"><FileText size={14} /> PDF</a>
                  {i.canPay && <button onClick={() => pay(i._id)} disabled={busy === i._id} className="btn-primary h-9 flex-1 sm:flex-none"><CreditCard size={14} /> {busy === i._id ? "…" : "Payer en ligne"}</button>}
                </div>
              </article>
            );
          })}
          {!data.onlinePayment && data.totals.due > 0 && supplier.paymentInstructions && (
            <p className="text-xs text-ink2 whitespace-pre-line surface-card p-3"><strong>Pour régler :</strong> {supplier.paymentInstructions}</p>
          )}
        </section>

        {data.quotes.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-ink">Devis</h2>
            {data.quotes.map(q => {
              const [label, cls] = QUOTE_STATUS[q.status] ?? QUOTE_STATUS.sent;
              return (
                <article key={q._id} className="surface-card p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-mono text-sm font-semibold text-ink whitespace-nowrap">{q.number}</p>
                    <p className="text-xs text-ink2">Valable jusqu&apos;au {formatDate(q.validUntil)}{q.acceptedOnline ? ` · accepté par ${q.acceptedOnline.name}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-semibold text-ink">{formatMoney(q.totalTTC)}</p>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <a href={pdf("quote", q._id)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-9 flex-1 sm:flex-none"><FileText size={14} /> PDF</a>
                    {q.canAccept && <button onClick={() => accept(q._id, q.number)} disabled={busy === q._id} className="btn-primary h-9 flex-1 sm:flex-none"><CheckCircle2 size={14} /> Accepter</button>}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {data.creditNotes.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-ink">Avoirs</h2>
            {data.creditNotes.map(c => (
              <article key={c._id} className="surface-card p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0"><p className="font-mono text-sm font-semibold text-ink whitespace-nowrap">{c.number}</p><p className="text-xs text-ink2">{formatDate(c.issueDate)}</p></div>
                <p className="num font-semibold text-ink whitespace-nowrap">− {formatMoney(c.totalTTC)}</p>
                <a href={pdf("invoice", c._id)} target="_blank" rel="noopener noreferrer" className="btn-secondary h-9"><FileText size={14} /> PDF</a>
              </article>
            ))}
          </section>
        )}

        <footer className="text-xs text-ink3 flex flex-wrap gap-4 pt-2">
          {supplier.phone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {supplier.phone}</span>}
          {supplier.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {supplier.email}</span>}
          <span className="ml-auto">Propulsé par Kanoo</span>
        </footer>
      </div>
    </main>
  );
}
