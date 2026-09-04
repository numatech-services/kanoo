"use client";
import { useState, useEffect, useCallback, ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { SupplierForm, type SupplierFormData } from "@/components/pme/SupplierForm";

type Supplier = SupplierFormData & { _id: string; logo?: string; bankName?: string };
type Row = Record<string, unknown>;
interface Section { count: number; items: Row[]; }
interface Overview {
  supplier: Supplier;
  financials: { ordered: number; engaged: number };
  sections: { commandes: Section; contracts: Section; receipts: Section; commitments: Section; recurring: Section; };
}

const fmt = (n: unknown) => `${Number(n || 0).toLocaleString("fr-FR")} F CFA`;
const date = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("fr-FR") : "—");

const FREQ: Record<string, string> = { monthly: "Mensuel", quarterly: "Trimestriel", biannual: "Semestriel", annual: "Annuel", weekly: "Hebdo" };

interface TabDef {
  key: keyof Overview["sections"];
  label: string;
  cols: string[];
  row: (r: Row) => ReactNode[];
  href?: string;
  rowHref?: (r: Row) => string;
}

const TABS: TabDef[] = [
  { key: "commandes", label: "Commandes", cols: ["N°", "Date", "TTC", "Statut"],
    row: r => [r.number as string, date(r.orderDate), fmt(r.totalTTC), <StatusBadge key="s" status={String(r.status)} />],
    href: "/commandes", rowHref: r => `/commandes/${r._id}` },
  { key: "contracts", label: "Contrats", cols: ["Référence", "Objet", "Montant", "Échéance", "Statut"],
    row: r => [r.reference as string || "—", r.title as string, fmt(r.amount), date(r.endDate), <StatusBadge key="s" status={String(r.status)} />],
    href: "/contracts", rowHref: r => `/contracts/${r._id}` },
  { key: "receipts", label: "Réceptions", cols: ["N°", "Date"],
    row: r => [r.number as string, date(r.receiptDate)] },
  { key: "commitments", label: "Engagements", cols: ["N°", "Objet", "Date", "Montant", "Statut"],
    row: r => [r.number as string, r.label as string, date(r.date), fmt(r.amount), <StatusBadge key="s" status={String(r.status)} />] },
  { key: "recurring", label: "Dépenses récurrentes", cols: ["Réf", "Objet", "Montant", "Fréquence", "Prochaine"],
    row: r => [r.reference as string || "—", r.label as string, fmt(r.amount), FREQ[String(r.frequency)] || String(r.frequency || "—"), date(r.nextDueDate)],
    href: "/recurring-expenses" },
];

export default function SupplierDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<keyof Overview["sections"]>("commandes");
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/suppliers/${id}/overview`, { credentials: "include" })
      .then(r => r.json()).then(d => d.success && setData(d.data));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function handleSave(body: SupplierFormData) {
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const res = await fetch(`/api/suppliers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Enregistrement impossible.");
    setEditOpen(false); load();
  }

  if (!data) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  const s = data.supplier;
  const active = TABS.find(t => t.key === tab)!;
  const section = data.sections[tab];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl border border-line bg-surface2 grid place-items-center overflow-hidden shrink-0">
            {s.logo ? <img src={s.logo} alt="" className="max-w-full max-h-full object-contain" />
              : <span className="text-lg font-bold text-ink3">{s.name?.[0]?.toUpperCase() || "?"}</span>}
          </div>
          <div>
            <a href="/suppliers" className="text-xs text-ink2 hover:text-ink">← Fournisseurs</a>
            <h1 className="text-2xl font-bold text-ink mt-0.5">{s.name}</h1>
            <p className="text-ink2 text-sm">{s.code} · <StatusBadge status={s.isActive ? "active" : "inactive"} /></p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setEditOpen(true)} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">Modifier</button>
          <a href={`/commandes/new?supplierId=${id}`} className="px-4 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95">+ Commande</a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {([["Commandé (hors annulées)", data.financials.ordered], ["Engagé", data.financials.engaged]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="bg-surface rounded-xl border border-line p-4">
            <p className="text-[11px] font-semibold text-ink2 uppercase tracking-wide">{k}</p>
            <p className="text-xl font-bold mt-1 text-ink">{fmt(v)}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink mb-3">Informations</h2>
        <div className="grid sm:grid-cols-2 gap-x-8">
          {([["NIF", s.nif || "—"], ["RCCM", s.rccm || "—"], ["Email", s.email || "—"], ["Téléphone", s.phone || "—"], ["Adresse", s.address || "—"], ["Banque", s.bankName || "—"], ["RIB", s.bankAccount || "—"], ["Délai de paiement", `${s.paymentTermDays} jours`]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2 border-b border-line text-sm"><span className="text-ink2">{k}</span><span className="text-ink text-right">{v}</span></div>
          ))}
        </div>
        {s.notes ? <p className="text-xs text-ink2 mt-3 whitespace-pre-wrap">{s.notes}</p> : null}
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${tab === t.key ? "bg-section/10 text-section" : "text-ink2 hover:text-ink hover:bg-surface2"}`}>
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
                      {active.row(r).map((cell, j) => <td key={j} className="px-4 py-2.5">{cell}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {active.href && section.count > section.items.length && (
            <div className="px-4 py-2 text-right"><a href={active.href} className="text-xs text-section hover:underline">Voir les {section.count} →</a></div>
          )}
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier — ${s.name}`} size="lg">
        <SupplierForm initial={s as unknown as Partial<SupplierFormData>} onSave={handleSave} onCancel={() => setEditOpen(false)} />
      </Modal>
    </div>
  );
}
