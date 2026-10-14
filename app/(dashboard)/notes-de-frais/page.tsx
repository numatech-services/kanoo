"use client";

import { useUrlReady } from "@/lib/url-param";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Receipt, Wallet, Clock, CheckCircle2 } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { FilterChips, Avatar, EmptyState } from "@/components/ui/Primitives";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { fullXof } from "@/components/ui/charts/geometry";
import { STATUS_LABEL, type ExpenseStatus } from "@/lib/expenses";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
interface Report {
  _id: string;
  reference: string;
  title: string;
  status: ExpenseStatus;
  totalTTC: number;
  totalVatDeducted: number;
  periodMonth?: number;
  periodYear?: number;
  createdAt: string;
  submittedAt?: string;
  employeeId?: { firstName?: string; lastName?: string; code?: string };
}

const FILTERS: Array<{ key: ExpenseStatus; label: string }> = [
  { key: "draft", label: "Brouillons" },
  { key: "submitted", label: "En validation" },
  { key: "approved", label: "À rembourser" },
  { key: "reimbursed", label: "Remboursées" },
  { key: "rejected", label: "Refusées" },
];

export default function NotesDeFraisPage() {
  const [items, setItems] = useState<Report[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Statut repris de l'adresse (carte « À rembourser » → ?status=approved).
  const [status, setStatus] = useState<string | null>(null);
  const ready = useUrlReady(p => { const s = p.get("status"); if (s) setStatus(s); });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!ready) return;
    const q = status ? `?status=${status}` : "";
    apiJson(`/api/expenses${q}`)
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setItems(d.data.items || []);
        setCounts(d.data.counts || {});
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, ready]);

  useEffect(() => { load(); }, [load]);

  const toReimburse = items.filter(r => r.status === "approved");
  const awaiting = counts.submitted || 0;
  const owed = toReimburse.reduce((s, r) => s + r.totalTTC, 0);
  const vatYear = items
    .filter(r => r.status === "approved" || r.status === "reimbursed")
    .reduce((s, r) => s + (r.totalVatDeducted || 0), 0);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Notes de frais</h1>
          <p className="text-sm text-ink2">
            Une dépense avancée par quelqu&apos;un, un justificatif, un remboursement.
            Sans la pièce, la charge n&apos;est pas déductible.
          </p>
        </div>
        <Link href="/notes-de-frais/new"
          className={buttonClass("primary", "md")}>
          <Plus size={16} /> Nouvelle note
        </Link>
      </div>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="À rembourser" value={owed} format={fullXof}
          icon={<Wallet size={17} />} tone={owed > 0 ? "pending" : "margin"}
          hint={`${toReimburse.length} note(s) approuvée(s)`} href="/notes-de-frais?status=approved" />
        <KpiCard label="En attente de validation" value={awaiting}
          icon={<Clock size={17} />} tone={awaiting > 0 ? "volume" : "margin"}
          hint={awaiting > 0 ? "Un salarié attend une réponse" : "Rien en attente"} />
        <KpiCard label="TVA récupérée" value={vatYear} format={fullXof}
          icon={<Receipt size={17} />} tone="revenue"
          hint="Sur les notes approuvées — la pièce en est la condition" />
      </div>

      <FilterChips
        options={FILTERS.map(f => ({ ...f, count: counts[f.key] }))}
        value={status}
        onChange={setStatus}
      />

      {loading ? (
        <div className="surface-card p-6 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-12 rounded-lg bg-surface2 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Receipt size={20} />}
          title={status ? `Aucune note « ${STATUS_LABEL[status as ExpenseStatus]} »` : "Aucune note de frais"}
          hint="Photographiez le reçu au moment où vous le recevez : un justificatif réclamé au retour au bureau est un justificatif déjà perdu."
          action={{ label: "Créer une note", href: "/notes-de-frais/new" }}
        />
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[48rem]">
              <thead>
                <tr>
                  <th>Référence</th><th>Objet</th><th>Bénéficiaire</th>
                  <th>Période</th><th className="text-right">Montant</th><th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map(report => {
                  const who = [report.employeeId?.firstName, report.employeeId?.lastName]
                    .filter(Boolean).join(" ") || "—";
                  return (
                    <tr key={report._id} className="cursor-pointer">
                      <td>
                        <Link href={`/notes-de-frais/${report._id}`}
                          className="font-mono text-xs text-section hover:underline">
                          {report.reference}
                        </Link>
                      </td>
                      <td className="text-ink">{report.title}</td>
                      <td>
                        <span className="flex items-center gap-2">
                          <Avatar name={who} size="sm" />
                          <span className="text-ink2 text-xs">{who}</span>
                        </span>
                      </td>
                      <td className="text-ink2 text-xs whitespace-nowrap">
                        {report.periodMonth
                          ? `${String(report.periodMonth).padStart(2, "0")}/${report.periodYear}`
                          : new Date(report.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="num text-right font-semibold text-ink">
                        {fullXof(report.totalTTC)}
                      </td>
                      <td><StatusBadge status={report.status}
                        label={STATUS_LABEL[report.status]} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {toReimburse.length > 0 && (
        <p className="px-4 py-3 rounded-xl bg-pos-50 border border-pos/25 text-sm text-pos flex items-start gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span>
            <strong className="num">{fullXof(owed)}</strong> approuvés et non encore versés.
            Tant que le remboursement n&apos;est pas enregistré, la dette reste ouverte au
            bilan et le salarié attend.
          </span>
        </p>
      )}
    </div>
  );
}
