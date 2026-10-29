"use client";

import { IfCan } from "@/components/shared/IfCan";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Megaphone, Plus, Clock, Eye, FolderOpen, Send, Scale, Trophy, Archive, CalendarClock, Briefcase,
  Search, Download, BellRing, SlidersHorizontal, Columns3, List, Move, CalendarDays, BarChart3,
} from "lucide-react";
import { compactXof } from "@/components/ui/charts/geometry";
import { showToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { AppelResultDialog, LOSS_LABEL } from "@/components/appels/AppelResultDialog";
import { useMe, meCanDo } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import { MetricCard, PillTabs } from "@/components/ui/MetricCard";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { todayLocal } from "@/lib/format";
import { useEffect } from "react";

type Person = { _id?: string; firstName?: string; lastName?: string } | null;
export interface Appel {
  _id: string; title: string; organism?: string; reference?: string;
  submissionDeadline?: string; status: string; estimatedAmount: number;
  requiredDocuments?: { label: string; provided: boolean }[];
  goNoGo?: { decision: "go" | "review" | "no_go"; score: number };
  ownerId?: Person;
  stageChangedAt?: string; updatedAt?: string; createdAt?: string;
  result?: { lossReason?: string; offerAmount?: number; submittedAt?: string };
}

export const APPEL_STATUS: Record<string, { label: string; cls: string }> = {
  identified: { label: "Identifié", cls: "bg-surface2 text-ink2 border-line" },
  preparing: { label: "En préparation", cls: "bg-info-50 text-info border-info/25" },
  submitted: { label: "Déposé", cls: "bg-section-soft text-section border-section/25" },
  evaluation: { label: "En évaluation", cls: "bg-warn-50 text-warn border-warn/25" },
  won: { label: "Gagné", cls: "bg-pos-50 text-pos border-pos/25" },
  lost: { label: "Perdu", cls: "bg-neg-50 text-neg border-neg/25" },
  cancelled: { label: "Annulé", cls: "bg-surface2 text-ink3 border-line" },
};

/** Jours restants avant la date limite + classe d'urgence. */
export function deadlineInfo(iso?: string): { text: string; cls: string } | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `Dépassé de ${-days} j`, cls: "text-neg" };
  if (days === 0) return { text: "Aujourd'hui", cls: "text-neg font-semibold" };
  if (days <= 3) return { text: `${days} j restants`, cls: "text-warn font-semibold" };
  return { text: `${days} j restants`, cls: "text-ink2" };
}

const COLUMNS: Array<{ status: string; title: string; sub: string; icon: React.ReactNode; chip: string }> = [
  { status: "identified", title: "Intéressé", sub: "Avis repéré · analyse Go / No-Go", icon: <Eye size={16} />, chip: "bg-ink3/80 text-onink" },
  { status: "preparing", title: "Dossier en préparation", sub: "Pièces, offres technique et financière", icon: <FolderOpen size={16} />, chip: "bg-[rgb(214_134_40)] text-white" },
  { status: "submitted", title: "Dossier déposé", sub: "Offre remise à l'acheteur", icon: <Send size={16} />, chip: "bg-[rgb(47_89_223)] text-white" },
  { status: "evaluation", title: "En évaluation", sub: "Ouverture des plis · analyse", icon: <Scale size={16} />, chip: "bg-[rgb(110_68_188)] text-white" },
];
const NEXT_STEP: Record<string, { to: string; label: string }> = {
  identified: { to: "preparing", label: "Préparer le dossier" },
  preparing: { to: "submitted", label: "Marquer déposé" },
  submitted: { to: "evaluation", label: "Passer en évaluation" },
};
type Tab = "open" | "won" | "calendar" | "stats" | "archive";
interface Executing { count: number; amount: number; invoicedRate: number }
interface WonContract { _id: string; reference: string; title: string; amount: number; status: string; appelId: string; invoicedHT: number }
interface KeyDate { id: string; kind: string; label: string; title: string; detail?: string; date: string; href: string; owner?: string }

const fmtM = (n: number) => `${compactXof(n)}`;
const daysTo = (iso?: string) => (iso ? Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null);
const personName = (p?: Person) => [p?.firstName, p?.lastName].filter(Boolean).join(" ");
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
const norm = (s?: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Suivi des marchés : de l'avis repéré à la décision, chaque offre avance
 * d'étape en étape (glisser-déposer ou bouton). Un marché obtenu passe dans
 * « Marchés obtenus » ; un suivi arrêté (perdu, abandonné) part aux archives.
 * Les échéances (questions, visite, dépôt, ouverture, cautions, jalons) sont
 * lues dans les dossiers : rappels de la semaine et onglet Calendrier.
 */
export default function AppelsListPage() {
  const router = useRouter();
  const me = useMe();
  const canMove = meCanDo(me, "appels", "update");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [layout, setLayout] = useState<"kanban" | "list">("kanban");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ a: Appel; outcome: "won" | "lost" } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const list = useApi<Appel[]>("/api/appels?limit=1000", d => d?.data?.items || [], []);
  const pipeline = useApi<{ executing?: Executing; contracts?: WonContract[] } | null>("/api/appels/pipeline", p => p?.data ?? null, null);
  const week = useApi<KeyDate[]>("/api/appels/reminders?days=7&cautionDays=30", d => d?.data ?? [], []);
  const quarter = useApi<KeyDate[]>(tab === "calendar" ? "/api/appels/reminders?days=90&cautionDays=90" : null, d => d?.data ?? [], []);
  const all = list.data;
  const executing = pipeline.data?.executing ?? null;
  const won = pipeline.data?.contracts ?? [];
  const loading = list.loading || pipeline.loading;
  const load = () => { list.reload(); pipeline.reload(); week.reload(); };

  const q = norm(query.trim());
  const items = q ? all.filter(a => norm([a.title, a.organism, a.reference, personName(a.ownerId)].join(" ")).includes(q)) : all;

  async function move(a: Appel, to: string, label: string, result?: unknown) {
    if (a.status === to) return;
    setBusy(a._id);
    try {
      const res = await apiSend("PATCH", `/api/appels/${a._id}`, { status: to, ...(result ? { result } : {}) });
      if (!res.ok) { showToast(res.data?.error || "Changement refusé.", "error"); return; }
      showToast(`${a.title} : ${label.toLowerCase()}.`, "success");
      if (to === "won") router.push(`/appels/${a._id}`); else load();
    } finally { setBusy(null); }
  }

  const inProgress = items.filter(a => COLUMNS.some(c => c.status === a.status));
  const wonItems = items.filter(a => a.status === "won");
  const archived = items.filter(a => ["lost", "cancelled"].includes(a.status));
  const decided = all.filter(a => ["won", "lost"].includes(a.status));
  const wonAll = decided.filter(a => a.status === "won");
  const successRate = decided.length ? Math.round((wonAll.length / decided.length) * 100) : null;
  const nextDeposit = all.filter(a => ["identified", "preparing"].includes(a.status) && (daysTo(a.submissionDeadline) ?? -1) >= 0)
    .sort((x, y) => new Date(x.submissionDeadline!).getTime() - new Date(y.submissionDeadline!).getTime())[0];
  const openAll = all.filter(a => COLUMNS.some(c => c.status === a.status));
  const inPlay = openAll.reduce((t, a) => t + (a.estimatedAmount || 0), 0);
  const shownInPlay = inProgress.reduce((t, a) => t + (a.estimatedAmount || 0), 0);

  function exportCsv() {
    const rows = (tab === "won" ? wonItems : tab === "archive" ? archived : inProgress);
    // Une cellule commençant par = + - @ serait exécutée comme formule par le tableur : neutralisée.
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Intitulé", "Organisme", "Référence", "Étape", "Date limite", "Montant estimé (FCFA)", "Responsable", "Go / No-Go", "Motif du rejet"];
    const body = rows.map(a => [a.title, a.organism, a.reference, APPEL_STATUS[a.status]?.label, a.submissionDeadline ? new Date(a.submissionDeadline).toLocaleDateString("fr-FR") : "",
      Math.round(a.estimatedAmount || 0), personName(a.ownerId), a.goNoGo ? `${a.goNoGo.decision} ${a.goNoGo.score}` : "", a.result?.lossReason ? LOSS_LABEL[a.result.lossReason] : ""]);
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `suivi-des-marches-${todayLocal()}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  const TABS: Array<[Tab, string, number | null, React.ReactNode]> = [
    ["open", "Offres en cours", inProgress.length, <Megaphone key="i" size={15} />],
    ["won", "Marchés obtenus", wonItems.length, <Briefcase key="t" size={15} />],
    ["calendar", "Calendrier", null, <CalendarDays key="c" size={15} />],
    ["stats", "Statistiques", null, <BarChart3 key="s" size={15} />],
    ["archive", "Archives", archived.length, <Archive key="a" size={15} />],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Appels d&apos;offres &amp; marchés</p>
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1">Suivi des marchés</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCsv} className="h-11 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
            <Download size={16} /> Exporter
          </button>
          <IfCan resource="appels">
            <button onClick={() => setOpen(true)} className="h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105">
              <Plus size={17} /> Nouvel appel d&apos;offres
            </button>
          </IfCan>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs label="Suivi des marchés" value={tab} onChange={setTab} tabs={TABS.map(([key, label, count, icon]) => ({ key, label, count, icon }))} />
        <label className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer : marché, acheteur, responsable…" aria-label="Filtrer les offres"
            className="w-full h-10 pl-10 pr-4 rounded-full border border-line bg-surface text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-section/30" />
        </label>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<Megaphone size={18} />} tone="blue" label="Offres en cours" value={String(openAll.length)} sub={`${fmtM(inPlay)} FCFA en jeu`} />
        <MetricCard icon={<CalendarClock size={18} />} tone="red" label="Prochain dépôt"
          value={nextDeposit ? `J-${daysTo(nextDeposit.submissionDeadline)}` : "—"} valueCls={nextDeposit && (daysTo(nextDeposit.submissionDeadline) ?? 99) <= 3 ? "text-neg" : ""} sub={nextDeposit?.title ?? "Aucun dépôt en vue"} />
        <MetricCard icon={<Trophy size={18} />} tone="green" label="Taux de réussite" value={successRate === null ? "—" : `${successRate} %`} sub={`${wonAll.length} gagné${wonAll.length > 1 ? "s" : ""} · ${decided.length - wonAll.length} perdu${decided.length - wonAll.length > 1 ? "s" : ""}`} />
        <MetricCard icon={<Briefcase size={18} />} tone="violet" label="Marchés en exécution" value={executing ? String(executing.count) : "—"} sub={executing ? `${fmtM(executing.amount)} FCFA · ${executing.invoicedRate} % facturé` : "Accès aux contrats requis"} />
      </div>

      {tab === "open" && <WeekReminders items={week.data} loading={week.loading} />}

      {loading ? <div className="h-72 rounded-[22px] bg-surface border border-line animate-pulse" /> : tab === "open" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-1 rounded-xl bg-surface2 gap-1" role="group" aria-label="Affichage">
              {([["kanban", "Kanban", <Columns3 key="k" size={14} />], ["list", "Liste", <List key="l" size={14} />]] as const).map(([k, l, ic]) => (
                <button key={k} aria-pressed={layout === k} onClick={() => setLayout(k)}
                  className={`h-8 px-3 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 ${layout === k ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>{ic} {l}</button>
              ))}
            </div>
            <span className="text-[13px] text-ink3 num">{inProgress.length} offre{inProgress.length > 1 ? "s" : ""} · {fmtM(shownInPlay)} FCFA</span>
            {layout === "kanban" && canMove ? <span className="hidden sm:inline-flex text-[12.5px] text-ink3 items-center gap-1.5"><Move size={13} /> Glissez une carte pour changer d&apos;étape</span> : <span />}
          </div>

          {layout === "kanban" ? (
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
              {COLUMNS.map(col => {
                const colItems = inProgress.filter(a => a.status === col.status).sort((x, y) => (daysTo(x.submissionDeadline) ?? 999) - (daysTo(y.submissionDeadline) ?? 999));
                return (
                  <section key={col.status} aria-label={col.title}
                    onDragOver={canMove ? (e => { e.preventDefault(); setDragOver(col.status); }) : undefined}
                    onDragLeave={() => setDragOver(d => (d === col.status ? null : d))}
                    onDrop={canMove ? (e => {
                      e.preventDefault(); setDragOver(null);
                      const a = all.find(x => x._id === e.dataTransfer.getData("text/appel"));
                      if (a && a.status !== col.status) move(a, col.status, col.title);
                    }) : undefined}
                    className={`flex-1 min-w-[260px] snap-start rounded-[22px] border p-3 flex flex-col gap-3 transition-colors ${dragOver === col.status ? "bg-section-soft/60 border-section/40" : "bg-surface2/70 border-line"}`}>
                    <header className="flex items-start gap-2.5 px-1 pt-1">
                      <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${col.chip}`}>{col.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-bold text-ink">{col.title}</span>
                        <span className="block text-[11.5px] text-ink3 leading-snug">{col.sub}</span>
                      </span>
                      <span className="num text-[12px] font-bold w-7 h-7 rounded-full bg-surface border border-line grid place-items-center">{colItems.length}</span>
                    </header>
                    <p className="px-1 text-[12px] font-semibold text-ink3 num">{fmtM(colItems.reduce((t, a) => t + (a.estimatedAmount || 0), 0))} FCFA</p>
                    {colItems.length === 0 && <p className="text-[12.5px] text-ink3 text-center py-6">Aucune offre à cette étape.</p>}
                    {colItems.map(a => (
                      <OfferCard key={a._id} a={a} busy={busy === a._id} draggable={canMove}
                        onMove={(to, label) => (to === "won" || to === "lost" ? setDeciding({ a, outcome: to }) : move(a, to, label))} />
                    ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <OffersTable items={inProgress} />
          )}
        </>
      ) : tab === "won" ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {wonItems.length === 0 && <p className="text-sm text-ink3">Aucun marché obtenu pour l&apos;instant.</p>}
          {wonItems.map(a => {
            const c = won.find(w => w.appelId === a._id);
            const rate = c && c.amount > 0 ? Math.min(100, Math.round((c.invoicedHT / c.amount) * 100)) : 0;
            return (
              <Link key={a._id} href={c ? `/contracts/${c._id}` : `/appels/${a._id}`} className="bg-surface rounded-[22px] border border-line shadow-card p-5 lift hover:border-accent/30 flex flex-col gap-2">
                <span className="flex items-center gap-2"><Avatar name={a.organism || a.title} /><span className="text-[12.5px] text-ink2 truncate flex-1">{a.organism || "—"}</span>{a.reference && <span className="text-[11px] font-mono text-ink3">{a.reference}</span>}</span>
                <span className="text-[15px] font-bold text-ink leading-snug">{a.title}</span>
                <span className="num text-[20px] font-extrabold text-ink">{fmtM(c?.amount ?? a.estimatedAmount)} <span className="text-[12px] font-semibold text-ink3">FCFA</span></span>
                {c ? (
                  <>
                    <span className="h-2 rounded-full bg-surface2 overflow-hidden"><span className="block h-full grad-brand" style={{ width: `${rate}%` }} /></span>
                    <span className="text-[12px] text-ink3">Marché {c.reference} · {rate} % facturé</span>
                  </>
                ) : <span className="text-[12px] font-semibold text-accent">Créer le marché →</span>}
              </Link>
            );
          })}
        </div>
      ) : tab === "calendar" ? (
        <KeyDatesCalendar items={quarter.data} loading={quarter.loading} />
      ) : tab === "stats" ? (
        <Stats all={all} />
      ) : (
        <div className="bg-surface rounded-[22px] border border-line shadow-card divide-y divide-line overflow-hidden">
          {archived.length === 0 && <p className="text-sm text-ink3 p-6">Aucune archive.</p>}
          {archived.map(a => (
            <Link key={a._id} href={`/appels/${a._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface2/50">
              <Avatar name={a.organism || a.title} />
              <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-ink truncate">{a.title}</span><span className="block text-[12px] text-ink3 truncate">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}{a.result?.lossReason ? ` · ${LOSS_LABEL[a.result.lossReason]}` : ""}</span></span>
              <span className="num text-[13px] font-bold text-ink2">{fmtM(a.estimatedAmount)} FCFA</span>
              <span className={`pill ${a.status === "lost" ? "pill-neg" : "pill-mute"}`}>{a.status === "lost" ? "Non retenu" : "Abandonné"}</span>
            </Link>
          ))}
        </div>
      )}

      {deciding && (
        <AppelResultDialog outcome={deciding.outcome} title={deciding.a.title} onClose={() => setDeciding(null)}
          onSave={async (result) => { const d = deciding; setDeciding(null); await move(d.a, d.outcome, d.outcome === "won" ? "Obtenu" : "Non retenu", result); }} />
      )}
      {open && <NewAppel onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); router.push(`/appels/${id}`); }} />}
    </div>
  );
}

/** Pastille d'initiales, couleur stable par nom (organisme ou responsable). */
function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const ini = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const colors = ["194 39 45", "0 150 180", "200 110 40", "47 89 223", "110 68 188", "0 120 64"];
  return <span className="rounded-full grid place-items-center text-[10.5px] font-bold text-white shrink-0" style={{ width: size, height: size, background: `rgb(${colors[h % colors.length]})` }} aria-hidden>{ini}</span>;
}

/** J-x : rouge à 3 jours, ambre à 7, bleu au-delà. */
const urgency = (days: number) => (days <= 3 ? "bg-neg-50 text-neg" : days <= 7 ? "bg-warn-50 text-warn" : "bg-accent-50 text-accent");

function WeekReminders({ items, loading }: { items: KeyDate[]; loading: boolean }) {
  const inWeek = items.filter(k => (daysTo(k.date) ?? 99) <= 7).length;
  return (
    <section className="bg-surface rounded-[22px] border border-line shadow-card p-4 space-y-3" aria-label="Rappels de la semaine">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg,rgb(240 170 60),rgb(214 134 40))" }}><BellRing size={18} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-bold text-ink">Rappels de la semaine</span>
          <span className="block text-[12.5px] text-ink3">{loading ? "Lecture des échéances…" : `${inWeek} échéance${inWeek > 1 ? "s" : ""} dans les 7 prochains jours${items.length > inWeek ? ` · ${items.length - inWeek} caution${items.length - inWeek > 1 ? "s" : ""} à surveiller` : ""}`}</span>
        </span>
        <Link href="/settings/automatisations" className="h-9 px-3.5 rounded-full border border-line text-[13px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-surface2">
          <SlidersHorizontal size={14} /> Réglages des rappels
        </Link>
      </div>
      {!loading && items.length === 0 && <p className="text-[13px] text-ink3 px-1">Aucune échéance : saisissez les dates clés sur la fiche de chaque appel (questions, visite, ouverture des plis).</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        {items.map(k => {
          const d = daysTo(k.date) ?? 0;
          return (
            <Link key={k.id} href={k.href} className="flex items-start gap-3 rounded-xl bg-surface2/60 border border-line px-3 py-2.5 hover:border-section/30 min-w-0">
              <span className={`num text-[12px] font-bold px-2 py-1 rounded-lg shrink-0 ${urgency(d)}`}>{d <= 0 ? "J" : `J-${d}`}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink truncate">{k.label} · {k.title}</span>
                <span className="block text-[11.5px] text-ink3 truncate">{shortDate(k.date)} · {k.owner ? `suivi par ${k.owner}` : k.detail}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function OfferCard({ a, busy, draggable, onMove }: { a: Appel; busy: boolean; draggable: boolean; onMove: (to: string, label: string) => void }) {
  const left = daysTo(a.submissionDeadline);
  const req = a.requiredDocuments || [], done = req.filter(d => d.provided).length;
  const step = NEXT_STEP[a.status];
  const since = daysTo(a.stageChangedAt || a.updatedAt);
  const owner = personName(a.ownerId);
  const go = a.goNoGo;
  const goCls = go ? (go.decision === "go" ? "bg-pos-50 text-pos" : go.decision === "no_go" ? "bg-neg-50 text-neg" : "bg-warn-50 text-warn") : "";
  const goLabel = go ? (go.decision === "go" ? "Go" : go.decision === "no_go" ? "No-Go" : "À étudier") : "";
  let chip: { text: string; cls: string } | null = null;
  if (a.status === "submitted") chip = { text: `Déposé le ${shortDate(a.result?.submittedAt || a.stageChangedAt || a.updatedAt)}`, cls: "bg-surface2 text-ink2" };
  else if (a.status === "evaluation") chip = { text: `En évaluation depuis ${Math.max(0, -(since ?? 0))} j`, cls: "bg-surface2 text-ink2" };
  else if (left !== null) chip = { text: left < 0 ? "Délai dépassé" : `Dépôt J-${left}`, cls: left < 0 ? "bg-surface2 text-ink3" : urgency(left) };
  return (
    <article draggable={draggable && !busy} onDragStart={e => { e.dataTransfer.setData("text/appel", a._id); e.dataTransfer.effectAllowed = "move"; }}
      className={`bg-surface rounded-[18px] border border-line shadow-sm p-3.5 flex flex-col gap-2.5 ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${busy ? "opacity-60" : ""}`}>
      <Link href={`/appels/${a._id}`} className="flex flex-col gap-2 group" draggable={false}>
        <span className="flex items-center gap-2 min-w-0">
          <Avatar name={a.organism || a.title} />
          <span className="text-[12px] text-ink2 truncate flex-1">{a.organism || "—"}</span>
          {go && <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${goCls}`}>{goLabel} · {go.score}</span>}
        </span>
        <span className="text-[14px] font-bold text-ink leading-snug group-hover:text-accent">{a.title}</span>
        <span className="flex items-center justify-between gap-2">
          <span className="num text-[16px] font-extrabold text-ink">{fmtM(a.estimatedAmount)} <span className="text-[11px] font-semibold text-ink3">FCFA</span></span>
          {chip && <span className={`text-[11px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1 ${chip.cls}`}><Clock size={11} /> {chip.text}</span>}
        </span>
      </Link>
      {a.status === "preparing" && req.length > 0 && (
        <span className="flex flex-col gap-1">
          <span className="flex justify-between text-[11px] text-ink3"><span>Pièces du dossier</span><span className={`font-bold ${done === req.length ? "text-pos" : "text-warn"}`}>{done} / {req.length}</span></span>
          <span className="h-1.5 rounded-full bg-surface2 overflow-hidden"><span className={`block h-full ${done === req.length ? "bg-pos" : done / req.length < 0.5 ? "bg-neg" : "bg-warn"}`} style={{ width: `${(done / req.length) * 100}%` }} /></span>
        </span>
      )}
      <span className="flex items-center gap-2 justify-between">
        <span className="flex items-center gap-1.5 min-w-0">
          {owner ? <><Avatar name={owner} size={22} /><span className="text-[12px] text-ink2 truncate">{a.ownerId?.firstName || owner}</span></> : <span className="text-[12px] text-ink3">Sans responsable</span>}
        </span>
        {step && (
          <button type="button" disabled={busy} onClick={() => onMove(step.to, step.label)}
            className={`h-8 px-3 rounded-full text-[12px] font-semibold shrink-0 disabled:opacity-60 ${a.status === "identified" ? "grad-brand" : "border border-line2 text-accent hover:bg-surface2"}`}>{step.label}</button>
        )}
        {a.status === "evaluation" && (
          <span className="flex gap-1.5 shrink-0">
            <button type="button" disabled={busy} onClick={() => onMove("won", "Obtenu")} className="h-8 px-3 rounded-full bg-pos text-white text-[12px] font-semibold disabled:opacity-60">Obtenu</button>
            <button type="button" disabled={busy} onClick={() => onMove("lost", "Non retenu")} className="h-8 px-3 rounded-full border border-neg/40 text-neg text-[12px] font-semibold hover:bg-neg-50 disabled:opacity-60">Non retenu</button>
          </span>
        )}
      </span>
    </article>
  );
}

function OffersTable({ items }: { items: Appel[] }) {
  if (!items.length) return <p className="text-sm text-ink3">Aucune offre en cours.</p>;
  return (
    <div className="bg-surface rounded-[22px] border border-line shadow-card overflow-x-auto">
      <table className="table-dense w-full min-w-[720px]">
        <thead><tr className="text-left"><th>Offre</th><th>Étape</th><th>Date limite</th><th className="text-right">Montant (FCFA)</th><th>Responsable</th><th>Go / No-Go</th></tr></thead>
        <tbody>
          {items.map(a => (
            <tr key={a._id} className="border-t border-line">
              <td><Link href={`/appels/${a._id}`} className="font-semibold text-ink hover:text-accent">{a.title}</Link><span className="block text-[12px] text-ink3">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}</span></td>
              <td><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${APPEL_STATUS[a.status]?.cls}`}>{APPEL_STATUS[a.status]?.label}</span></td>
              <td className="text-[13px]">{a.submissionDeadline ? new Date(a.submissionDeadline).toLocaleDateString("fr-FR") : "—"}</td>
              <td className="text-right font-mono">{Math.round(a.estimatedAmount || 0).toLocaleString("fr-FR")}</td>
              <td className="text-[13px]">{personName(a.ownerId) || "—"}</td>
              <td className="text-[12px]">{a.goNoGo ? `${a.goNoGo.decision === "go" ? "Go" : a.goNoGo.decision === "no_go" ? "No-Go" : "À étudier"} · ${a.goNoGo.score}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Échéances des 90 prochains jours, par mois. */
function KeyDatesCalendar({ items, loading }: { items: KeyDate[]; loading: boolean }) {
  if (loading) return <div className="h-72 rounded-[22px] bg-surface border border-line animate-pulse" />;
  if (!items.length) return <p className="text-sm text-ink3">Aucune échéance dans les 90 prochains jours.</p>;
  const byMonth = new Map<string, KeyDate[]>();
  for (const k of items) { const m = new Date(k.date).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); byMonth.set(m, [...(byMonth.get(m) ?? []), k]); }
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink2">Les mêmes échéances figurent dans l&apos;<Link href="/agenda" className="text-section font-semibold hover:underline">agenda</Link> (agenda « Marchés publics »).</p>
      {[...byMonth.entries()].map(([m, ks]) => (
        <section key={m} className="bg-surface rounded-[22px] border border-line shadow-card overflow-hidden">
          <h2 className="px-5 py-3 text-[13px] font-bold uppercase tracking-wide text-ink2 bg-surface2/60 capitalize">{m}</h2>
          <div className="divide-y divide-line">
            {ks.map(k => {
              const d = new Date(k.date), left = daysTo(k.date) ?? 0;
              return (
                <Link key={k.id} href={k.href} className="flex items-center gap-4 px-5 py-3 hover:bg-surface2/40">
                  <span className="w-12 text-center shrink-0"><span className="block text-[20px] font-extrabold text-ink leading-none num">{d.getDate()}</span><span className="block text-[11px] text-ink3 uppercase">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</span></span>
                  <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-ink truncate">{k.label} · {k.title}</span><span className="block text-[12px] text-ink3 truncate">{[k.detail, k.owner ? `suivi par ${k.owner}` : ""].filter(Boolean).join(" · ")}</span></span>
                  <span className={`num text-[12px] font-bold px-2 py-1 rounded-lg ${urgency(left)}`}>{left <= 0 ? "J" : `J-${left}`}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Résultats : réussite, montants, motifs de rejet, organismes. */
function Stats({ all }: { all: Appel[] }) {
  const decided = all.filter(a => ["won", "lost"].includes(a.status));
  const wonA = decided.filter(a => a.status === "won"), lostA = decided.filter(a => a.status === "lost");
  const sum = (xs: Appel[]) => xs.reduce((t, a) => t + (a.estimatedAmount || 0), 0);
  const reasons = Object.entries(lostA.reduce<Record<string, number>>((m, a) => { const r = a.result?.lossReason || "non_renseigne"; m[r] = (m[r] ?? 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]);
  const orgs = Object.entries(decided.reduce<Record<string, { won: number; total: number }>>((m, a) => {
    const k = a.organism || "—"; m[k] ??= { won: 0, total: 0 }; m[k].total++; if (a.status === "won") m[k].won++; return m;
  }, {})).sort((x, y) => y[1].total - x[1].total).slice(0, 8);
  const max = Math.max(1, ...reasons.map(r => r[1]));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="grid grid-cols-2 gap-4 lg:col-span-2">
        <MetricCard icon={<Trophy size={18} />} tone="green" label="Montant gagné" value={fmtM(sum(wonA))} sub={`${wonA.length} marché${wonA.length > 1 ? "s" : ""} obtenu${wonA.length > 1 ? "s" : ""}`} />
        <MetricCard icon={<Archive size={18} />} tone="red" label="Montant perdu" value={fmtM(sum(lostA))} sub={`${lostA.length} offre${lostA.length > 1 ? "s" : ""} non retenue${lostA.length > 1 ? "s" : ""}`} />
      </div>
      <section className="bg-surface rounded-[22px] border border-line shadow-card p-5 space-y-3">
        <h2 className="text-[15px] font-bold text-ink">Motifs de rejet</h2>
        {reasons.length === 0 && <p className="text-sm text-ink3">Aucune offre perdue.</p>}
        {reasons.map(([r, n]) => (
          <div key={r} className="space-y-1">
            <div className="flex justify-between text-[13px]"><span className="text-ink">{LOSS_LABEL[r] ?? "Non renseigné"}</span><span className="num font-semibold text-ink2">{n}</span></div>
            <div className="h-2 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-neg/70" style={{ width: `${(n / max) * 100}%` }} /></div>
          </div>
        ))}
      </section>
      <section className="bg-surface rounded-[22px] border border-line shadow-card p-5">
        <h2 className="text-[15px] font-bold text-ink mb-3">Par acheteur</h2>
        {orgs.length === 0 ? <p className="text-sm text-ink3">Aucun résultat encore.</p> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-ink3"><th className="font-semibold pb-2">Acheteur</th><th className="font-semibold pb-2 text-right">Décidées</th><th className="font-semibold pb-2 text-right">Gagnées</th><th className="font-semibold pb-2 text-right">Réussite</th></tr></thead>
            <tbody>{orgs.map(([o, v]) => <tr key={o} className="border-t border-line"><td className="py-1.5 pr-2 text-ink truncate max-w-[220px]">{o}</td><td className="text-right num">{v.total}</td><td className="text-right num">{v.won}</td><td className="text-right num font-semibold">{Math.round((v.won / v.total) * 100)} %</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function NewAppel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", organism: "", reference: "", submissionDeadline: "", questionsDeadline: "", siteVisitDate: "", openingDate: "", estimatedAmount: 0, ownerId: "", docs: "" });
  const [users, setUsers] = useState<Array<{ _id: string; firstName?: string; lastName?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiJson("/api/agenda/directory").then(d => setUsers(d?.data ?? [])).catch(() => {}); }, []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: k === "estimatedAmount" ? Number(e.target.value) : e.target.value }));

  async function save() {
    if (!form.title.trim()) { setError("Intitulé requis."); return; }
    setSaving(true); setError(null);
    try {
      const { docs, ...rest } = form;
      const res = await apiSend("POST", "/api/appels", { ...rest, ownerId: rest.ownerId || undefined, requiredDocuments: docs.split("\n").map(s => s.trim()).filter(Boolean) });
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Échec");
      onCreated(d.data._id);
    } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); } finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Nouvel appel d'offres" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Intitulé de l'appel" required>
          <input className={inputCls} value={form.title} onChange={set("title")} placeholder="Équipement salle informatique — Université X" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Acheteur"><input className={inputCls} value={form.organism} onChange={set("organism")} placeholder="Université, ministère…" /></FormField>
          <FormField label="Référence"><input className={inputCls} value={form.reference} onChange={set("reference")} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant estimé (FCFA)"><input type="number" min={0} className={inputCls} value={form.estimatedAmount || ""} onChange={set("estimatedAmount")} /></FormField>
          <FormField label="Responsable du dossier">
            <select className={selectCls} value={form.ownerId} onChange={set("ownerId")}>
              <option value="">— À attribuer —</option>
              {users.map(u => <option key={u._id} value={u._id}>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date limite de dépôt"><input type="date" className={inputCls} value={form.submissionDeadline} onChange={set("submissionDeadline")} /></FormField>
          <FormField label="Questions / éclaircissements"><input type="date" className={inputCls} value={form.questionsDeadline} onChange={set("questionsDeadline")} /></FormField>
          <FormField label="Visite de site"><input type="date" className={inputCls} value={form.siteVisitDate} onChange={set("siteVisitDate")} /></FormField>
          <FormField label="Ouverture des plis"><input type="date" className={inputCls} value={form.openingDate} onChange={set("openingDate")} /></FormField>
        </div>
        <FormField label="Pièces exigées" hint="Une par ligne — elles deviendront une check-list.">
          <textarea className={textareaCls} rows={4} value={form.docs} onChange={set("docs")} placeholder={"Attestation fiscale\nRCCM\nCatalogue produits\nCaution de soumission"} />
        </FormField>
        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Création…" : "Créer"}</button>
        </div>
      </div>
    </Modal>
  );
}
