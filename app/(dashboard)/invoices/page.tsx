"use client";

import { IfCan } from "@/components/shared/IfCan";
import { SearchBox } from "@/components/ui/SearchBox";
import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { FilterChips } from "@/components/ui/Primitives";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { showToast } from "@/components/ui/Toast";
import { urlParam } from "@/lib/url-param";

import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import { apiJson } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { PageLoading } from "@/components/ui/PageState";
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
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

// Facture complète chargée pour l'impression directe (client peuplé ou simple identifiant)
type PrintableInvoice = Omit<Invoice, "clientId"> & {
  clientId?: { name?: string; code?: string; address?: string; nif?: string } | string | null;
  clientName?: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Émises" },
  { value: "partial", label: "Partiellement payées" },
  { value: "unpaid", label: "Impayées (non soldées)" },
  { value: "paid", label: "Soldées" },
  { value: "overdue", label: "En retard" },
  { value: "cancelled", label: "Annulées" },
];


function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InvoicesPage() {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Filtres repris de l'adresse : les raccourcis (tableau de bord, menu, fiche
  // client) ouvrent la liste déjà filtrée.
  const [status, setStatus] = useState(() => urlParam("status"));
  const [overdueOnly, setOverdueOnly] = useState(() => urlParam("overdue") === "true");
  const [clientId, setClientId] = useState(() => urlParam("clientId"));
  const [user, setUser] = useState<{ firstName: string; lastName: string } | null>(null);

  // États pour l'impression directe
  const [invoiceToPrint, setInvoiceToPrint] = useState<PrintableInvoice | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const LIMIT = 20;

  // Récupération de l'utilisateur connecté
  useEffect(() => {
    apiJson("/api/auth/me")
      .then((d) => setUser(d.data?.user || null))
      .catch(() => {});
  }, []);

  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (status) params.set("status", status);
  if (overdueOnly) params.set("overdue", "true");
  if (clientId) params.set("clientId", clientId);
  if (search) params.set("search", search);

  // Une lecture refusée donne une liste vide (le message est affiché par apiJson).
  const { data: { invoices, total }, loading } = useApi(`/api/invoices?${params}`, d => ({
    invoices: (d.data?.items || d.items || []) as Invoice[],
    total: (d.data?.pagination?.total || d.total || 0) as number,
  }), { invoices: [] as Invoice[], total: 0 });

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
      showToast("Impossible de charger le document pour l'impression.", "error");
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
        <Link href={`/invoices/${row._id}`} className="text-section hover:underline">
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
      mobile: "hide",
      render: (v) => <span className="text-ink2 text-sm">{formatDate(String(v))}</span>,
    },
    {
      key: "dueDate",
      label: "Échéance",
      render: (v, row) => {
        // Un avoir n'a pas d'échéance : « Invalid Date » s'affichait.
        if (!v) return <span className="text-sm text-ink3">—</span>;
        const overdue = !["paid", "cancelled", "written_off"].includes(row.status) && new Date(String(v)) < new Date();
        return (
          <span className={`text-sm ${overdue ? "text-neg font-medium" : "text-ink2"}`}>
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
      render: (v) => formatMoney(Number(v || 0)),
    },
    {
      key: "paidAmount",
      label: "Payé",
      mobile: "hide",
      className: "text-right font-mono text-pos",
      render: (v) => <span>{Number(v) > 0 ? formatMoney(Number(v)) : "—"}</span>,
    },
    {
      key: "status",
      label: "Statut",
      render: (v) => <StatusBadge status={String(v || "draft")} />,
    },
    {
      key: "actions",
      label: "Actions",
      render: (_v, row) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/invoices/${row._id}`}
            className={buttonClass("secondary", "sm")}
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
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-line rounded-lg text-ink2 hover:bg-surface2 hover:text-ink transition-colors disabled:opacity-50"
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

  // Client peuplé de la facture à imprimer (null s'il n'est qu'un identifiant)
  const printClient = invoiceToPrint && typeof invoiceToPrint.clientId === "object" ? invoiceToPrint.clientId : null;

  if (!mounted) return <PageLoading />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Factures clients</h1>
          <p className="text-sm text-ink2 mt-0.5">{total} facture{total > 1 ? "s" : ""}</p>
        </div>
        <IfCan resource="invoices">
        <Link
          href="/invoices/new"
          className={buttonClass("primary", "md")}
        >
          + Nouvelle facture
        </Link>
        </IfCan>
      </div>

      {/* Filtres — des chips plutôt qu'un menu déroulant : les états
          disponibles se voient sans avoir à ouvrir quoi que ce soit, et le
          filtre actif reste visible pendant qu'on lit la liste. */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox onSearch={q => { setSearch(q); setPage(1); }} placeholder="N°, libellé, client…" className="w-full sm:w-64" />
        <FilterChips
          options={STATUS_OPTIONS.filter(o => o.value).map(o => ({ key: o.value, label: o.label }))}
          value={status || null}
          onChange={(key) => { setStatus(key || ""); setPage(1); }}
        />
        <span className="h-5 w-px bg-line2 hidden sm:block" aria-hidden />
        <button type="button" aria-pressed={overdueOnly} className="fchip"
          onClick={() => { setOverdueOnly(!overdueOnly); setPage(1); }}>
          En retard uniquement
        </button>
        {clientId && (
          <button type="button" className="fchip" aria-pressed onClick={() => { setClientId(""); setPage(1); window.history.replaceState(null, "", "/invoices"); }}>
            Client : {(invoices[0]?.clientId as { name?: string } | undefined)?.name ?? "sélectionné"} ✕
          </button>
        )}
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
          {printClient?.nif && <p style={{ margin: "2px 0", color: "#444" }}>NIF: {printClient.nif}</p>}
          {printClient?.address && <p style={{ margin: "2px 0", color: "#444" }}>{printClient.address}</p>}
        </div>
      </div>

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
          {invoiceToPrint.lines && invoiceToPrint.lines.length > 0 ? (
            invoiceToPrint.lines.map((line, idx: number) => (
              <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "10px 12px" }}>{line.description}</td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>{line.quantity}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>{(line.unitPrice || line.price || 0).toLocaleString("fr-FR")}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{formatMoney(line.totalTTC || 0)}</td>
              </tr>
            ))
          ) : (
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px 12px" }}>Prestation de services (Global)</td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}>1</td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>{(invoiceToPrint.totalHT || 0).toLocaleString("fr-FR")}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "bold" }}>{formatMoney(invoiceToPrint.totalTTC || 0)}</td>
            </tr>
          )}
        </tbody>
      </table></div>

      {/* TOTALS */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: "260px", gap: "8px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>Sous-total HT :</span>
            <span>{formatMoney(invoiceToPrint.totalHT || 0)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>TVA :</span>
            <span>{formatMoney(invoiceToPrint.totalTVA || 0)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #333", paddingTop: "8px", fontSize: "14px", fontWeight: "bold", color: "#000" }}>
            <span>TOTAL TTC :</span>
            <span>{formatMoney(invoiceToPrint.totalTTC || 0)}</span>
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