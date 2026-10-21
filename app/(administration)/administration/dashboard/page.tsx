"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";

import { BarChart3, CheckCircle2, FileEdit, ScrollText } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { apiJson } from "@/lib/api-client";
interface BudgetChapter { _id: string; code: string; label: string; allocatedAmount: number; engagedAmount: number; paidAmount: number; }
interface Engagement { _id: string; reference: string; description: string; amount: number; status: string; createdAt: string; }
interface Marche { _id: string; reference: string; title: string; status: string; estimatedAmount: number; publishDate: string; }
interface Mandatement { _id: string; reference: string; description: string; amount: number; status: string; createdAt: string; }

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft:          { label: "Brouillon",   cls: "bg-surface2 text-ink2" },
  pending:        { label: "En attente",  cls: "bg-warn-50 text-warn" },
  approved:       { label: "Approuvé",   cls: "bg-pos-50 text-pos" },
  rejected:       { label: "Rejeté",     cls: "bg-neg-50 text-neg" },
  paid:           { label: "Payé",        cls: "bg-pos-50 text-pos" },
  published:      { label: "Publié",      cls: "bg-info-50 text-info" },
  evaluation:     { label: "Évaluation",  cls: "bg-section-soft text-section" },
  awarded:        { label: "Attribué",    cls: "bg-teal-100 text-teal-700" },
  cancelled:      { label: "Annulé",      cls: "bg-surface2 text-ink3" },
  sent:           { label: "Émis",        cls: "bg-info-50 text-info" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABELS[status] || { label: status, cls: "bg-surface2 text-ink2" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

function pct(engaged: number, total: number) { return total > 0 ? Math.min(100, Math.round((engaged / total) * 100)) : 0; }

export default function AdminDashboardPage() {
  const [mounted, setMounted]         = useState(false);
  const [chapters, setChapters]       = useState<BudgetChapter[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [marches, setMarches]         = useState<Marche[]>([]);
  const [mandatements, setMandatements] = useState<Mandatement[]>([]);
  
  const [loadingCh, setLoadingCh]     = useState(true);
  const [loadingEn, setLoadingEn]     = useState(true);
  const [loadingMa, setLoadingMa]     = useState(true);
  const [loadingMn, setLoadingMn]     = useState(true);

  useEffect(() => {
    setMounted(true);

    // Extraction sécurisée pour s'assurer d'obtenir un tableau
    const extractArray = <T,>(d: unknown): T[] => {
      if (!d) return [];
      if (Array.isArray(d)) return d;
      const o = d as { data?: unknown; chapters?: unknown; items?: unknown };
      if (o.data && Array.isArray(o.data)) return o.data;
      const nested = (o.data as { items?: unknown } | null | undefined)?.items;
      if (nested && Array.isArray(nested)) return nested;
      if (o.chapters && Array.isArray(o.chapters)) return o.chapters;
      if (o.items && Array.isArray(o.items)) return o.items;
      return [];
    };

    apiJson("/api/budget?flat=true")
      .then(d => setChapters(extractArray<BudgetChapter>(d)))
      .catch((e) => console.error(e))
      .finally(() => setLoadingCh(false));

    apiJson("/api/budget/engagements?limit=5&page=1")
      .then(d => setEngagements(extractArray<Engagement>(d)))
      .catch((e) => console.error(e))
      .finally(() => setLoadingEn(false));

    apiJson("/api/marches?limit=100&page=1")
      .then(d => setMarches(extractArray<Marche>(d)))
      .catch((e) => console.error(e))
      .finally(() => setLoadingMa(false));

    apiJson("/api/budget/mandatements?limit=5&page=1")
      .then(d => setMandatements(extractArray<Mandatement>(d)))
      .catch((e) => console.error(e))
      .finally(() => setLoadingMn(false));
  }, []);

  if (!mounted) return null;

  // Sécurisation stricte avant d'exécuter le reduce et filter
  const safeChapters = Array.isArray(chapters) ? chapters : [];
  const safeMarches = Array.isArray(marches) ? marches : [];
  const safeEngagements = Array.isArray(engagements) ? engagements : [];
  const safeMandatements = Array.isArray(mandatements) ? mandatements : [];

  const totalAlloue    = safeChapters.reduce((s, c) => s + ((c && c.allocatedAmount) || 0), 0);
  const totalEngage    = safeChapters.reduce((s, c) => s + ((c && c.engagedAmount) || 0), 0);
  const totalPaye      = safeChapters.reduce((s, c) => s + ((c && c.paidAmount) || 0), 0);
  const marchesEnCours = safeMarches.filter(m => m && !["cancelled","awarded"].includes(m.status)).length;

  const kpis = [
    { label: "Budget alloué",       value: loadingCh ? "—" : formatMoney(totalAlloue),  icon: <BarChart3 size={20} />, color: "bg-info-50 text-info",   href: "/administration/budget" },
    { label: "Crédits engagés",     value: loadingCh ? "—" : formatMoney(totalEngage),  icon: <FileEdit size={20} />, color: "bg-warn-50 text-warn", href: "/administration/budget/engagements" },
    { label: "Mandatements payés",  value: loadingCh ? "—" : formatMoney(totalPaye),    icon: <CheckCircle2 size={20} />, color: "bg-pos-50 text-pos",  href: "/administration/budget/mandatements" },
    { label: "Marchés en cours",    value: loadingMa ? "—" : String(marchesEnCours), icon: <ScrollText size={20} />, color: "bg-section-soft text-section", href: "/administration/marches-publics" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Tableau de bord — Administration</h1>
        <p className="text-sm text-ink2 mt-0.5">Exercice {new Date().getFullYear()}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(c => (
          <Link key={c.label} href={c.href} className="bg-surface rounded-xl border border-line p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-ink2 font-medium uppercase tracking-wide">{c.label}</p>
                <p className="text-2xl font-bold text-ink mt-1">{c.value}</p>
              </div>
              <span className={`text-2xl p-2 rounded-lg ${c.color}`}>{c.icon}</span>
            </div>
          </Link>
        ))}
      </div>

      <UpcomingAgenda agendaHref="/administration/agenda" />

      {/* Taux d'exécution budgétaire par chapitre */}
      <div className="bg-surface rounded-xl border border-line p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-ink">Exécution budgétaire par chapitre</h2>
          <Link href="/administration/budget" className="text-xs text-section hover:underline">Voir tout →</Link>
        </div>
        {loadingCh ? (
          <div className="space-y-3">{[...Array(3)].map((_,i) => <div key={i} className="h-8 bg-surface2 animate-pulse rounded" />)}</div>
        ) : safeChapters.length === 0 ? (
          <p className="text-sm text-ink2 text-center py-6">Aucun chapitre budgétaire</p>
        ) : (
          <div className="space-y-4">
            {safeChapters.slice(0, 5).map(ch => {
              if (!ch) return null;
              const p = pct(ch.engagedAmount, ch.allocatedAmount);
              return (
                <div key={ch._id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink font-medium truncate max-w-xs">{ch.code} — {ch.label}</span>
                    <span className="text-ink2 ml-2 shrink-0">{p}% <span className="text-xs">({formatMoney(ch.engagedAmount)} / {formatMoney(ch.allocatedAmount)})</span></span>
                  </div>
                  <div className="h-2 bg-surface2 rounded-full">
                    <div className={`h-2 rounded-full transition-all ${p > 90 ? "bg-neg" : p > 70 ? "bg-warn" : "bg-section"}`} style={{ width: `${p}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Engagements récents */}
        <div className="bg-surface rounded-xl border border-line">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink">Engagements récents</h2>
            <Link href="/administration/budget/engagements" className="text-xs text-section hover:underline">Voir tout →</Link>
          </div>
          {loadingEn ? (
            <div className="p-4 space-y-2">{[...Array(4)].map((_,i) => <div key={i} className="h-10 bg-surface2 animate-pulse rounded" />)}</div>
          ) : safeEngagements.length === 0 ? (
            <p className="text-sm text-ink2 text-center py-10">Aucun engagement</p>
          ) : (
            <div className="divide-y divide-line">
              {safeEngagements.map(e => {
                if (!e) return null;
                return (
                  <div key={e._id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{e.description || e.reference}</p>
                      <p className="text-xs font-mono text-ink2">{e.reference}</p>
                    </div>
                    <span className="font-mono text-sm font-semibold shrink-0">{formatMoney(e.amount)}</span>
                    <StatusPill status={e.status} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Marchés récents */}
        <div className="bg-surface rounded-xl border border-line">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink">Marchés publics</h2>
            <Link href="/administration/marches-publics" className="text-xs text-section hover:underline">Voir tout →</Link>
          </div>
          {loadingMa ? (
            <div className="p-4 space-y-2">{[...Array(4)].map((_,i) => <div key={i} className="h-10 bg-surface2 animate-pulse rounded" />)}</div>
          ) : safeMarches.length === 0 ? (
            <p className="text-sm text-ink2 text-center py-10">Aucun marché</p>
          ) : (
            <div className="divide-y divide-line">
              {safeMarches.slice(0, 5).map(m => {
                if (!m) return null;
                return (
                  <Link key={m._id} href={`/administration/marches-publics/${m._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface2/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{m.title}</p>
                      <p className="text-xs font-mono text-ink2">{m.reference}</p>
                    </div>
                    <span className="font-mono text-sm text-ink2 shrink-0">{formatMoney(m.estimatedAmount)}</span>
                    <StatusPill status={m.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mandatements récents */}
      <div className="bg-surface rounded-xl border border-line">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold text-ink">Mandatements récents</h2>
          <Link href="/administration/budget/mandatements" className="text-xs text-section hover:underline">Voir tout →</Link>
        </div>
        {loadingMn ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-10 bg-surface2 animate-pulse rounded" />)}</div>
        ) : safeMandatements.length === 0 ? (
          <p className="text-sm text-ink2 text-center py-8">Aucun mandatement</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr className="border-b border-line bg-surface2/50">
                {["Référence","Description","Montant","Statut"].map(h => <th key={h} >{h}</th>)}
              </tr></thead>
              <tbody>
                {safeMandatements.map(m => {
                  if (!m) return null;
                  return (
                    <tr key={m._id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-section">{m.reference}</td>
                      <td className="px-4 py-3 text-ink">{m.description}</td>
                      <td className="px-4 py-3 font-mono font-semibold">{formatMoney(m.amount)}</td>
                      <td className="px-4 py-3"><StatusPill status={m.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}