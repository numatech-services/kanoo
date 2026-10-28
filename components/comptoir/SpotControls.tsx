"use client";
import { useState } from "react";
import { Smartphone, UserCheck, AlertTriangle, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";

const MONEY = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} FCFA`;
const fr = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => localDay(new Date(Date.now() - n * 86_400_000));

interface Line { _id: string; date: string; amount: number; reference?: string; phone?: string }
interface Entry { _id: string; date: string; amount: number; label: string }
interface Momo { from: string; to: string; totals: { statement: number; kanoo: number; gap: number }; matched: Array<{ line: Line; entry: Entry }>; statementOnly: Line[]; kanooOnly: Entry[] }

/**
 * Rapprochement mobile money : le relevé de l'opérateur (Airtel, Moov,
 * Zamani) collé ou importé en CSV, comparé aux encaissements « OM / Moov /
 * Airtel » de la caisse : même montant à un jour près.
 */
export function MomoDialog({ deskId, onClose }: { deskId: string; onClose: () => void }) {
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => daysAgo(0));
  const { data, reload } = useApi<Momo | null>(`/api/comptoir/momo?deskId=${deskId}&from=${from}&to=${to}`, d => d?.data ?? null, null);
  const [csv, setCsv] = useState("");
  const [operator, setOperator] = useState("Airtel Money");
  const [busy, setBusy] = useState(false);

  async function load(file?: File) { if (file) setCsv(await file.text()); }
  async function upload() {
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/momo", { deskId, operator, csv });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Import refusé.", "error"); return; }
    const r = res.data.data as { added: number; skipped: number; errors: string[] };
    showToast(`${r.added} ligne(s) importée(s)${r.skipped ? `, ${r.skipped} déjà connue(s)` : ""}${r.errors.length ? `, ${r.errors.length} illisible(s)` : ""}.`, r.errors.length ? "warning" : "success");
    setCsv(""); reload();
  }

  return (
    <Modal open onClose={onClose} title="Rapprochement mobile money" size="lg">
      <div className="space-y-4">
        <div className="surface-card p-3 space-y-2">
          <p className="text-sm text-ink2">Relevé de l&apos;opérateur : une ligne par opération, <code>date ; montant ; référence ; téléphone</code> (format JJ/MM/AAAA HH:MM accepté).</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <FormField label="Opérateur"><select className={selectCls} value={operator} onChange={e => setOperator(e.target.value)}><option>Airtel Money</option><option>Moov Money</option><option>Zamani Cash</option><option>Autre</option></select></FormField>
            <FormField label="Fichier CSV"><input type="file" accept=".csv,.txt" className="text-sm" onChange={e => load(e.target.files?.[0])} /></FormField>
          </div>
          <textarea className={`${inputCls} h-24 font-mono text-xs`} placeholder={"27/10/2026 18:05;1000;TX123;90000000"} value={csv} onChange={e => setCsv(e.target.value)} />
          <div className="flex justify-end"><button disabled={busy || !csv.trim()} onClick={upload} className={buttonClass("primary", "sm")}><Upload size={14} /> Importer et rapprocher</button></div>
        </div>
        <div className="flex gap-2 items-end">
          <FormField label="Du"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></FormField>
          <FormField label="Au"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></FormField>
        </div>
        {data && (
          <>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="surface-card p-3"><p className="text-xs text-ink2">Relevé opérateur</p><p className="font-bold">{MONEY(data.totals.statement)}</p></div>
              <div className="surface-card p-3"><p className="text-xs text-ink2">Encaissé en caisse</p><p className="font-bold">{MONEY(data.totals.kanoo)}</p></div>
              <div className="surface-card p-3"><p className="text-xs text-ink2">Écart</p><p className={`font-bold ${data.totals.gap === 0 ? "text-pos" : "text-neg"}`}>{MONEY(data.totals.gap)}</p></div>
            </div>
            <p className="text-sm text-pos">{data.matched.length} opération(s) rapprochée(s).</p>
            {data.statementOnly.length > 0 && <div><h4 className="text-sm font-semibold text-warn">Reçu chez l&apos;opérateur, absent de la caisse (ticket oublié ?)</h4>
              <ul className="text-sm divide-y divide-line">{data.statementOnly.map(l => <li key={l._id} className="py-1 flex justify-between"><span>{fr(l.date)} · {l.reference ?? ""} {l.phone ?? ""}</span><span className="font-mono">{MONEY(l.amount)}</span></li>)}</ul></div>}
            {data.kanooOnly.length > 0 && <div><h4 className="text-sm font-semibold text-neg">Encaissé en caisse, absent du relevé (paiement non reçu, ou mauvais moyen saisi)</h4>
              <ul className="text-sm divide-y divide-line">{data.kanooOnly.map(e => <li key={e._id} className="py-1 flex justify-between"><span>{fr(e.date)} · {e.label}</span><span className="font-mono">{MONEY(e.amount)}</span></li>)}</ul></div>}
          </>
        )}
      </div>
    </Modal>
  );
}

interface Cashier { userId: string; name: string; tickets: number; revenueTTC: number; averageTicket: number; cancelled: number; cancelledAmount: number; cancelRate: number; discountGiven: number; closings: number; cashGap: number; alert: boolean }

/** Contrôle par caissier : tickets, chiffre d'affaires, annulations, remises, écarts de caisse. */
export function CashiersPanel({ deskId }: { deskId: string }) {
  const { data } = useApi<{ from: string; to: string; items: Cashier[] } | null>(`/api/comptoir/cashiers?deskId=${deskId}`, d => (d?.success === false ? null : d?.data ?? null), null, { quiet: true });
  if (!data || data.items.length === 0) return null;
  return (
    <section className="surface-card overflow-hidden">
      <h3 className="text-sm font-bold text-ink px-4 pt-4 inline-flex items-center gap-1.5"><UserCheck size={15} /> Par caissier — 7 derniers jours</h3>
      <div className="overflow-x-auto p-2">
        <table className="table-dense">
          <thead><tr><th>Caissier</th><th className="text-right">Tickets</th><th className="text-right">CA</th><th className="text-right">Panier moyen</th><th className="text-right">Annulations</th><th className="text-right">Remises</th><th className="text-right">Écart de caisse</th></tr></thead>
          <tbody>
            {data.items.map(c => (
              <tr key={c.userId}>
                <td className="text-ink">{c.name} {c.alert && <Pill tone="neg"><AlertTriangle size={11} className="inline" /> à vérifier</Pill>}</td>
                <td className="text-right font-mono">{c.tickets}</td>
                <td className="text-right font-mono">{MONEY(c.revenueTTC)}</td>
                <td className="text-right font-mono text-ink2">{MONEY(c.averageTicket)}</td>
                <td className={`text-right font-mono ${c.cancelled ? "text-warn" : ""}`}>{c.cancelled} ({c.cancelRate} %)<span className="block text-[11px] text-ink3">{MONEY(c.cancelledAmount)}</span></td>
                <td className="text-right font-mono">{MONEY(c.discountGiven)}</td>
                <td className={`text-right font-mono ${c.cashGap < 0 ? "text-neg" : ""}`}>{c.closings ? MONEY(c.cashGap) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const MomoIcon = Smartphone;
