"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

interface Invoice {
  _id: string;
  number: string;
  clientId: { name: string; code: string; address?: string; nif?: string } | string;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  paidAmount: number;
  status: string;
  issueDate: string;
  dueDate: string;
  lines?: Array<{ description: string; quantity: number; unitPrice?: number; price?: number; totalTTC: number }>;
  notes?: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Émises" },
  { value: "partial", label: "Partiellement payées" },
  { value: "paid", label: "Soldées" },
  { value: "overdue", label: "En retard" },
  { value: "cancelled", label: "Annulées" },
];

function formatXOF(n: number) {
  if (n === undefined || n === null) return "0 XOF";
  return n.toLocaleString("fr-FR") + " XOF";
}

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InvoicesPage() {
  const [mounted, setMounted] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ firstName: string; lastName: string } | null>(null);

  // États pour l'impression directe
  const [invoiceToPrint, setInvoiceToPrint] = useState<any>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const LIMIT = 20;

  // Récupération de l'utilisateur connecté
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUser(d.data?.user || null))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set("status", status);
    if (overdueOnly) params.set("overdue", "true");

    try {
      const res = await fetch(`/api/invoices?${params}`, { credentials: "include" });
      const d = await res.json();
      setInvoices(d.data?.items || d.items || []);
      setTotal(d.data?.pagination?.total || d.total || 0);
    } catch (err) {
      console.error("Erreur de chargement des factures :", err);
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, status, overdueOnly]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  const handlePrintDirect = async (invoiceId: string) => {
    if (printingId) return;
    setPrintingId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur lors de la récupération");
      const result = await res.json();

      const fullInvoice = result.data ? result.data : result;

      setInvoiceToPrint(fullInvoice);

      setTimeout(() => {
        window.print();
        setInvoiceToPrint(null);
        setPrintingId(null);
      }, 150);
    } catch (err) {
      console.error("Erreur impression directe :", err);
      alert("Impossible de charger le document pour l'impression.");
      setPrintingId(null);
    }
  };

  const columns: Column<Invoice>[] = [
    {
      key: "number",
      label: "N° Facture",
      sortable: true,
      className: "font-mono text-sm font-semibold",
      render: (v, row) => (
        <Link href={`/invoices/${row._id}`} className="text-cedar hover:underline">
          {String(v || "—")}
        </Link>
      ),
    },
    {
      key: "clientId",
      label: "Client",
      render: (v) => {
        if (typeof v === "object" && v && "name" in v) return (v as { name: string }).name;
        return "—";
      },
    },
    {
      key: "issueDate",
      label: "Date émission",
      render: (v) => <span className="text-moss text-sm">{formatDate(String(v))}</span>,
    },
    {
      key: "dueDate",
      label: "Échéance",
      render: (v, row) => {
        const overdue = row.status !== "paid" && new Date(String(v)) < new Date();
        return (
          <span className={`text-sm ${overdue ? "text-red-600 font-medium" : "text-moss"}`}>
            {formatDate(String(v))}
          </span>
        );
      },
    },
    {
      key: "totalTTC",
      label: "Montant TTC",
      sortable: true,
      className: "text-right font-mono font-semibold",
      render: (v) => formatXOF(Number(v || 0)),
    },
    {
      key: "paidAmount",
      label: "Payé",
      className: "text-right font-mono text-green-700",
      render: (v) => <span>{Number(v) > 0 ? formatXOF(Number(v)) : "—"}</span>,
    },
    {
      key: "status",
      label: "Statut",
      render: (v) => <StatusBadge status={String(v || "draft")} />,
    },
    {
      key: "actions" as any,
      label: "Actions",
      render: (_v, row) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/invoices/${row._id}`}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-clay/30 rounded-lg text-moss hover:bg-sand hover:text-ink transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Consulter
          </Link>

          <button
            onClick={() => handlePrintDirect(row._id)}
            disabled={printingId === row._id}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-clay/30 rounded-lg text-moss hover:bg-sand hover:text-ink transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-14.326 0C3.768 7.44 3 8.376 3 9.456v6.294a2.25 2.25 0 0 0 2.25 2.25h1.091M12 13.5h.008v.008H12V13.5Z" />
            </svg>
            {printingId === row._id ? "Chargement..." : "Imprimer"}
          </button>
        </div>
      ),
    },
  ];

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Factures clients</h1>
          <p className="text-sm text-moss mt-0.5">{total} facture{total > 1 ? "s" : ""}</p>
        </div>
        <Link
          href="/invoices/new"
          className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors"
        >
          + Nouvelle facture
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30 text-ink"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }}
            className="accent-cedar"
          />
          Impayées en retard uniquement
        </label>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={invoices}
        loading={loading}
        keyExtractor={(inv) => inv._id}
        emptyMessage="Aucune facture trouvée"
      />

      <Pagination
        page={page}
        totalPages={Math.ceil(total / LIMIT) || 1}
        total={total}
        limit={LIMIT}
        onPage={setPage}
      />

      {/* ZONE D'IMPRESSION DIRECTE */}
      {/* ZONE D'IMPRESSION DIRECTE */}
{invoiceToPrint && (
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
      {/* EN-TÊTE FACTURE */}
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
          <p style={{ margin: "0 0 10px 0", fontFamily: "monospace", fontSize: "13px" }}><b>{invoiceToPrint.number || "—"}</b></p>
          <p style={{ margin: "2px 0", color: "#555" }}>Émise le : {formatDate(invoiceToPrint.issueDate)}</p>
          <p style={{ margin: "2px 0", color: "#555" }}>Échéance : {formatDate(invoiceToPrint.dueDate)}</p>
        </div>
      </div>

      {/* ADRESSE CLIENT */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "30px" }}>
        <div style={{ textAlign: "right", width: "280px" }}>
          <h3 style={{ fontSize: "10px", fontWeight: "bold", color: "#999", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 5px 0" }}>Facturé à</h3>
          <p style={{ fontSize: "14px", fontWeight: "bold", margin: "0 0 4px 0" }}>
            {typeof invoiceToPrint.clientId === "object" ? invoiceToPrint.clientId?.name : (invoiceToPrint.clientName || "Client")}
          </p>
          {invoiceToPrint.clientId?.nif && <p style={{ margin: "2px 0", color: "#444" }}>NIF: {invoiceToPrint.clientId.nif}</p>}
          {invoiceToPrint.clientId?.address && <p style={{ margin: "2px 0", color: "#444" }}>{invoiceToPrint.clientId.address}</p>}
        </div>
      </div>

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
          {invoiceToPrint.lines && invoiceToPrint.lines.length > 0 ? (
            invoiceToPrint.lines.map((line: any, idx: number) => (
              <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 12px" }}>{line.description}</td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>{line.quantity}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{(line.unitPrice || line.price || 0).toLocaleString("fr-FR")}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{formatXOF(line.totalTTC || 0)}</td>
              </tr>
            ))
          ) : (
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px 12px" }}>Prestation de services (Global)</td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}>1</td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>{(invoiceToPrint.totalHT || 0).toLocaleString("fr-FR")}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{formatXOF(invoiceToPrint.totalTTC || 0)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* TOTALS */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: "260px", gap: "8px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>Sous-total HT :</span>
            <span>{formatXOF(invoiceToPrint.totalHT || 0)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>TVA :</span>
            <span>{formatXOF(invoiceToPrint.totalTVA || 0)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #333", paddingTop: "8px", fontSize: "14px", fontWeight: "bold", color: "#000" }}>
            <span>TOTAL TTC :</span>
            <span>{formatXOF(invoiceToPrint.totalTTC || 0)}</span>
          </div>
        </div>
      </div>

      {/* NOTES ACCESSOIRES */}
      {invoiceToPrint.notes && (
        <div style={{ marginTop: "40px", borderTop: "1px solid #eee", paddingTop: "15px" }}>
          <p style={{ margin: "0 0 5px 0", fontWeight: "bold", color: "#555" }}>Notes & Conditions :</p>
          <p style={{ margin: 0, color: "#666", fontStyle: "italic" }}>{invoiceToPrint.notes}</p>
        </div>
      )}
    </div>
  </div>
)}
    </div>
  );
}