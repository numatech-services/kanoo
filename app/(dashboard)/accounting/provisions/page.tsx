"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Scale, Ban, RefreshCw } from "lucide-react";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { formatMoney, formatDate } from "@/lib/format";

interface Item {
  _id: string; number: string; client: string; dueDate?: string; daysLate: number; due: number;
  doubtful: boolean; rate: number; suggestedRate: number; provision: number; required: number; toAdjust: number;
}
interface Data { items: Item[]; totals: { doubtfulTTC: number; provision: number; required: number; watchTTC: number } }
const pct = (r: number) => `${Math.round(r * 100)} %`;
const parseRate = (v: string | null) => { if (v === null) return null; const n = Number(v.replace(",", ".").replace("%", "").trim()); return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : NaN; };

/**
 * Créances douteuses et dépréciations : les retards de 90 jours et plus sont
 * proposés au classement en douteux (416), dépréciés sur le HT (491) au taux
 * estimé de perte, recalés à chaque inventaire, ou passés en perte (651).
 */
export default function ProvisionsPage() {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(async () => { setD((await apiJson("/api/accounting/provisions"))?.data ?? null); }, []);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>, ok: string) {
    const res = await apiSend("POST", "/api/accounting/provisions", body);
    if (!res.ok) { showToast(res.data?.error || "Opération refusée.", "error"); return; }
    showToast(ok, "success"); load();
  }
  async function classify(i: Item) {
    const v = await promptDialog({ title: `Classer ${i.number} en créance douteuse`, message: `${formatMoney(i.due)} passent du compte client (411) aux créances douteuses (416). Taux de dépréciation estimé (sur le HT) — suggestion pour ${i.daysLate} jours de retard :`, label: "Taux (%)", defaultValue: String(Math.round(i.suggestedRate * 100)), required: true, confirmLabel: "Classer en douteuse" });
    const rate = parseRate(v); if (rate === null) return;
    if (Number.isNaN(rate)) { showToast("Taux invalide (0 à 100).", "error"); return; }
    post({ action: "doubtful", invoiceId: i._id, rate }, `${i.number} classée en créance douteuse.`);
  }
  async function rerate(i: Item) {
    const v = await promptDialog({ title: `Dépréciation de ${i.number}`, message: "Nouveau taux de perte estimé, sur le HT du reste dû. La différence est dotée (6594) ou reprise (7594).", label: "Taux (%)", defaultValue: String(Math.round(i.rate * 100)), required: true, confirmLabel: "Ajuster" });
    const rate = parseRate(v); if (rate === null) return;
    if (Number.isNaN(rate)) { showToast("Taux invalide (0 à 100).", "error"); return; }
    post({ action: "provision", invoiceId: i._id, rate }, "Dépréciation ajustée.");
  }
  async function loss(i: Item) {
    if (!(await confirmDialog({ title: `Passer ${i.number} en perte ?`, message: `Créance irrécouvrable de ${formatMoney(i.due)} : perte (651) sur le HT, TVA collectée régularisée, dépréciation reprise. À réserver aux créances définitivement perdues (liquidation, procédure close).`, danger: true, confirmLabel: "Passer en perte" }))) return;
    post({ action: "writeoff", invoiceId: i._id }, `${i.number} passée en perte.`);
  }
  async function adjustAll() {
    if (!(await confirmDialog({ title: "Recaler toutes les dépréciations ?", message: "Chaque créance douteuse est dépréciée à son taux, sur son reste dû d'aujourd'hui (inventaire de fin de période).", confirmLabel: "Recaler" }))) return;
    post({ action: "adjust_all" }, "Dépréciations recalées.");
  }

  const doubtful = d?.items.filter(i => i.doubtful) ?? [];
  const watch = d?.items.filter(i => !i.doubtful) ?? [];
  return (
    <div className="space-y-5">
      <ScreenTabs group="accounting" />
      <div>
        <Link href="/accounting" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Comptabilité</Link>
        <h1 className="page-title mt-1">Créances douteuses et dépréciations</h1>
        <p className="text-sm text-ink2">Les retards de plus de 90 jours sont à examiner : classez-les en douteux, dépréciez-les au taux de perte estimé, recalez à chaque clôture.</p>
      </div>

      {d && (
        <section className="surface-card p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><p className="text-xs text-ink3">Créances douteuses (416)</p><p className="text-xl font-bold num text-ink">{formatMoney(d.totals.doubtfulTTC)}</p></div>
          <div><p className="text-xs text-ink3">Dépréciation comptabilisée (491)</p><p className="text-xl font-bold num text-ink">{formatMoney(d.totals.provision)}</p></div>
          <div><p className="text-xs text-ink3">Dépréciation requise</p><p className={`text-xl font-bold num ${d.totals.required !== d.totals.provision ? "text-warn" : "text-pos"}`}>{formatMoney(d.totals.required)}</p></div>
          <div><p className="text-xs text-ink3">Retards à examiner</p><p className="text-xl font-bold num text-ink">{formatMoney(d.totals.watchTTC)}</p></div>
        </section>
      )}

      <section className="surface-card overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><Scale size={16} /> Créances douteuses</h2>
          {doubtful.length > 0 && <button onClick={adjustAll} className={buttonClass("secondary", "sm")}><RefreshCw size={13} /> Recaler toutes les dépréciations</button>}
        </div>
        {doubtful.length === 0 ? <p className="px-5 py-5 text-sm text-ink3">Aucune créance douteuse.</p> : (
          <div className="overflow-x-auto"><table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>Facture</th><th>Client</th><th className="text-right">Reste dû</th><th className="text-right">Taux</th><th className="text-right">Dépréciée</th><th className="text-right">Requise</th><th /></tr></thead>
            <tbody>{doubtful.map(i => (
              <tr key={i._id} className="border-t border-line">
                <td><Link href={`/invoices/${i._id}`} className="font-mono text-section hover:underline">{i.number}</Link></td>
                <td className="text-sm">{i.client}</td>
                <td className="text-right num">{formatMoney(i.due)}</td>
                <td className="text-right">{pct(i.rate)}</td>
                <td className="text-right num">{formatMoney(i.provision)}</td>
                <td className={`text-right num ${i.toAdjust ? "text-warn font-semibold" : ""}`}>{formatMoney(i.required)}</td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => rerate(i)} className={buttonClass("secondary", "sm")}>Taux</button>
                  <button onClick={() => loss(i)} className={buttonClass("secondary", "sm", "ml-1 text-neg")}><Ban size={13} /> Perte</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="surface-card overflow-hidden">
        <h2 className="font-semibold text-ink px-5 py-4 border-b border-line inline-flex items-center gap-2 w-full"><AlertTriangle size={16} /> Retards de plus de 90 jours</h2>
        {watch.length === 0 ? <p className="px-5 py-5 text-sm text-ink3">Aucun retard de plus de 90 jours.</p> : (
          <div className="overflow-x-auto"><table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>Facture</th><th>Client</th><th>Échéance</th><th className="text-right">Retard</th><th className="text-right">Reste dû</th><th className="text-right">Taux suggéré</th><th /></tr></thead>
            <tbody>{watch.map(i => (
              <tr key={i._id} className="border-t border-line">
                <td><Link href={`/invoices/${i._id}`} className="font-mono text-section hover:underline">{i.number}</Link></td>
                <td className="text-sm">{i.client}</td>
                <td className="text-xs text-ink2">{i.dueDate ? formatDate(i.dueDate) : "—"}</td>
                <td className="text-right">{i.daysLate} j</td>
                <td className="text-right num">{formatMoney(i.due)}</td>
                <td className="text-right">{pct(i.suggestedRate)}</td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => classify(i)} className={buttonClass("secondary", "sm")}>Douteuse</button>
                  <button onClick={() => loss(i)} className={buttonClass("secondary", "sm", "ml-1 text-neg")}><Ban size={13} /> Perte</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
