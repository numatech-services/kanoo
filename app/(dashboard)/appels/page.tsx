"use client";

import { IfCan } from "@/components/shared/IfCan";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Megaphone, Plus, Clock, Eye, FolderOpen, Send, Scale, Trophy, Archive, CalendarClock, Briefcase } from "lucide-react";
import { compactXof } from "@/components/ui/charts/geometry";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
export interface Appel {
  _id: string; title: string; organism?: string; reference?: string;
  submissionDeadline?: string; status: string; estimatedAmount: number;
  requiredDocuments?: { label: string; provided: boolean }[];
  goNoGo?: { decision: "go" | "review" | "no_go"; score: number };
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
  { status: "identified", title: "Intéressé", sub: "Avis repéré · analyse Go / No-Go", icon: <Eye size={16} />, chip: "bg-surface2 text-ink2" },
  { status: "preparing", title: "Dossier en préparation", sub: "Pièces, offres technique et financière", icon: <FolderOpen size={16} />, chip: "bg-warn-50 text-warn" },
  { status: "submitted", title: "Dossier déposé", sub: "Offre remise à l'acheteur", icon: <Send size={16} />, chip: "bg-accent-50 text-accent" },
  { status: "evaluation", title: "En évaluation", sub: "Ouverture des plis · analyse", icon: <Scale size={16} />, chip: "bg-[rgb(243_238_255)] text-[rgb(110_68_188)]" },
];
const NEXT_STEP: Record<string, { to: string; label: string }> = {
  identified: { to: "preparing", label: "Préparer le dossier" },
  preparing: { to: "submitted", label: "Marquer déposé" },
  submitted: { to: "evaluation", label: "Passer en évaluation" },
};
type Tab = "open" | "won" | "archive";
interface Executing { count: number; amount: number; invoicedRate: number }
interface WonContract { _id: string; reference: string; title: string; amount: number; status: string; appelId: string; invoicedHT: number }

const fmtM = (n: number) => `${compactXof(n)}`;
const daysTo = (iso?: string) => (iso ? Math.ceil((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000) : null);

/**
 * Suivi des marchés (charte v5) : de l'avis repéré à la décision, chaque offre
 * avance d'étape en étape. Un marché obtenu passe dans « Marchés obtenus » ;
 * un suivi arrêté (perdu, abandonné) part aux archives.
 */
export default function AppelsListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Appel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [executing, setExecuting] = useState<Executing | null>(null);
  const [won, setWon] = useState<WonContract[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([apiJson("/api/appels?limit=200"), apiJson("/api/appels/pipeline")])
      .then(([d, p]) => { setItems(d?.data?.items || []); setExecuting(p?.data?.executing ?? null); setWon(p?.data?.contracts ?? []); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function move(a: Appel, to: string, label: string) {
    if (to === "lost" && !(await confirmDialog({ title: `« ${a.title} » non retenu ?`, message: "Le suivi passe aux archives ; il compte dans le taux de réussite.", confirmLabel: "Marquer non retenu" }))) return;
    setBusy(a._id);
    try {
      const res = await apiSend("PATCH", `/api/appels/${a._id}`, { status: to });
      if (!res.ok) { showToast(res.data?.error || "Changement refusé.", "error"); return; }
      showToast(`${a.title} : ${label.toLowerCase()}.`, "success");
      if (to === "won") router.push(`/appels/${a._id}`); else load();
    } finally { setBusy(null); }
  }

  const inProgress = items.filter(a => COLUMNS.some(c => c.status === a.status));
  const wonItems = items.filter(a => a.status === "won");
  const archived = items.filter(a => ["lost", "cancelled"].includes(a.status));
  const decided = items.filter(a => ["won", "lost"].includes(a.status));
  const successRate = decided.length ? Math.round((wonItems.length / decided.length) * 100) : null;
  const nextDeposit = inProgress.filter(a => ["identified", "preparing"].includes(a.status) && (daysTo(a.submissionDeadline) ?? -1) >= 0)
    .sort((x, y) => new Date(x.submissionDeadline!).getTime() - new Date(y.submissionDeadline!).getTime())[0];
  const inPlay = inProgress.reduce((t, a) => t + (a.estimatedAmount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Appels d&apos;offres &amp; marchés</p>
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1">Suivi des marchés</h1>
          <p className="text-sm text-ink2 mt-1">De l&apos;avis repéré jusqu&apos;à la clôture : chaque offre avance d&apos;étape en étape. Un marché obtenu passe dans « Marchés obtenus » ; un suivi arrêté part aux archives.</p>
        </div>
        <IfCan resource="appels">
          <button onClick={() => setOpen(true)} className="h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105">
            <Plus size={17} /> Nouvel appel d&apos;offres
          </button>
        </IfCan>
      </div>

      <div className="inline-flex p-1 rounded-2xl bg-surface border border-line gap-1" role="tablist">
        {([["open", "Offres en cours", inProgress.length, <Megaphone key="i" size={15} />], ["won", "Marchés obtenus", wonItems.length, <Trophy key="t" size={15} />], ["archive", "Archives", archived.length, <Archive key="a" size={15} />]] as Array<[Tab, string, number, React.ReactNode]>).map(([k, l, n, ic]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-10 px-4 rounded-xl text-[13.5px] font-semibold inline-flex items-center gap-2 ${tab === k ? "grad-brand" : "text-ink2 hover:bg-surface2"}`}>
            {ic} {l} <span className={`num text-[11px] px-1.5 rounded-full ${tab === k ? "bg-white/25" : "bg-surface2 text-ink3"}`}>{n}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi icon={<Megaphone size={18} />} chip="linear-gradient(135deg,rgb(0 130 235),rgb(47 89 223))" label="Offres en cours" value={String(inProgress.length)} sub={`${fmtM(inPlay)} FCFA en jeu`} />
        <Kpi icon={<CalendarClock size={18} />} chip="linear-gradient(135deg,rgb(240 110 90),rgb(194 39 45))" label="Prochain dépôt"
          value={nextDeposit ? `J-${daysTo(nextDeposit.submissionDeadline)}` : "—"} valueCls={nextDeposit && (daysTo(nextDeposit.submissionDeadline) ?? 99) <= 3 ? "text-neg" : ""} sub={nextDeposit?.title ?? "Aucun dépôt en vue"} />
        <Kpi icon={<Trophy size={18} />} chip="linear-gradient(135deg,rgb(40 170 110),rgb(0 120 64))" label="Taux de réussite" value={successRate === null ? "—" : `${successRate} %`} sub={`${wonItems.length} gagné${wonItems.length > 1 ? "s" : ""} · ${decided.length - wonItems.length} non retenu${decided.length - wonItems.length > 1 ? "s" : ""}`} />
        <Kpi icon={<Briefcase size={18} />} chip="linear-gradient(135deg,rgb(140 100 230),rgb(110 68 188))" label="Marchés en exécution" value={executing ? String(executing.count) : "—"} sub={executing ? `${fmtM(executing.amount)} FCFA · ${executing.invoicedRate} % facturé` : "Accès aux contrats requis"} />
      </div>

      {loading ? <div className="h-72 rounded-[22px] bg-surface border border-line animate-pulse" /> : tab === "open" ? (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {COLUMNS.map(col => {
            const list = inProgress.filter(a => a.status === col.status).sort((x, y) => (daysTo(x.submissionDeadline) ?? 999) - (daysTo(y.submissionDeadline) ?? 999));
            return (
              <section key={col.status} className="flex-1 min-w-[255px] snap-start rounded-[22px] bg-surface2/70 border border-line p-3 flex flex-col gap-3" aria-label={col.title}>
                <header className="flex items-start gap-2.5 px-1 pt-1">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${col.chip}`}>{col.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-bold text-ink">{col.title}</span>
                    <span className="block text-[11.5px] text-ink3 leading-snug">{col.sub}</span>
                  </span>
                  <span className="num text-[12px] font-bold w-7 h-7 rounded-full bg-surface border border-line grid place-items-center">{list.length}</span>
                </header>
                <p className="px-1 text-[12px] font-semibold text-ink3 num">{fmtM(list.reduce((t, a) => t + (a.estimatedAmount || 0), 0))} FCFA</p>
                {list.length === 0 && <p className="text-[12.5px] text-ink3 text-center py-6">Aucune offre à cette étape.</p>}
                {list.map(a => <OfferCard key={a._id} a={a} busy={busy === a._id} onMove={(to, label) => move(a, to, label)} />)}
              </section>
            );
          })}
        </div>
      ) : tab === "won" ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {wonItems.length === 0 && <p className="text-sm text-ink3">Aucun marché obtenu pour l&apos;instant.</p>}
          {wonItems.map(a => {
            const c = won.find(w => w.appelId === a._id);
            const rate = c && c.amount > 0 ? Math.min(100, Math.round((c.invoicedHT / c.amount) * 100)) : 0;
            return (
              <Link key={a._id} href={c ? `/contracts/${c._id}` : `/appels/${a._id}`} className="bg-surface rounded-[22px] border border-line shadow-card p-5 lift hover:border-accent/30 flex flex-col gap-2">
                <span className="flex items-center gap-2"><OrgAvatar name={a.organism || a.title} /><span className="text-[12.5px] text-ink2 truncate flex-1">{a.organism || "—"}</span>{a.reference && <span className="text-[11px] font-mono text-ink3">{a.reference}</span>}</span>
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
      ) : (
        <div className="bg-surface rounded-[22px] border border-line shadow-card divide-y divide-line overflow-hidden">
          {archived.length === 0 && <p className="text-sm text-ink3 p-6">Aucune archive.</p>}
          {archived.map(a => (
            <Link key={a._id} href={`/appels/${a._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface2/50">
              <OrgAvatar name={a.organism || a.title} />
              <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-ink truncate">{a.title}</span><span className="block text-[12px] text-ink3 truncate">{a.organism || "—"}{a.reference ? ` · ${a.reference}` : ""}</span></span>
              <span className="num text-[13px] font-bold text-ink2">{fmtM(a.estimatedAmount)} FCFA</span>
              <span className={`pill ${a.status === "lost" ? "pill-neg" : "pill-mute"}`}>{a.status === "lost" ? "Non retenu" : "Abandonné"}</span>
            </Link>
          ))}
        </div>
      )}

      {open && <NewAppel onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); router.push(`/appels/${id}`); }} />}
    </div>
  );
}

function Kpi({ icon, chip, label, value, sub, valueCls = "" }: { icon: React.ReactNode; chip: string; label: string; value: string; sub: string; valueCls?: string }) {
  return (
    <div className="bg-surface rounded-[22px] border border-line shadow-card p-[18px] flex flex-col gap-2.5 min-w-0">
      <span className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{ background: chip }}>{icon}</span><span className="text-[13.5px] font-medium text-ink2">{label}</span></span>
      <span className={`text-[28px] font-extrabold tracking-tight leading-none num ${valueCls || "text-ink"}`}>{value}</span>
      <span className="text-[12px] text-ink3 truncate">{sub}</span>
    </div>
  );
}

function OrgAvatar({ name }: { name: string }) {
  const ini = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const colors = ["194 39 45", "0 150 180", "200 110 40", "47 89 223", "110 68 188", "0 120 64"];
  return <span className="w-7 h-7 rounded-full grid place-items-center text-[10.5px] font-bold text-white shrink-0" style={{ background: `rgb(${colors[h % colors.length]})` }} aria-hidden>{ini}</span>;
}

function OfferCard({ a, busy, onMove }: { a: Appel; busy: boolean; onMove: (to: string, label: string) => void }) {
  const left = daysTo(a.submissionDeadline);
  const req = a.requiredDocuments || [], done = req.filter(d => d.provided).length;
  const step = NEXT_STEP[a.status];
  const dueCls = left === null ? "" : left < 0 ? "bg-surface2 text-ink3" : left <= 3 ? "bg-neg-50 text-neg" : left <= 14 ? "bg-warn-50 text-warn" : "bg-accent-50 text-accent";
  return (
    <article className="bg-surface rounded-[18px] border border-line shadow-sm p-3.5 flex flex-col gap-2.5">
      <Link href={`/appels/${a._id}`} className="flex flex-col gap-2 group">
        <span className="flex items-center gap-2 min-w-0"><OrgAvatar name={a.organism || a.title} /><span className="text-[12px] text-ink2 truncate flex-1">{a.organism || "—"}</span>{a.reference && <span className="text-[10.5px] font-mono text-ink3 shrink-0">{a.reference}</span>}</span>
        <span className="text-[14px] font-bold text-ink leading-snug group-hover:text-accent">{a.title}</span>
        <span className="flex items-center justify-between gap-2">
          <span className="num text-[16px] font-extrabold text-ink">{fmtM(a.estimatedAmount)} <span className="text-[11px] font-semibold text-ink3">FCFA</span></span>
          {a.status === "submitted" || a.status === "evaluation"
            ? <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-surface2 text-ink3">{a.status === "evaluation" ? "En analyse" : "Déposé"}</span>
            : left !== null && <span className={`text-[11px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1 ${dueCls}`}><Clock size={11} /> {left < 0 ? "Délai dépassé" : `Dépôt J-${left}`}</span>}
        </span>
      </Link>
      {a.status === "preparing" && req.length > 0 && (
        <span className="flex flex-col gap-1">
          <span className="flex justify-between text-[11px] text-ink3"><span>Pièces du dossier</span><span className={`font-bold ${done === req.length ? "text-pos" : "text-neg"}`}>{done} / {req.length}</span></span>
          <span className="h-1.5 rounded-full bg-surface2 overflow-hidden"><span className={`block h-full ${done === req.length ? "bg-pos" : "bg-warn"}`} style={{ width: `${(done / req.length) * 100}%` }} /></span>
        </span>
      )}
      {a.goNoGo && <span className={`self-start text-[10.5px] font-bold px-2 py-0.5 rounded-full ${a.goNoGo.decision === "go" ? "bg-pos-50 text-pos" : a.goNoGo.decision === "no_go" ? "bg-neg-50 text-neg" : "bg-warn-50 text-warn"}`}>{a.goNoGo.decision === "go" ? "Go ✓" : a.goNoGo.decision === "no_go" ? "No-Go" : "À arbitrer"} · {a.goNoGo.score}/100</span>}
      {step && (
        <button type="button" disabled={busy} onClick={() => onMove(step.to, step.label)}
          className={`h-9 rounded-full text-[12.5px] font-semibold disabled:opacity-60 ${a.status === "identified" ? "grad-brand" : "border border-line2 text-ink hover:bg-surface2"}`}>{step.label}</button>
      )}
      {a.status === "evaluation" && (
        <span className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => onMove("won", "Obtenu")} className="h-9 rounded-full bg-pos text-white text-[12.5px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-60"><Trophy size={13} /> Obtenu</button>
          <button type="button" disabled={busy} onClick={() => onMove("lost", "Non retenu")} className="h-9 rounded-full border border-neg/40 text-neg text-[12.5px] font-semibold hover:bg-neg-50 disabled:opacity-60">Non retenu</button>
        </span>
      )}
    </article>
  );
}

function NewAppel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", organism: "", reference: "", submissionDeadline: "", estimatedAmount: 0, docs: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.title.trim()) { setError("Intitulé requis."); return; }
    setSaving(true); setError(null);
    try {
      const res = await apiSend("POST", "/api/appels", { ...form, requiredDocuments: form.docs.split("\n").map(s => s.trim()).filter(Boolean) });
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
          <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Équipement salle informatique — Université X" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Émetteur"><input className={inputCls} value={form.organism} onChange={e => setForm(f => ({ ...f, organism: e.target.value }))} placeholder="Université, ministère…" /></FormField>
          <FormField label="Référence"><input className={inputCls} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date limite de dépôt"><input type="date" className={inputCls} value={form.submissionDeadline} onChange={e => setForm(f => ({ ...f, submissionDeadline: e.target.value }))} /></FormField>
          <FormField label="Montant estimé (FCFA)"><input type="number" min={0} className={inputCls} value={form.estimatedAmount || ""} onChange={e => setForm(f => ({ ...f, estimatedAmount: Number(e.target.value) }))} /></FormField>
        </div>
        <FormField label="Pièces exigées" hint="Une par ligne — elles deviendront une check-list.">
          <textarea className={textareaCls} rows={4} value={form.docs} onChange={e => setForm(f => ({ ...f, docs: e.target.value }))} placeholder={"Attestation fiscale\nRCCM\nCatalogue produits\nCaution de soumission"} />
        </FormField>
        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Création…" : "Créer"}</button>
        </div>
      </div>
    </Modal>
  );
}
