"use client";
import { Fragment, Suspense, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";

import { useApi } from "@/lib/use-api";
import { PageLoading } from "@/components/ui/PageState";
import { useSearchParams, useRouter } from "next/navigation";
import { AuditReportPanel } from "@/components/audit/AuditReportPanel";
import { Modal } from "@/components/ui/Modal";
import { resourceLabel } from "@/lib/resource-labels";
import { useCostCenters } from "@/components/shared/ImputationFields";
interface Log {
  _id: string; userEmail: string; userRole: string; action: string; resource: string; resourceId?: string; ip?: string; createdAt: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>;
}
type EntryFacts = { reference?: string; entryDate?: string; journalCode?: string; amount?: number };
type Imp = { projectId?: string; activityId?: string; costCenter?: string };

const ACTION_COLORS: Record<string, string> = { CREATE:"bg-pos-50 text-pos", UPDATE:"bg-info-50 text-info", DELETE:"bg-neg-50 text-neg", LOGIN:"bg-section-soft text-section", PAYMENT:"bg-warn-50 text-warn", APPROVE:"bg-teal-100 text-teal-700", REJECT:"bg-neg-50 text-neg" };
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Création", UPDATE: "Modification", DELETE: "Suppression", READ: "Consultation",
  LOGIN: "Connexion", LOGOUT: "Déconnexion", LOGIN_FAILED: "Connexion refusée", EXPORT: "Export", IMPORT: "Import",
  APPROVE: "Validation", REJECT: "Rejet", SIGN: "Signature", PAYMENT: "Paiement",
  INVOICE_SENT: "Facture envoyée", INVOICE_PAID: "Facture payée", REFUND: "Remboursement", CHECKIN: "Contrôle d'entrée",
};
/** Ressources absentes de la table des accès. */
const EXTRA_RESOURCES: Record<string, string> = { purchases: "Achats", companies: "Société" };
const resLabel = (k: string) => EXTRA_RESOURCES[k] ?? resourceLabel(k);
/** Filtre proposé : les ressources que le journal suit le plus. */
const RESOURCE_FILTER = ["accountingEntries", "invoices", "purchases", "payments", "treasuryAccounts", "expenses", "payslips", "employees", "users", "companies"];
const FIELD_LABELS: Record<string, string> = {
  label: "Libellé", reference: "Pièce", imputations: "Imputation analytique", projectId: "Projet", activityId: "Secteur",
  costCenter: "Service", accountingLockedUntil: "Période verrouillée jusqu'au", status: "Statut", amount: "Montant",
};
const META_LABELS: Record<string, string> = {
  action: "Opération", lockedUntil: "Verrouillée jusqu'au", reversed: "Extournée", correction: "Correction", count: "Nombre de corrections",
  number: "Numéro", entryId: "Écriture liée",
};
const META_ACTIONS: Record<string, string> = { reimpute: "Correction d'imputation", lock: "Verrouillage de période", unlock: "Réouverture de période" };

/** Motif saisi par l'auteur (modification, extourne…), s'il y en a un. */
const reasonOf = (l: Log) => (typeof l.metadata?.reason === "string" ? l.metadata.reason : "");
const entryOf = (l: Log) => (l.metadata?.entry && typeof l.metadata.entry === "object" ? l.metadata.entry as EntryFacts : null);
const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const fmtDate = (v: string) => new Date(v).toLocaleDateString("fr-FR", { timeZone: "UTC" });
/** Pièce visée, en clair : « VT-0012 du 12/03/2026 ». */
function pieceOf(l: Log): string {
  const e = entryOf(l);
  if (e?.reference) return `${e.reference}${e.entryDate ? ` du ${fmtDate(e.entryDate)}` : ""}`;
  if (typeof l.metadata?.number === "string") return l.metadata.number;
  return "";
}

/** Valeur lisible : texte, date, booléen ; objet ou liste en JSON indenté en dernier recours. */
function show(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (isoDate(v)) return fmtDate(v as string);
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString("fr-FR");
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function LogDetail({ log, onClose }: { log: Log; onClose: () => void }) {
  const costCenters = useCostCenters();
  const names = (log.metadata?.names && typeof log.metadata.names === "object" ? log.metadata.names : {}) as Record<string, string>;
  const cc = (code?: string) => (code ? costCenters.find(c => c.value === code)?.label ?? code : "");
  /** Une imputation en clair : projet · secteur · service. */
  const impText = (i: Imp | undefined) => {
    const parts = [i?.projectId && `Projet ${names[i.projectId] ?? "(supprimé)"}`, i?.activityId && `Secteur ${names[i.activityId] ?? "(supprimé)"}`, i?.costCenter && `Service ${cc(i.costCenter)}`].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Aucune";
  };
  const value = (field: string, v: unknown) => {
    if (field === "imputations" && Array.isArray(v)) return (v as Imp[]).map((x, i) => `Ligne ${i + 1} : ${impText(x)}`).join("\n");
    if ((field === "projectId" || field === "activityId") && typeof v === "string") return names[v] ?? v;
    return show(v);
  };
  const fields = [...new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})])];
  const reason = reasonOf(log);
  const entry = entryOf(log);
  const extra = Object.entries(log.metadata ?? {}).filter(([k]) => !["reason", "entry", "names"].includes(k));
  const cell = "align-top py-1.5 pr-3";
  const pre = "whitespace-pre-wrap break-words text-xs";
  return (
    <Modal open onClose={onClose} title="Détail de l'entrée du journal" size="lg">
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink3">Date/heure</dt><dd>{new Date(log.createdAt).toLocaleString("fr-FR")}</dd>
          <dt className="text-ink3">Utilisateur</dt><dd className="break-all">{log.userEmail}{log.userRole ? <span className="text-ink3"> · {log.userRole}</span> : null}</dd>
          <dt className="text-ink3">Action</dt><dd>{ACTION_LABELS[log.action] ?? log.action} · {resLabel(log.resource)}</dd>
          {entry && <><dt className="text-ink3">Écriture</dt><dd>
            {entry.reference}{entry.entryDate ? ` du ${fmtDate(entry.entryDate)}` : ""}{entry.journalCode ? ` · journal ${entry.journalCode}` : ""}{typeof entry.amount === "number" ? ` · ${entry.amount.toLocaleString("fr-FR")} FCFA` : ""}
          </dd></>}
          {log.ip && <><dt className="text-ink3">Adresse IP</dt><dd className="font-mono text-xs">{log.ip}</dd></>}
        </dl>
        <div className={`p-3 rounded-lg ${reason ? "bg-section-soft" : "bg-surface2"}`}>
          <p className="text-xs font-semibold text-ink2 mb-1">Motif</p>
          <p className="whitespace-pre-wrap">{reason || "Aucun motif enregistré."}</p>
        </div>
        {fields.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="text-xs text-ink3"><th className={cell}>Champ</th><th className={cell}>Avant</th><th className={cell}>Après</th></tr></thead>
              <tbody>
                {fields.map(k => (
                  <tr key={k} className="border-t border-line">
                    <td className={`${cell} font-medium`}>{FIELD_LABELS[k] ?? k}</td>
                    <td className={`${cell} text-neg`}><span className={pre}>{value(k, log.before?.[k])}</span></td>
                    <td className={`${cell} text-pos`}><span className={pre}>{value(k, log.after?.[k])}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-ink3">Aucune valeur avant / après enregistrée pour cette action.</p>}
        {extra.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink2 mb-1">Autres informations</p>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              {extra.map(([k, v]) => <Fragment key={k}><dt className="text-ink3">{META_LABELS[k] ?? k}</dt><dd className={pre}>{k === "action" && typeof v === "string" ? META_ACTIONS[v] ?? v : show(v)}</dd></Fragment>)}
            </dl>
          </div>
        )}
        {log.resourceId && <p className="text-[11px] text-ink3">Identifiant technique : <span className="font-mono break-all">{log.resourceId}</span></p>}
      </div>
    </Modal>
  );
}

const noSubscribe = () => () => {};

function AuditScreen() {
  // Rendu côté navigateur uniquement (dates au format local).
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("onglet") === "rapport" ? "rapport" : "journal";
  // Historique d'une écriture, ouvert depuis le journal comptable.
  const entryId = sp.get("ecriture") ?? "";
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Log | null>(null);
  const [resource, setResource] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [withReason, setWithReason] = useState(false); const LIMIT = 30;

  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (entryId) params.set("resourceId", entryId);
  if (resource) params.set("resource", resource);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (withReason) params.set("withReason", "1");
  const list = useApi<{ items?: Log[]; pagination?: { total?: number } } | null>(`/api/audit-logs?${params}`, d => d.data ?? null, null);
  const logs = list.data?.items || [];
  const total = list.data?.pagination?.total || 0;
  const loading = list.loading;

  if (!mounted) return <PageLoading />;

  const columns: Column<Log>[] = [
    { key: "createdAt", label: "Date/heure", render: (v) => <span className="text-xs text-ink2">{new Date(String(v)).toLocaleString("fr-FR")}</span> },
    { key: "userEmail", label: "Utilisateur", className: "text-sm" },
    { key: "action", label: "Action", render: (v) => { const s = String(v); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[s]||"bg-surface2 text-ink2"}`}>{ACTION_LABELS[s] ?? s}</span>; } },
    { key: "resource", label: "Ressource", className: "text-sm text-ink2", render: (v) => resLabel(String(v)) },
    { key: "resourceId", label: "Pièce", className: "text-xs text-ink2", render: (_v, l) => pieceOf(l) || null },
    { key: "metadata", label: "Motif", render: (_v, l) => { const r = reasonOf(l); return r ? <span className="text-xs text-ink2 line-clamp-1 max-w-[16rem]" title={r}>{r}</span> : null; } },
    { key: "ip", label: "IP", className: "font-mono text-xs text-ink2" },
  ];

  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";

  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Journal d'audit</h1><p className="text-sm text-ink2 mt-0.5">{tab === "journal" ? `${total} entrée${total > 1 ? "s" : ""}` : "Intégrité des écritures, constats du mois, revue des droits"}</p></div>
      <div className="flex gap-2" role="tablist">
        {([["journal", "Journal"], ["rapport", "Rapport d'audit"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(k === "rapport" ? "/audit?onglet=rapport" : "/audit")}
            className={`px-3 py-1.5 rounded-full text-sm ${tab === k ? "bg-section text-white" : "bg-surface2 text-ink2"}`}>{l}</button>
        ))}
      </div>
      {tab === "rapport" ? <AuditReportPanel /> : <>
      {entryId && (
        <p className="p-3 rounded-lg bg-section-soft text-sm">Historique d&apos;une seule écriture. <Link href="/audit" className="underline">Voir tout le journal</Link></p>
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={resource} onChange={e => { setResource(e.target.value); setPage(1); }} className={inp} aria-label="Ressource">
          <option value="">Toutes les ressources</option>
          {RESOURCE_FILTER.map(k => <option key={k} value={k}>{resLabel(k)}</option>)}
        </select>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} className={inp} aria-label="Du" />
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} className={inp} aria-label="Au" />
        <label className="flex items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={withReason} onChange={e => { setWithReason(e.target.checked); setPage(1); }} /> Avec motif seulement (corrections)
        </label>
      </div>
      <DataTable columns={columns} data={logs} loading={loading} keyExtractor={(l) => l._id} emptyMessage="Aucune entrée dans le journal d'audit." onRowClick={setDetail} />
      <p className="text-[11px] text-ink3">Cliquez sur une ligne (ou appuyez sur Entrée) pour voir le motif et les valeurs avant / après.</p>
      {detail && <LogDetail log={detail} onClose={() => setDetail(null)} />}
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
      </>}
    </div>
  );
}

export default function AuditPage() {
  return <Suspense fallback={<PageLoading />}><AuditScreen /></Suspense>;
}
