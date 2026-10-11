"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, FileClock, Download, Search, ArrowRight } from "lucide-react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { showToast } from "@/components/ui/Toast";
import { inputCls, selectCls } from "@/components/ui/FormField";
import { api, apiErrorMessage } from "@/lib/api-client";

interface Attachment {
  _id: string;
  filename: string;
  label?: string;
  host: string;
  hostId: string;
  category?: string;
  size: number;
  mime: string;
  createdAt: string;
  uploadedBy?: { firstName?: string; lastName?: string } | null;
}

/** Document porteur : libellé et écran où le retrouver. */
const HOSTS: Record<string, { label: string; href?: (id: string) => string }> = {
  invoices: { label: "Facture", href: id => `/invoices/${id}` },
  devis: { label: "Devis", href: id => `/devis/${id}` },
  contracts: { label: "Marché / contrat", href: id => `/contracts/${id}` },
  commandes: { label: "Bon de commande", href: id => `/commandes/${id}` },
  purchases: { label: "Facture fournisseur", href: id => `/depenses/${id}` },
  expenses: { label: "Note de frais", href: id => `/notes-de-frais/${id}` },
  projects: { label: "Projet", href: id => `/projects/${id}` },
  employees: { label: "Collaborateur", href: id => `/employees/${id}` },
  clients: { label: "Client", href: id => `/clients/${id}` },
  suppliers: { label: "Fournisseur", href: id => `/suppliers/${id}` },
  payslips: { label: "Bulletin de paie", href: id => `/payslips/${id}` },
  treasuryAccounts: { label: "Compte de trésorerie", href: id => `/treasury/${id}` },
  subscriptions: { label: "Licence", href: () => "/abonnements/achats" },
  leaves: { label: "Congé", href: () => "/conges" },
  accountingEntries: { label: "Écriture comptable", href: () => "/accounting" },
  marches: { label: "Appel d'offres", href: id => `/marches/${id}` },
  documents: { label: "Document libre" },
};

const CATEGORIES: Record<string, string> = {
  contrat: "Contrat", avenant: "Avenant", facture: "Facture", justificatif: "Justificatif",
  releve: "Relevé", courrier: "Courrier", autre: "Autre",
};

function formatSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

const LIMIT = 20;

export default function DocumentsPage() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [host, setHost] = useState("");
  const [category, setCategory] = useState("");

  // La recherche part après une courte pause de frappe, pas à chaque lettre.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ items: Attachment[]; pagination: { total: number } }>("/api/documents", {
        query: { page, limit: LIMIT, q: search, host, category },
      });
      setItems(d.items);
      setTotal(d.pagination.total);
    } catch (e) {
      showToast(apiErrorMessage(e, "Lecture des documents impossible."), "error");
    } finally {
      setLoading(false);
    }
  }, [page, search, host, category]);
  useEffect(() => { load(); }, [load]);

  const columns: Column<Attachment>[] = [
    { key: "filename", label: "Fichier", render: (_, a) => (
      <span className="block min-w-0">
        <span className="block font-medium text-ink truncate max-w-[22rem]">{a.label || a.filename}</span>
        {a.label && <span className="block text-xs text-ink3 truncate max-w-[22rem]">{a.filename}</span>}
      </span>
    ) },
    { key: "host", label: "Rattaché à", render: (_, a) => {
      const h = HOSTS[a.host];
      const label = h?.label ?? a.host;
      return h?.href
        ? <Link href={h.href(a.hostId)} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm text-section hover:underline">{label} <ArrowRight size={12} /></Link>
        : <span className="text-sm text-ink2">{label}</span>;
    } },
    { key: "category", label: "Nature", render: v => <span className="text-xs text-ink2">{CATEGORIES[String(v)] ?? "—"}</span> },
    { key: "size", label: "Taille", className: "num text-xs text-ink2", render: v => formatSize(Number(v)) },
    { key: "createdAt", label: "Ajouté le", render: (_, a) => (
      <span className="text-xs text-ink2">
        {new Date(a.createdAt).toLocaleDateString("fr-FR")}
        {a.uploadedBy?.firstName && <span className="block text-ink3">par {a.uploadedBy.firstName} {a.uploadedBy.lastName ?? ""}</span>}
      </span>
    ) },
    { key: "_id", label: "", render: (_, a) => (
      <a href={`/api/attachments/${a._id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-sm text-section hover:underline" aria-label={`Ouvrir ${a.filename}`}>
        <Download size={14} /> Ouvrir
      </a>
    ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Documents"
        subtitle="Toutes les pièces jointes de vos factures, marchés, dépenses, projets et dossiers du personnel, au même endroit." />

      <div className="grid sm:grid-cols-2 gap-3">
        <Link href="/courriers" className="surface-card p-4 flex items-center gap-3 hover:border-section/40 group">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-section-soft text-section shrink-0"><Mail size={18} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-ink group-hover:text-section">Courriers</span>
            <span className="block text-xs text-ink2">Courriers entrants et sortants, numérotés et datés.</span>
          </span>
          <ArrowRight size={15} className="text-ink3" />
        </Link>
        <Link href="/documents-administratifs" className="surface-card p-4 flex items-center gap-3 hover:border-section/40 group">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-section-soft text-section shrink-0"><FileClock size={18} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-ink group-hover:text-section">Coffre administratif</span>
            <span className="block text-xs text-ink2">RCCM, NIF, attestations, assurances : les échéances de renouvellement.</span>
          </span>
          <ArrowRight size={15} className="text-ink3" />
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Rechercher un fichier</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un fichier…" className={`${inputCls} pl-9`} />
        </label>
        <select value={host} onChange={e => { setHost(e.target.value); setPage(1); }} className={`${selectCls} sm:w-56`} aria-label="Rattaché à">
          <option value="">Tous les rattachements</option>
          {Object.entries(HOSTS).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
        </select>
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} className={`${selectCls} sm:w-44`} aria-label="Nature">
          <option value="">Toutes natures</option>
          {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <p className="text-xs text-ink3">{total} document{total > 1 ? "s" : ""}</p>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={a => a._id}
        emptyMessage={search || host || category ? "Aucun document ne correspond." : "Aucun document pour l'instant : les pièces jointes ajoutées aux factures, marchés ou dépenses apparaîtront ici."} />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
