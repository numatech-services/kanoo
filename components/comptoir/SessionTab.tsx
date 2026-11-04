"use client";
import { useState } from "react";
import { CalendarCheck2, Lock, Unlock, Printer, Trophy, TrendingUp, TrendingDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { SALE_METHOD_LABEL } from "@/components/comptoir/SalesTab";
import { CashiersPanel } from "@/components/comptoir/SpotControls";

const MONEY = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const fr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const h = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Product { itemId: string; label: string; quantity: number; revenueTTC: number; margin?: number }
interface Report {
  fromDay: string; toDay: string;
  sales: { count: number; revenueTTC: number; revenueHT: number; margin?: number; markupRate?: number | null; averageTicket: number };
  receipts: number; expenses: number; balance: number; otherReceipts: number;
  byMethod: Array<{ method: string; receipts: number; expenses: number }>;
  expensesByCategory: Array<{ category: string; label: string; amount: number }>;
  openingFloat: number; expectedCash: number;
  byDay: Array<{ day: string; revenueTTC: number; margin?: number; tickets: number }>;
  topByRevenue: Product[]; topByQuantity: Product[]; topByMargin: Product[]; losses: Product[];
  countedCash?: number; gap?: number;
  creditSales?: number; creditSettled?: number; netMargin?: number;
  shrinkage?: { total?: number; byReason: Array<{ reason: string; label: string; value?: number }> };
}
interface Progress { rate: number; expected: number; behind: boolean; perDayNeeded: number | null }
interface Session { _id: string; openDay: string; closeDay?: string; openingFloat: number; label?: string; status: string; summary?: Report; report?: Report; openedBy?: { firstName?: string; lastName?: string };
  targets?: { revenue?: number; margin?: number }; progress?: { elapsedDays: number; revenue: Progress | null; margin: Progress | null } | null }
interface Data { showCosts: boolean; current: Session | null; previous: Report | null; history: Session[]; suggestedFloat?: number }

/**
 * Caisse de la semaine : ouverture avec le fonds de caisse, bilan en direct
 * (chiffre d'affaires, recettes, dépenses par nature, solde, espèces
 * attendues, marge, meilleures ventes), fermeture par le comptage, et
 * historique semaine par semaine.
 */
export function SessionTab({ deskId, deskName, onChange }: { deskId: string; deskName: string; onChange: () => void }) {
  const { data, reload } = useApi<Data | null>(`/api/comptoir/sessions?deskId=${deskId}`, d => d?.data ?? null, null);
  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  if (!data) return <div className="h-48 surface-card animate-pulse" />;
  const cur = data.current, r = cur?.report, prev = data.previous;

  return (
    <div className="space-y-5">
      {!cur ? (
        <div className="surface-card p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink inline-flex items-center gap-2"><Lock size={16} /> Caisse fermée</h3>
            <p className="text-sm text-ink2">Ouvrez la caisse en début de semaine avec le fonds de caisse : vous suivez ensuite, jour après jour, le chiffre d&apos;affaires, les recettes, les dépenses et le solde de la semaine.</p>
          </div>
          <button onClick={() => setOpenDlg(true)} className={buttonClass("primary", "md")}><Unlock size={15} /> Ouvrir la caisse</button>
        </div>
      ) : (
        <div className="surface-card p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink inline-flex items-center gap-2"><CalendarCheck2 size={16} /> {cur.label || "Caisse de la semaine"} — ouverte depuis le {fr(cur.openDay)}</h3>
            <p className="text-sm text-ink2">Fonds de caisse : {MONEY(cur.openingFloat)}{cur.openedBy ? ` · ouverte par ${cur.openedBy.firstName ?? ""} ${cur.openedBy.lastName ?? ""}` : ""}</p>
          </div>
          <div className="flex gap-2">
            {r && <button onClick={() => printReport(r, deskName, cur, data.showCosts)} className={buttonClass("secondary", "md")}><Printer size={15} /> Imprimer</button>}
            <button onClick={() => setCloseDlg(true)} className={buttonClass("primary", "md")}><Lock size={15} /> Fermer la caisse</button>
          </div>
        </div>
      )}

      {cur?.progress && (cur.progress.revenue || cur.progress.margin) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {cur.progress.revenue && cur.targets?.revenue && <Gauge label="Objectif de chiffre d'affaires" actual={r?.sales.revenueTTC ?? 0} target={cur.targets.revenue} p={cur.progress.revenue} day={cur.progress.elapsedDays} />}
          {cur.progress.margin && cur.targets?.margin && <Gauge label="Objectif de marge" actual={r?.sales.margin ?? 0} target={cur.targets.margin} p={cur.progress.margin} day={cur.progress.elapsedDays} />}
        </div>
      )}

      {r && <ReportView r={r} prev={prev} showCosts={data.showCosts} />}

      {data.showCosts && <CashiersPanel deskId={deskId} />}

      <section>
        <h3 className="text-sm font-bold text-ink mb-2">Semaines précédentes</h3>
        {data.history.length === 0 ? <EmptyState icon={<CalendarCheck2 size={20} />} title="Aucune caisse fermée" hint="Chaque fermeture ajoute ici le bilan de la période." /> : (
          <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Période</th><th className="text-right">Chiffre d&apos;affaires</th><th className="text-right">Tickets</th><th className="text-right">Recettes</th><th className="text-right">Dépenses</th><th className="text-right">Solde</th>{data.showCosts && <th className="text-right">Marge</th>}<th className="text-right">Écart caisse</th><th></th></tr></thead>
              <tbody>
                {data.history.map(s => {
                  const x = s.summary;
                  return (
                    <tr key={s._id}>
                      <td className="text-ink whitespace-nowrap">{fr(s.openDay)} → {s.closeDay ? fr(s.closeDay) : "—"}</td>
                      <td className="text-right font-mono">{MONEY(x?.sales.revenueTTC)}</td>
                      <td className="text-right font-mono text-ink2">{x?.sales.count ?? "—"}</td>
                      <td className="text-right font-mono text-pos">{MONEY(x?.receipts)}</td>
                      <td className="text-right font-mono text-neg">{MONEY(x?.expenses)}</td>
                      <td className="text-right font-mono font-semibold">{MONEY(x?.balance)}</td>
                      {data.showCosts && <td className="text-right font-mono">{MONEY(x?.sales.margin)}</td>}
                      <td className={`text-right font-mono ${(x?.gap ?? 0) < 0 ? "text-neg" : (x?.gap ?? 0) > 0 ? "text-warn" : "text-ink2"}`}>{MONEY(x?.gap)}</td>
                      <td className="text-right">{x && <button onClick={() => printReport(x, deskName, s, data.showCosts)} className="p-1.5 text-ink3 hover:text-section" title="Imprimer le bilan"><Printer size={14} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div></div>
        )}
      </section>

      {openDlg && <OpenDialog deskId={deskId} suggested={data.suggestedFloat ?? data.history[0]?.summary?.countedCash} onClose={() => setOpenDlg(false)} onDone={() => { setOpenDlg(false); reload(); onChange(); }} />}
      {closeDlg && cur && r && <CloseDialog session={cur} report={r} onClose={() => setCloseDlg(false)} onDone={() => { setCloseDlg(false); reload(); onChange(); }} />}
    </div>
  );
}

function Trend({ now, before }: { now: number; before?: number }) {
  if (before === undefined || before === null || before === 0) return null;
  const d = Math.round(((now - before) / Math.abs(before)) * 100);
  return <span className={`text-xs inline-flex items-center gap-0.5 ${d >= 0 ? "text-pos" : "text-neg"}`}>{d >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{d > 0 ? "+" : ""}{d} % vs précédente</span>;
}

function ReportView({ r, prev, showCosts }: { r: Report; prev: Report | null; showCosts: boolean }) {
  const maxDay = Math.max(1, ...r.byDay.map(d => d.revenueTTC));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Chiffre d'affaires" value={MONEY(r.sales.revenueTTC)} sub={<Trend now={r.sales.revenueTTC} before={prev?.sales.revenueTTC} />} />
        <Card label="Recettes / dépenses" value={`${MONEY(r.receipts)}`} sub={<span className="text-xs text-neg">− {MONEY(r.expenses)}</span>} />
        <Card label="Solde de la période" value={MONEY(r.balance)} tone={r.balance < 0 ? "neg" : "pos"} />
        <Card label="Espèces attendues en caisse" value={MONEY(r.expectedCash)} sub={<span className="text-xs text-ink3">fonds {MONEY(r.openingFloat)} inclus</span>} />
        <Card label="Tickets" value={String(r.sales.count)} sub={<span className="text-xs text-ink3">panier moyen {MONEY(r.sales.averageTicket)}</span>} />
        {showCosts && <Card label="Marge brute HT" value={MONEY(r.sales.margin)} tone={(r.sales.margin ?? 0) < 0 ? "neg" : "pos"} sub={<Trend now={r.sales.margin ?? 0} before={prev?.sales.margin} />} />}
        {showCosts && <Card label="Taux de marque" value={r.sales.markupRate === null || r.sales.markupRate === undefined ? "—" : `${r.sales.markupRate.toLocaleString("fr-FR")} %`} />}
        {r.otherReceipts > 0 && <Card label="Recettes hors tickets" value={MONEY(r.otherReceipts)} />}
        {(r.creditSales ?? 0) > 0 && <Card label="Vendu à l'ardoise" value={MONEY(r.creditSales)} sub={<span className="text-xs text-ink3">réglé : {MONEY(r.creditSettled ?? 0)}</span>} />}
        {showCosts && r.shrinkage && (r.shrinkage.total ?? 0) > 0 && <Card label="Pertes et casse (au coût)" value={MONEY(r.shrinkage.total)} tone="neg" />}
        {showCosts && r.netMargin !== undefined && (r.shrinkage?.total ?? 0) > 0 && <Card label="Marge après pertes" value={MONEY(r.netMargin)} tone={(r.netMargin ?? 0) < 0 ? "neg" : "pos"} />}
      </div>

      {r.byDay.length > 0 && (
        <section className="surface-card p-4">
          <h4 className="text-sm font-bold text-ink mb-3">Chiffre d&apos;affaires par jour</h4>
          <div className="flex items-end gap-2 h-32">
            {r.byDay.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10px] font-mono text-ink2">{Math.round(d.revenueTTC / 1000).toLocaleString("fr-FR")}k</span>
                <div className="w-full rounded-t bg-section" style={{ height: `${Math.max(3, (d.revenueTTC / maxDay) * 90)}px` }} title={`${fr(d.day)} : ${MONEY(d.revenueTTC)}, ${d.tickets} ticket(s)`} />
                <span className="text-[10px] text-ink3">{fr(d.day)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-3 gap-3">
        <List title="Meilleures ventes (CA)" icon={<Trophy size={14} />} rows={r.topByRevenue.slice(0, 5)} value={p => MONEY(p.revenueTTC)} extra={p => `× ${p.quantity}`} />
        <List title="Les plus vendus (quantité)" rows={r.topByQuantity.slice(0, 5)} value={p => `${p.quantity}`} extra={p => MONEY(p.revenueTTC)} />
        {showCosts ? <List title="Ce qui rapporte le plus (marge)" rows={r.topByMargin.slice(0, 5)} value={p => MONEY(p.margin)} />
          : <section className="surface-card p-4"><h4 className="text-sm font-bold text-ink mb-2">Moyens de paiement</h4>{r.byMethod.map(m => <p key={m.method} className="text-sm flex justify-between"><span className="text-ink2">{SALE_METHOD_LABEL[m.method] ?? m.method}</span><span className="font-mono">{MONEY(m.receipts)}</span></p>)}</section>}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="surface-card p-4">
          <h4 className="text-sm font-bold text-ink mb-2">Dépenses par nature</h4>
          {r.expensesByCategory.length === 0 ? <p className="text-sm text-ink3">Aucune dépense.</p> : r.expensesByCategory.map(c => (
            <p key={c.category} className="text-sm flex justify-between py-0.5"><span className="text-ink2">{c.label}</span><span className="font-mono">{MONEY(c.amount)}</span></p>
          ))}
        </section>
        {showCosts && <section className="surface-card p-4">
          {r.shrinkage && r.shrinkage.byReason.length > 0 && <>
            <h4 className="text-sm font-bold text-ink mb-2">Pertes par motif</h4>
            {r.shrinkage.byReason.map(x => <p key={x.reason} className="text-sm flex justify-between py-0.5"><span className="text-ink2">{x.label}</span><span className="font-mono text-neg">{MONEY(x.value)}</span></p>)}
          </>}
          <h4 className="text-sm font-bold text-ink mb-2 mt-2">Moyens de paiement</h4>
          {r.byMethod.map(m => <p key={m.method} className="text-sm flex justify-between py-0.5"><span className="text-ink2">{SALE_METHOD_LABEL[m.method] ?? m.method}</span><span className="font-mono">+{MONEY(m.receipts)}{m.expenses ? ` / −${MONEY(m.expenses)}` : ""}</span></p>)}
          {r.losses.length > 0 && <p className="mt-2 text-xs text-neg">Vendus à perte : {r.losses.map(l => l.label).join(", ")}.</p>}
        </section>}
      </div>
    </div>
  );
}

function Gauge({ label, actual, target, p, day }: { label: string; actual: number; target: number; p: Progress; day: number }) {
  const pct = Math.min(100, Math.max(0, p.rate));
  const pace = Math.min(100, (p.expected / target) * 100);
  return (
    <div className="surface-card p-4">
      <div className="flex justify-between text-sm"><span className="font-semibold text-ink">{label}</span><span className={p.behind ? "text-neg font-semibold" : "text-pos font-semibold"}>{p.rate.toLocaleString("fr-FR")} %</span></div>
      <div className="relative h-3 mt-2 rounded-full bg-surface2 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${p.behind ? "bg-neg" : "bg-pos"}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${pace}%` }} title="Rythme attendu" />
      </div>
      <p className="text-xs text-ink2 mt-1.5">{MONEY(actual)} sur {MONEY(target)} · jour {Math.min(day, 7)}/7{p.behind ? ` · en retard (attendu ${MONEY(p.expected)})` : ""}{p.perDayNeeded !== null ? ` · ${MONEY(p.perDayNeeded)} par jour d'ici la fin` : ""}</p>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="surface-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-ink"}`}>{value}</p>
      {sub}
    </div>
  );
}

function List({ title, icon, rows, value, extra }: { title: string; icon?: React.ReactNode; rows: Product[]; value: (p: Product) => string; extra?: (p: Product) => string }) {
  return (
    <section className="surface-card p-4">
      <h4 className="text-sm font-bold text-ink mb-2 inline-flex items-center gap-1.5">{icon} {title}</h4>
      {rows.length === 0 ? <p className="text-sm text-ink3">Aucune vente.</p> : (
        <ol className="text-sm divide-y divide-line">
          {rows.map((p, i) => <li key={p.itemId} className="py-1.5 flex justify-between gap-2"><span className="text-ink truncate">{i + 1}. {p.label}{extra ? <span className="text-ink3"> · {extra(p)}</span> : null}</span><span className="font-mono text-ink2">{value(p)}</span></li>)}
        </ol>
      )}
    </section>
  );
}

function OpenDialog({ deskId, suggested, onClose, onDone }: { deskId: string; suggested?: number; onClose: () => void; onDone: () => void }) {
  const [float, setFloat] = useState(suggested !== undefined ? String(suggested) : "");
  const [label, setLabel] = useState("");
  const [rev, setRev] = useState("");
  const [mar, setMar] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/sessions", { deskId, openingFloat: Number(float) || 0, label: label || undefined,
      ...(rev || mar ? { targets: { ...(rev ? { revenue: Number(rev) } : {}), ...(mar ? { margin: Number(mar) } : {}) } } : {}) });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Ouverture refusée.", "error"); return; }
    showToast("Caisse ouverte.", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Ouvrir la caisse" size="sm">
      <div className="space-y-4">
        <FormField label="Fonds de caisse (espèces au départ)" hint={suggested !== undefined ? "Proposé : l'argent de la caisse selon les comptes. Comptez le tiroir : un écart se verra à la fermeture." : undefined}>
          <input type="number" min={0} className={inputCls} value={float} onChange={e => setFloat(e.target.value)} />
        </FormField>
        <FormField label="Nom (facultatif)"><input className={inputCls} maxLength={80} placeholder="Semaine 44" value={label} onChange={e => setLabel(e.target.value)} /></FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Objectif de CA (semaine)" hint="Vide : celui du comptoir"><input type="number" min={0} className={inputCls} value={rev} onChange={e => setRev(e.target.value)} /></FormField>
          <FormField label="Objectif de marge"><input type="number" min={0} className={inputCls} value={mar} onChange={e => setMar(e.target.value)} /></FormField>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={busy} onClick={save} className={buttonClass("primary", "md")}><Unlock size={15} /> Ouvrir</button>
        </div>
      </div>
    </Modal>
  );
}

function CloseDialog({ session, report, onClose, onDone }: { session: Session; report: Report; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const gap = counted === "" ? null : Number(counted) - report.expectedCash;
  async function save() {
    if (!(await confirmDialog({ title: "Fermer la caisse ?", message: `Période du ${fr(session.openDay)} à aujourd'hui. ${gap ? `Écart de ${MONEY(gap)} comptabilisé. ` : ""}Les jours de la période ne pourront plus être modifiés.`, confirmLabel: "Fermer la caisse" }))) return;
    setBusy(true);
    const res = await apiSend("POST", `/api/comptoir/sessions/${session._id}/close`, { countedCash: Number(counted), notes: notes || undefined });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Fermeture refusée.", "error"); return; }
    showToast("Caisse fermée.", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Fermer la caisse" size="md">
      <div className="space-y-4">
        <div className="surface-card p-4 text-sm space-y-1">
          <p className="flex justify-between"><span className="text-ink2">Chiffre d&apos;affaires de la période</span><span className="font-mono">{MONEY(report.sales.revenueTTC)}</span></p>
          <p className="flex justify-between"><span className="text-ink2">Recettes / dépenses</span><span className="font-mono">{MONEY(report.receipts)} / {MONEY(report.expenses)}</span></p>
          <p className="flex justify-between font-semibold border-t border-line pt-1"><span>Espèces attendues (fonds compris)</span><span className="font-mono">{MONEY(report.expectedCash)}</span></p>
        </div>
        <FormField label="Espèces comptées" required><input type="number" min={0} className={inputCls} value={counted} onChange={e => setCounted(e.target.value)} /></FormField>
        <FormField label="Observations"><input className={inputCls} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></FormField>
        {gap !== null && <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${gap === 0 ? "bg-pos-50 text-pos" : "bg-warn-50 text-warn"}`}>{gap === 0 ? "Caisse juste." : `Écart : ${gap > 0 ? "+" : ""}${MONEY(gap)} (${gap > 0 ? "excédent" : "manquant"}).`}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={busy || counted === ""} onClick={save} className={buttonClass("primary", "md")}><Lock size={15} /> Fermer</button>
        </div>
      </div>
    </Modal>
  );
}

/** Bilan imprimable de la période (texte échappé). */
function printReport(r: Report, deskName: string, s: Session, showCosts: boolean) {
  const row = (a: string, b: string) => `<tr><td>${h(a)}</td><td class="r">${h(b)}</td></tr>`;
  const top = r.topByRevenue.slice(0, 10).map((p, i) => row(`${i + 1}. ${p.label} × ${p.quantity}`, MONEY(p.revenueTTC))).join("");
  const exp = r.expensesByCategory.map(c => row(c.label, MONEY(c.amount))).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bilan de caisse ${h(r.fromDay)}</title>
    <style>body{font-family:system-ui,Arial,sans-serif;padding:28px;color:#111;font-size:13px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}
    table{width:100%;border-collapse:collapse}td{padding:4px 6px;border-bottom:1px solid #e5e5e5}.r{text-align:right;white-space:nowrap}</style></head>
    <body><h1>${h(deskName)} — bilan de caisse</h1><p>Du ${h(fr(r.fromDay))} au ${h(fr(r.toDay))}${s.label ? ` · ${h(s.label)}` : ""}</p>
    <h2>Synthèse</h2><table>
      ${row("Chiffre d'affaires (tickets)", MONEY(r.sales.revenueTTC))}${row("Nombre de tickets", String(r.sales.count))}${row("Panier moyen", MONEY(r.sales.averageTicket))}
      ${showCosts ? row("Marge brute HT", MONEY(r.sales.margin)) : ""}
      ${row("Recettes", MONEY(r.receipts))}${row("Dépenses", MONEY(r.expenses))}${row("Solde de la période", MONEY(r.balance))}
      ${row("Fonds de caisse", MONEY(r.openingFloat))}${row("Espèces attendues", MONEY(r.expectedCash))}
      ${r.countedCash !== undefined ? row("Espèces comptées", MONEY(r.countedCash)) + row("Écart", MONEY(r.gap ?? 0)) : ""}
    </table>
    <h2>Meilleures ventes</h2><table>${top || row("Aucune vente", "")}</table>
    <h2>Dépenses par nature</h2><table>${exp || row("Aucune dépense", "")}</table>
    <p style="margin-top:28px;font-size:12px">Visa du caissier : ________________  Visa du gestionnaire : ________________</p></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
}
