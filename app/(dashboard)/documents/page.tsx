"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, FileClock, Download, Search, ArrowRight, Files, CalendarPlus, HardDrive, ShieldAlert, List, LayoutGrid, FileText, FileImage, FileSpreadsheet, File as FileIcon, FolderOpen } from "lucide-react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { selectCls } from "@/components/ui/FormField";
import { MetricCard, PillTabs } from "@/components/ui/MetricCard";
import { useApi } from "@/lib/use-api";

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
interface Stats { total: number; size: number; thisMonth: number; byCategory: Record<string, number> }
interface VaultSummary { total: number; valid: number; toRenew: number; late: number; expired: number }

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
  contrat: "Contrats", avenant: "Avenants", facture: "Factures", justificatif: "Justificatifs",
  releve: "Relevés", courrier: "Courriers", autre: "Autres",
};
const CATEGORY_ONE: Record<string, string> = {
  contrat: "Contrat", avenant: "Avenant", facture: "Facture", justificatif: "Justificatif",
  releve: "Relevé", courrier: "Courrier", autre: "Autre",
};

function formatSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Pastille de type de fichier : PDF rouge, image violette, tableur verte, texte bleu. */
function FileBadge({ mime, name, size = 40 }: { mime: string; name: string; size?: number }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const [Icon, bg, label] = mime === "application/pdf" || ext === "pdf" ? [FileText, "rgb(194 39 45)", "PDF"]
    : mime.startsWith("image/") ? [FileImage, "rgb(110 68 188)", ext.toUpperCase() || "IMG"]
    : /sheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "ods"].includes(ext) ? [FileSpreadsheet, "rgb(0 120 64)", ext.toUpperCase()]
    : /word|document|text/.test(mime) || ["doc", "docx", "odt", "txt"].includes(ext) ? [FileText, "rgb(47 89 223)", ext.toUpperCase()]
    : [FileIcon, "rgb(100 110 125)", ext.toUpperCase() || "FICHIER"];
  return (
    <span className="relative rounded-xl grid place-items-center text-white shrink-0" style={{ width: size, height: size, background: bg }} aria-hidden title={label}>
      <Icon size={size * 0.45} />
    </span>
  );
}

const LIMIT = 24;

export default function DocumentsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [host, setHost] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");

  // La recherche part après une courte pause de frappe, pas à chaque lettre.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Critères vides ignorés : l'adresse ne porte que les filtres choisis.
  const query = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  for (const [k, v] of Object.entries({ q: search, host, category })) if (v) query.set(k, v);
  const { data: { items, total }, loading } = useApi(`/api/documents?${query}`, d => ({
    items: (d.data?.items ?? []) as Attachment[],
    total: (d.data?.pagination?.total ?? 0) as number,
  }), { items: [] as Attachment[], total: 0 });
  const stats = useApi<Stats | null>("/api/documents?stats=1", d => d?.data ?? null, null).data;
  const vault = useApi<VaultSummary | null>("/api/documents-administratifs", d => d?.data?.summary ?? null, null).data;
  const vaultAlerts = vault ? vault.toRenew + vault.late + vault.expired : 0;

  const hostCell = (a: Attachment) => {
    const h = HOSTS[a.host];
    const label = h?.label ?? a.host;
    return h?.href
      ? <Link href={h.href(a.hostId)} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-2.5 py-1 rounded-full bg-section-soft text-section hover:underline">{label} <ArrowRight size={12} /></Link>
      : <span className="text-[12.5px] px-2.5 py-1 rounded-full bg-surface2 text-ink2">{label}</span>;
  };

  const columns: Column<Attachment>[] = [
    { key: "filename", label: "Fichier", render: (_, a) => (
      <span className="flex items-center gap-3 min-w-0">
        <FileBadge mime={a.mime} name={a.filename} size={36} />
        <span className="block min-w-0">
          <span className="block font-semibold text-ink truncate max-w-[22rem]">{a.label || a.filename}</span>
          {a.label && <span className="block text-xs text-ink3 truncate max-w-[22rem]">{a.filename}</span>}
        </span>
      </span>
    ) },
    { key: "host", label: "Rattaché à", render: (_, a) => hostCell(a) },
    { key: "category", label: "Nature", render: v => <span className="text-xs text-ink2">{CATEGORY_ONE[String(v)] ?? "—"}</span> },
    { key: "size", label: "Taille", className: "num text-xs text-ink2", render: v => formatSize(Number(v)) },
    { key: "createdAt", label: "Ajouté le", render: (_, a) => (
      <span className="text-xs text-ink2">
        {new Date(a.createdAt).toLocaleDateString("fr-FR")}
        {a.uploadedBy?.firstName && <span className="block text-ink3">par {a.uploadedBy.firstName} {a.uploadedBy.lastName ?? ""}</span>}
      </span>
    ) },
    { key: "_id", label: "", render: (_, a) => (
      <a href={`/api/attachments/${a._id}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line text-[12.5px] font-semibold text-ink hover:bg-surface2" aria-label={`Ouvrir ${a.filename}`}>
        <Download size={13} /> Ouvrir
      </a>
    ) },
  ];

  const tabs = [
    { key: "", label: "Tous", icon: <Files size={15} />, count: stats?.total ?? null },
    ...Object.entries(CATEGORIES).map(([k, l]) => ({ key: k, label: l, count: stats ? stats.byCategory[k] ?? 0 : null })),
  ];
  const filtered = Boolean(search || host || category);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Documents &amp; archives</p>
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1">Gestion des documents</h1>
          <p className="text-sm text-ink2 mt-1">Toutes les pièces jointes de vos factures, marchés, dépenses, projets et dossiers du personnel, au même endroit.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/courriers" className="h-11 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2"><Mail size={16} /> Courriers</Link>
          <Link href="/documents-administratifs" className="h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105"><FileClock size={16} /> Coffre administratif</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<Files size={18} />} tone="blue" label="Documents" value={stats ? String(stats.total) : "—"} sub="Pièces jointes visibles pour vous" />
        <MetricCard icon={<CalendarPlus size={18} />} tone="green" label="Ajoutés ce mois" value={stats ? String(stats.thisMonth) : "—"} sub={new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} />
        <MetricCard icon={<HardDrive size={18} />} tone="violet" label="Volume stocké" value={stats ? (stats.size ? formatSize(stats.size) : "0 Mo") : "—"} sub="Tous fichiers confondus" />
        <MetricCard icon={<ShieldAlert size={18} />} tone={vaultAlerts ? "red" : "teal"} label="Coffre administratif" value={vault ? String(vaultAlerts) : "—"} valueCls={vaultAlerts ? "text-neg" : ""}
          sub={vault ? (vaultAlerts ? `à renouveler sur ${vault.total} pièce${vault.total > 1 ? "s" : ""}` : `${vault.total} pièce${vault.total > 1 ? "s" : ""} à jour`) : "RCCM, NIF, attestations…"} />
      </div>

      <PillTabs label="Nature des documents" value={category} onChange={k => { setCategory(k); setPage(1); }} tabs={tabs} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un fichier…" aria-label="Rechercher un fichier"
            className="w-full h-10 pl-10 pr-4 rounded-full border border-line bg-surface text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-section/30" />
        </label>
        <select value={host} onChange={e => { setHost(e.target.value); setPage(1); }} className={`${selectCls} sm:w-60 rounded-full`} aria-label="Rattaché à">
          <option value="">Tous les rattachements</option>
          {Object.entries(HOSTS).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
        </select>
        <div className="inline-flex p-1 rounded-xl bg-surface2 gap-1" role="group" aria-label="Affichage">
          {([["list", "Liste", <List key="l" size={14} />], ["grid", "Grille", <LayoutGrid key="g" size={14} />]] as const).map(([k, l, ic]) => (
            <button key={k} aria-pressed={view === k} onClick={() => setView(k)}
              className={`h-8 px-3 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 ${view === k ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>{ic} {l}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink3">{total} document{total > 1 ? "s" : ""}{filtered ? " correspondant aux critères" : ""}</p>

      {view === "list" ? (
        <DataTable columns={columns} data={items} loading={loading} keyExtractor={a => a._id}
          emptyMessage={filtered ? "Aucun document ne correspond." : "Aucun document pour l'instant : les pièces jointes ajoutées aux factures, marchés ou dépenses apparaîtront ici."} />
      ) : loading ? (
        <div className="h-72 rounded-[22px] bg-surface border border-line animate-pulse" />
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-[22px] border border-line p-10 text-center">
          <FolderOpen size={26} className="mx-auto text-ink3" />
          <p className="mt-2 text-sm text-ink2">{filtered ? "Aucun document ne correspond." : "Aucun document pour l'instant."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(a => (
            <article key={a._id} className="bg-surface rounded-[22px] border border-line shadow-card p-4 flex flex-col gap-3 min-w-0">
              <div className="flex items-start gap-3 min-w-0">
                <FileBadge mime={a.mime} name={a.filename} size={44} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-ink leading-snug line-clamp-2 break-words">{a.label || a.filename}</span>
                  <span className="block text-[12px] text-ink3 mt-0.5">{formatSize(a.size)} · {new Date(a.createdAt).toLocaleDateString("fr-FR")}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">{hostCell(a)}{a.category && <span className="text-[12px] px-2.5 py-1 rounded-full bg-surface2 text-ink2">{CATEGORY_ONE[a.category] ?? a.category}</span>}</div>
              <a href={`/api/attachments/${a._id}`} target="_blank" rel="noopener noreferrer"
                className="mt-auto h-9 rounded-full border border-line text-[13px] font-semibold text-ink inline-flex items-center justify-center gap-1.5 hover:bg-surface2">
                <Download size={14} /> Ouvrir
              </a>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
