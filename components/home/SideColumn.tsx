"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Target, Zap, FileText, ClipboardList, Banknote, UserPlus, ChevronRight, Bot, Send, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Card } from "@/components/home/primitives";
import { compactXof } from "@/components/ui/charts/geometry";
import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import type { HomeData } from "@/lib/dashboard-home";
import type { BriefItem } from "@/lib/daily-brief";

/** Objectif du mois : jauge du chiffre d'affaires facturé, objectif réglable. */
export function ObjectiveGauge({ o, month }: { o: NonNullable<HomeData["objective"]>; month: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<number | null>(o.target);
  const step = target && target >= 10_000_000 ? 1_000_000 : 500_000;
  const ratio = target ? Math.min(1, o.invoiced / target) : 0;
  const R = 70, arc = Math.PI * R;

  async function save(v: number) {
    const res = await apiSend("PUT", "/api/dashboard/objective", { target: v });
    if (!res.ok) { showToast(res.data?.error || "Objectif non enregistré.", "error"); return; }
    setTarget(v); router.refresh();
  }
  async function define() {
    const v = await promptDialog({ title: `Objectif ${/^[aeiouyh]/i.test(month) ? "d'" : "de "}${month}`, label: "Chiffre d'affaires à facturer (FCFA TTC)", defaultValue: String(target ?? o.lastYear ?? ""), required: true, confirmLabel: "Enregistrer" });
    const n = Math.round(Number(String(v ?? "").replace(/\s/g, "")));
    if (v && n > 0) save(n);
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div><h2 className="text-[16px] font-bold tracking-tight text-ink">Objectif {/^[aeiouyh]/i.test(month) ? "d'" : "de "}{month}</h2><p className="text-xs text-ink3">Chiffre d&apos;affaires facturé</p></div>
        <Target size={18} className="text-ink3" aria-hidden />
      </div>
      {!target ? (
        <div className="py-4 text-center space-y-3">
          <p className="text-sm text-ink2">Fixez un objectif pour suivre votre mois d&apos;un coup d&apos;œil.</p>
          <p className="text-xs text-ink3">Facturé ce mois : {compactXof(o.invoiced)} FCFA{o.lastYear ? ` · l'an dernier : ${compactXof(o.lastYear)}` : ""}</p>
          {o.canEdit && <button type="button" onClick={define} className="h-9 px-4 rounded-full grad-brand text-[13px] font-semibold">Fixer l&apos;objectif</button>}
        </div>
      ) : (
        <>
          <div className="relative w-[190px] mx-auto">
            <svg viewBox="0 0 180 100" className="w-full" aria-hidden>
              <defs><linearGradient id="og" x1="0" x2="1"><stop offset="0" stopColor="rgb(0 130 235)" /><stop offset="1" stopColor="rgb(47 89 223)" /></linearGradient></defs>
              <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="currentColor" className="text-surface2" strokeWidth={16} strokeLinecap="round" />
              <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="url(#og)" strokeWidth={16} strokeLinecap="round" strokeDasharray={`${arc * ratio} ${arc}`} />
            </svg>
            <div className="absolute inset-x-0 bottom-0 text-center">
              <p className="text-[30px] font-extrabold num text-ink leading-none">{Math.round((o.invoiced / target) * 100)} %</p>
              <p className="text-[11.5px] text-ink3 mt-1 num">{compactXof(o.invoiced)} / {compactXof(target)} FCFA</p>
            </div>
          </div>
          <p className="text-center text-[13px] font-semibold text-ink mt-3">{o.invoiced >= target ? "Objectif atteint 🎉" : `Encore ${compactXof(target - o.invoiced)} FCFA à facturer`}</p>
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
            <span className="text-[11.5px] text-ink3">{o.lastYear ? `L'an dernier : ${compactXof(o.lastYear)} facturés` : "Pas de référence l'an dernier"}</span>
            {o.canEdit && (
              <span className="inline-flex items-center gap-1">
                <button type="button" aria-label="Baisser l'objectif" onClick={() => save(Math.max(step, target - step))} className="w-7 h-7 rounded-lg border border-line hover:bg-surface2 font-bold text-ink2">−</button>
                <button type="button" onClick={define} className="px-1.5 text-[12.5px] font-bold num text-ink hover:text-accent">{compactXof(target)}</button>
                <button type="button" aria-label="Relever l'objectif" onClick={() => save(target + step)} className="w-7 h-7 rounded-lg border border-line hover:bg-surface2 font-bold text-ink2">+</button>
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** Les quatre gestes les plus fréquents, sur la carte bleu nuit de la maquette. */
export function QuickActions({ can }: { can: { invoice: boolean; quote: boolean; payment: boolean; client: boolean } }) {
  const items = [
    can.invoice && { href: "/invoices/new", label: "Nouvelle facture", icon: <FileText size={17} /> },
    can.quote && { href: "/devis/new", label: "Nouveau devis", icon: <ClipboardList size={17} /> },
    can.payment && { href: "/payments", label: "Enregistrer un paiement", icon: <Banknote size={17} /> },
    can.client && { href: "/clients?new=1", label: "Nouveau client", icon: <UserPlus size={17} /> },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: React.ReactNode }>;
  if (!items.length) return null;
  return (
    <section className="rounded-[22px] p-[22px] text-white shadow-shell bg-gradient-to-br from-[rgb(25_43_111)] to-[rgb(24_27_83)]">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-10 h-10 rounded-xl bg-white/12 grid place-items-center"><Zap size={18} /></span>
        <div><p className="font-bold">Actions rapides</p><p className="text-xs text-white/60">Le plus utile en un clic</p></div>
      </div>
      <ul className="divide-y divide-white/10">
        {items.map(i => (
          <li key={i.href}><Link href={i.href} className="flex items-center gap-3 py-2.5 text-[13.5px] font-medium hover:text-white text-white/90 group">
            <span className="opacity-80">{i.icon}</span><span className="flex-1">{i.label}</span><ChevronRight size={16} className="opacity-50 group-hover:translate-x-0.5 transition-transform" />
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Assistant : répond aux questions courantes à partir des chiffres réels de
 * l'organisation (aucun texte inventé). Questions suggérées en un clic.
 */
export function AssistantPanel({ suggestions }: { suggestions: string[] }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Array<{ q: string; a: string; links?: Array<{ href: string; label: string }> }>>([]);
  const [busy, setBusy] = useState(false);
  async function ask(question: string) {
    const text = question.trim(); if (!text) return;
    setBusy(true); setQ("");
    try {
      const res = await apiSend("POST", "/api/dashboard/assistant", { question: text });
      setLog(l => [...l.slice(-2), { q: text, a: res.ok ? res.data.data.answer : (res.data?.error ?? "Je n'ai pas pu répondre."), links: res.ok ? res.data.data.links : undefined }]);
    } finally { setBusy(false); }
  }
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3"><Bot size={18} className="text-accent" aria-hidden /><h2 className="text-[16px] font-bold tracking-tight text-ink">Assistant</h2></div>
      {log.length === 0 && (
        <div className="rounded-2xl bg-accent-50 p-3.5 mb-3">
          <p className="text-[13px] font-bold text-ink">Bonjour !</p>
          <p className="text-[12.5px] text-ink2 leading-snug">Posez-moi une question sur vos factures, vos clients ou votre trésorerie.</p>
        </div>
      )}
      <div className="space-y-2.5 mb-3" aria-live="polite">
        {log.map((m, k) => (
          <div key={k} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent text-white text-[12.5px] px-3 py-1.5">{m.q}</p>
            <div className="w-fit max-w-[95%] rounded-2xl rounded-bl-md bg-surface2 text-[12.5px] text-ink px-3 py-2 whitespace-pre-line">
              {m.a}
              {m.links?.length ? <span className="flex flex-wrap gap-2 mt-1.5">{m.links.map(l => <Link key={l.href} href={l.href} className="text-accent font-semibold hover:underline">{l.label} →</Link>)}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {log.length === 0 && (
        <div className="space-y-1.5 mb-3">
          {suggestions.map(s => (
            <button key={s} type="button" onClick={() => ask(s)} className="w-full text-left text-[12.5px] px-3 py-2 rounded-xl border border-line hover:bg-surface2 text-ink2">{s}</button>
          ))}
        </div>
      )}
      <form onSubmit={e => { e.preventDefault(); ask(q); }} className="flex items-center gap-2 h-11 pl-4 pr-1.5 rounded-full border border-line bg-surface">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Demandez n'importe quoi…" aria-label="Question à l'assistant" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-ink placeholder:text-ink3" />
        <button type="submit" disabled={busy || !q.trim()} aria-label="Envoyer" className="w-8 h-8 rounded-full grad-brand grid place-items-center disabled:opacity-50"><Send size={14} /></button>
      </form>
    </Card>
  );
}

const TONE_ICON: Record<string, React.ReactNode> = { neg: <AlertTriangle size={15} />, warn: <Info size={15} />, info: <CheckCircle2 size={15} /> };
const TONE_CLS: Record<string, string> = { neg: "bg-neg-50 text-neg", warn: "bg-warn-50 text-warn", info: "bg-accent-50 text-accent" };

/** « À retenir » : les trois actions du brief du jour, en raccourci. */
export function RememberPanel({ items }: { items: BriefItem[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <p className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-ink3 mb-2.5">À retenir</p>
      <ul className="space-y-3">
        {items.map((i, k) => (
          <li key={k}><Link href={i.href} className="flex gap-2.5 group">
            <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${TONE_CLS[i.tone] ?? TONE_CLS.info}`}>{TONE_ICON[i.tone] ?? TONE_ICON.info}</span>
            <span className="min-w-0"><span className="block text-[13px] font-semibold text-ink group-hover:text-accent">{i.title}</span><span className="block text-[11.5px] text-ink3 line-clamp-2">{i.why}</span></span>
          </Link></li>
        ))}
      </ul>
    </Card>
  );
}
