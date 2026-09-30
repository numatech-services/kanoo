"use client";
import { useState, useEffect, useCallback, ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { ClientForm, type ClientFormData } from "@/components/pme/ClientForm";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Client = ClientFormData & { _id: string; currentBalance: number; logo?: string };
type Row = Record<string, unknown>;
interface Section { count: number; items: Row[]; }
interface Overview {
  client: Client;
  /** null : le compte n'a pas accès aux informations financières. */
  financials: { invoiced: number; paid: number; outstanding: number } | null;
  sections: {
    invoices: Section; devis: Section; contracts: Section;
    marches: Section; deliveries: Section; projects: Section; dunning: Section;
  };
  access?: Partial<Record<keyof Overview["sections"] | "createInvoice", boolean>>;
}

const fmt = (n: unknown) => `${Number(n || 0).toLocaleString("fr-FR")} F CFA`;
const date = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("fr-FR") : "—");

/** Une rubrique = un onglet : colonnes + rendu de ligne + lien « voir tout ». */
interface TabDef {
  key: keyof Overview["sections"];
  label: string;
  cols: string[];
  row: (r: Row, id: string) => ReactNode[];
  href?: (id: string) => string;
  rowHref?: (r: Row) => string;
}

const TABS: TabDef[] = [
  { key: "invoices", label: "Factures", cols: ["N°", "Date", "TTC", "Statut"],
    row: r => [r.number as string, date(r.issueDate), fmt(r.totalTTC), <StatusBadge key="s" status={String(r.status)} />],
    href: id => `/invoices?clientId=${id}`, rowHref: r => `/invoices/${r._id}` },
  { key: "devis", label: "Devis", cols: ["N°", "Date", "TTC", "Statut"],
    row: r => [r.number as string, date(r.issueDate), fmt(r.totalTTC), <StatusBadge key="s" status={String(r.status)} />],
    href: id => `/devis?clientId=${id}`, rowHref: r => `/devis/${r._id}` },
  { key: "contracts", label: "Contrats", cols: ["Référence", "Objet", "Montant", "Échéance", "Statut"],
    row: r => [r.reference as string || "—", r.title as string, fmt(r.amount), date(r.endDate), <StatusBadge key="s" status={String(r.status)} />],
    href: () => `/contracts`, rowHref: r => `/contracts/${r._id}` },
  { key: "marches", label: "Marchés-cadres", cols: ["Référence", "Objet", "Avancement", "Statut"],
    row: r => [r.reference as string, r.title as string,
      `${Number(r.deliveredQuantity || 0).toLocaleString("fr-FR")} / ${Number(r.totalQuantity || 0).toLocaleString("fr-FR")}`,
      <StatusBadge key="s" status={String(r.status)} />],
    href: () => `/marches-cadres`, rowHref: r => `/marches-cadres/${r._id}` },
  { key: "deliveries", label: "Livraisons", cols: ["N°", "Date", "Statut"],
    row: r => [r.number as string, date(r.deliveryDate), <StatusBadge key="s" status={String(r.status)} />],
    href: () => `/livraisons` },
  { key: "projects", label: "Projets", cols: ["Intitulé", "Échéance", "Montant", "Statut"],
    row: r => [r.label as string, date(r.dueDate), fmt(r.amount), <StatusBadge key="s" status={String(r.status)} />],
    href: () => `/projects` },
  { key: "dunning", label: "Relances", cols: ["Date", "Canaux", "Facture"],
    row: r => [date(r.sentAt), Array.isArray(r.channels) ? (r.channels as string[]).join(", ") : "—", r.invoiceNumber as string || "—"] },
];

export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<keyof Overview["sections"]>("invoices");
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/clients/${id}/overview`, { credentials: "include" })
      .then(r => r.json()).then(d => d.success && setData(d.data));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function handleSave(body: ClientFormData) {
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify(body),
    });
    if (res.ok) { setEditOpen(false); load(); }
  }

  if (!data) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  const c = data.client;
  // Onglets limités aux ressources que le compte peut lire (cloisonnement).
  const tabs = TABS.filter(t => data.access?.[t.key] ?? true);
  const active = tabs.find(t => t.key === tab) ?? tabs[0];
  const section = active ? data.sections[active.key] : null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* En-tête : logo + identité + actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl border border-line bg-surface2 grid place-items-center overflow-hidden shrink-0">
            {c.logo ? <img src={c.logo} alt="" className="max-w-full max-h-full object-contain" />
              : <span className="text-lg font-bold text-ink3">{c.name?.[0]?.toUpperCase() || "?"}</span>}
          </div>
          <div>
            <a href="/clients" className="text-xs text-ink2 hover:text-ink">← Clients</a>
            <h1 className="text-2xl font-bold text-ink mt-0.5">{c.name}</h1>
            <p className="text-ink2 text-sm">{c.code} · {c.type === "company" ? "Entreprise" : "Particulier"} · <StatusBadge status={c.isActive ? "active" : "inactive"} /></p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setEditOpen(true)} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">Modifier</button>
          {data.financials && <a href={`/clients/${id}/releve`} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">Relevé</a>}
          {data.access?.createInvoice !== false && <a href={`/invoices/new?clientId=${id}`} className="px-4 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95">+ Facture</a>}
        </div>
      </div>

      {/* Synthèse financière */}
      {data.financials && <div className="grid grid-cols-3 gap-4">
        {([["Facturé", data.financials.invoiced, "text-ink"], ["Encaissé", data.financials.paid, "text-pos"], ["Restant dû", data.financials.outstanding, "text-neg"]] as [string, number, string][]).map(([k, v, cls]) => (
          <div key={k} className="bg-surface rounded-xl border border-line p-4">
            <p className="text-[11px] font-semibold text-ink2 uppercase tracking-wide">{k}</p>
            <p className={`text-xl font-bold mt-1 ${cls}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>}

      {/* Informations */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-surface rounded-xl border border-line p-5">
          <h2 className="font-semibold text-ink mb-3">Informations</h2>
          {([["NIF", c.nif || "—"], ["RCCM", c.rccm || "—"], ["Email", c.email || "—"], ["Téléphone", c.phone || "—"], ["Adresse", c.address || "—"]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2 border-b border-line last:border-0 text-sm"><span className="text-ink2">{k}</span><span className="text-ink text-right">{v}</span></div>
          ))}
        </div>
        <div className="bg-surface rounded-xl border border-line p-5">
          <h2 className="font-semibold text-ink mb-3">Conditions commerciales</h2>
          {([["Limite de crédit", `${(c.creditLimit || 0).toLocaleString("fr-FR")} F CFA`], ["Délai de paiement", `${c.paymentTermDays} jours`]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between py-2 border-b border-line last:border-0 text-sm"><span className="text-ink2">{k}</span><span className="font-mono font-medium text-ink">{v}</span></div>
          ))}
          {c.notes ? <p className="text-xs text-ink2 mt-3 whitespace-pre-wrap">{c.notes}</p> : null}
        </div>
      </div>

      {/* Onglets des rattachements */}
      {active && section && <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${active.key === t.key ? "bg-section/10 text-section" : "text-ink2 hover:text-ink hover:bg-surface2"}`}>
              {t.label} <span className="ml-1 text-xs opacity-70">{data.sections[t.key].count}</span>
            </button>
          ))}
        </div>
        <div className="p-1">
          {section.items.length === 0 ? (
            <p className="text-sm text-ink3 px-4 py-8 text-center">Aucun élément dans cette rubrique.</p>
          ) : (
            <table className="table-dense w-full">
              <thead><tr className="bg-surface2/50">{active.cols.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {section.items.map((r, i) => {
                  const href = active.rowHref?.(r);
                  return (
                    <tr key={String(r._id) || i} className={`border-t border-line ${href ? "cursor-pointer hover:bg-surface2/30" : ""}`}
                      onClick={href ? () => router.push(href) : undefined}>
                      {active.row(r, String(id)).map((cell, j) => <td key={j} className="px-4 py-2.5">{cell}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {active.href && section.count > section.items.length && (
            <div className="px-4 py-2 text-right"><a href={active.href(String(id))} className="text-xs text-section hover:underline">Voir les {section.count} →</a></div>
          )}
        </div>
      </div>}

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier — ${c.name}`} size="lg">
        <ClientForm initial={c} onSave={handleSave} onCancel={() => setEditOpen(false)} />
      </Modal>
    </div>
  );
}
