"use client";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
import { useApi } from "@/lib/use-api";
import { apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
import { promptDialog, confirmDialog } from "@/components/ui/Dialogs";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { useMe, meCanDo } from "@/lib/useMe";
import { urlParam } from "@/lib/url-param";

interface Data {
  tvaCollectee: number; tvaDeductible: number; tvaNette: number; aVerser: number; creditReporte: number; creditAnterieur: number;
  liquidee: boolean; liquidationPerimee?: boolean; statut: string; ecartDeclaration?: number;
  paiement: { settled: boolean; due: number; paid: number; remaining: number } | null;
}
const MONEY = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const MONTHS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

/**
 * TVA du mois : déclaration (montants de la comptabilité), liquidation
 * (443/445 soldés vers la TVA à payer ou le crédit à reporter) et paiement à la
 * DGI. S'ouvre sur le mois écoulé, celui qu'on déclare, ou sur le mois d'un rappel.
 */
export default function TVAPage() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(() => Number(urlParam("annee")) || prev.getFullYear());
  const [month, setMonth] = useState(() => { const m = Number(urlParam("mois")); return m >= 1 && m <= 12 ? m : prev.getMonth() + 1; });
  const { data, loading, reload } = useApi<Data | null>(`/api/fiscal/tva?annee=${year}&mois=${month}`, d => d.data ?? null, null);
  const me = useMe();
  const canPost = meCanDo(me, "accountingEntries", "create");
  const [submitting, setSubmitting] = useState(false);
  const [settle, setSettle] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const finished = new Date(year, month, 1) <= now;
  const declared = data?.statut === "submitted" || data?.statut === "paid";

  // Enregistre la déclaration du mois, montants recalculés par le serveur ;
  // une déclaration déjà enregistrée ne se rectifie qu'avec un motif.
  async function submit() {
    const motif = declared
      ? await promptDialog({ title: "Rectifier la déclaration de TVA ?", message: "Les montants sont recalculés sur la comptabilité actuelle. L'ancienne version est conservée au journal d'audit. Déposez aussi la rectificative auprès de la DGI.", label: "Motif de la rectification", confirmLabel: "Rectifier", required: true })
      : (await confirmDialog({ title: "Enregistrer la déclaration de TVA ?", message: "À faire une fois la déclaration déposée auprès de la DGI, avec les montants affichés.", confirmLabel: "Enregistrer" })) ? "" : null;
    if (motif === null) return;
    setSubmitting(true);
    // Rectification : la liquidation se repasse à part (bouton), jamais d'office.
    const res = await apiSend("POST", "/api/fiscal/tva", { annee: year, mois: month, motif: motif || undefined, settle: !declared && canPost && settle });
    setSubmitting(false);
    if (!res.ok) { showToast((res.data as { error?: string })?.error || "Déclaration non enregistrée.", "error"); return; }
    let warning = (res.data as { data?: { warning?: string } })?.data?.warning;
    // Rectification d'un mois déjà liquidé : la liquidation est repassée aussitôt (sinon elle serait périmée).
    if (declared && data?.liquidee && canPost) {
      const lq = await apiSend("POST", "/api/fiscal/tva/liquidation", { annee: year, mois: month });
      if (!lq.ok) warning = `Déclaration rectifiée, liquidation non repassée : ${(lq.data as { error?: string })?.error ?? "refus"}`;
    }
    if (warning) showToast(warning, "error");
    else showToast(declared ? "Déclaration de TVA rectifiée" : settle && canPost ? "Déclaration enregistrée, TVA liquidée" : "Déclaration de TVA enregistrée", "success");
    reload();
  }

  async function liquidate() {
    if (!(await confirmDialog({ title: "Passer la liquidation du mois ?", message: "TVA collectée et déductible soldées au dernier jour du mois ; TVA à payer (4441) ou crédit à reporter (4449). Une liquidation déjà passée pour ce mois est remplacée.", confirmLabel: "Liquider" }))) return;
    setSubmitting(true);
    const res = await apiSend("POST", "/api/fiscal/tva/liquidation", { annee: year, mois: month });
    setSubmitting(false);
    if (!res.ok) { showToast((res.data as { error?: string })?.error || "Liquidation refusée.", "error"); return; }
    showToast("TVA liquidée", "success");
    reload();
  }

  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  const remaining = data?.paiement?.remaining ?? 0;
  return (
    <div className="space-y-6 max-w-2xl">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-sm text-ink2 mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">TVA</span></div>
        <h1 className="page-title">Déclaration TVA</h1>
      </div>
      <div className="flex gap-3">
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className={inp} aria-label="Mois">{MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className={inp} aria-label="Année">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}</select>
      </div>
      {loading ? <div className="h-48 bg-surface2 animate-pulse rounded-xl" /> : data && (
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-line p-5 space-y-3">
            {([["TVA collectée (ventes)", data.tvaCollectee, "text-neg"], ["TVA déductible (achats)", data.tvaDeductible, "text-pos"], ["TVA nette du mois", data.tvaNette, data.tvaNette >= 0 ? "text-warn" : "text-pos"],
              ...(data.creditAnterieur ? [["Crédit de TVA des mois précédents", -data.creditAnterieur, "text-pos"]] : [])] as Array<[string, number, string]>).map(([l, v, c]) => (
              <div key={l} className="flex justify-between text-sm border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="text-ink2">{l}</span><span className={`font-mono font-bold ${c}`}>{MONEY(v)}</span>
              </div>
            ))}
          </div>
          <div className={`rounded-xl p-5 ${data.aVerser > 0 ? "bg-warn-50 border border-warn/25" : "bg-pos-50 border border-pos/25"}`}>
            <p className="text-sm font-semibold text-ink">{data.aVerser > 0 ? "Montant à verser à la DGI" : data.creditReporte > 0 ? "Rien à verser — crédit de TVA à reporter" : "Rien à verser"}</p>
            <p className={`text-3xl font-bold font-mono mt-1 ${data.aVerser > 0 ? "text-warn" : "text-pos"}`}>{MONEY(data.aVerser || data.creditReporte)}</p>
          </div>
          <div className="bg-info-50 border border-info/25 rounded-xl p-3 text-xs text-info">Date limite de dépôt et de paiement : avant le 15/{String(month === 12 ? 1 : month + 1).padStart(2, "0")}/{month === 12 ? year + 1 : year}</div>
          {declared && !!data.ecartDeclaration && <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-xs text-warn">La comptabilité du mois a changé depuis la déclaration : écart de {MONEY(data.ecartDeclaration)}.</div>}

          {/* Étapes : déclaration → liquidation → paiement. */}
          <ol className="surface-card p-4 space-y-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span><b>1. Déclaration</b> — {data.statut === "paid" ? "payée" : declared ? "enregistrée" : finished ? "à enregistrer une fois déposée à la DGI" : "le mois n'est pas terminé"}</span>
              {finished && data.statut !== "paid" && <button onClick={submit} disabled={submitting} className={buttonClass(declared ? "secondary" : "primary", "sm")}>{submitting ? "Envoi…" : declared ? "Rectifier" : "Enregistrer"}</button>}
            </li>
            {finished && !declared && canPost && (
              <li className="pl-4">
                <label className="flex items-start gap-2 text-ink2">
                  <input type="checkbox" className="accent-section mt-0.5" checked={settle} onChange={e => setSettle(e.target.checked)} />
                  <span>Passer en même temps la liquidation (TVA à payer ou crédit à reporter en comptabilité).</span>
                </label>
              </li>
            )}
            <li className="flex items-center justify-between gap-3">
              <span><b>2. Liquidation</b> — {data.liquidee ? "passée" : declared ? "non passée" : "après la déclaration"}</span>
              {declared && canPost && data.statut !== "paid" && <button onClick={liquidate} disabled={submitting} className={buttonClass("secondary", "sm")}>{data.liquidee ? "Repasser" : "Passer la liquidation"}</button>}
            </li>
            <li className="flex items-center justify-between gap-3">
              <span><b>3. Paiement</b> — {data.statut === "paid" ? "enregistré" : data.paiement ? (remaining > 0 ? `${MONEY(remaining)} à payer` : "rien à payer") : "après la liquidation"}</span>
              {data.liquidee && canPost && remaining > 0 && !data.liquidationPerimee && <button onClick={() => setPayOpen(true)} className={buttonClass("primary", "sm")}>Enregistrer le paiement</button>}
            </li>
          </ol>
          {data.liquidationPerimee && <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-xs text-warn">La comptabilité du mois a changé depuis la liquidation : repassez la liquidation (étape 2) avant d&apos;enregistrer le paiement.</div>}
          {!data.liquidee && !data.creditAnterieur && <p className="text-xs text-ink3">Première liquidation : si un crédit de TVA existait déjà avant (resté au 445), faites passer par le cabinet l&apos;écriture de reprise (445 → 4449), datée au plus tard du dernier jour du mois précédent, pour qu&apos;il soit imputé. Si vous payiez jusqu&apos;ici la TVA au 443, commencez la liquidation au mois qui suit votre dernier paiement ainsi passé.</p>}
          {!canPost && <p className="text-xs text-ink3">Liquidation et paiement : réservés au comptable ou à la direction (droit de passer des écritures).</p>}
        </div>
      )}
      {payOpen && <PayDialog year={year} month={month} amount={remaining} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); reload(); }} />}
    </div>
  );
}

/** Paiement de la TVA due du mois : compte de trésorerie, date, référence de la quittance. */
function PayDialog({ year, month, amount, onClose, onDone }: { year: number; month: number; amount: number; onClose: () => void; onDone: () => void }) {
  const today = new Date();
  const [f, setF] = useState({ accountId: "", date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`, reference: "" });
  const { data: accounts } = useApi<Array<{ _id: string; label: string }>>("/api/treasury-accounts", d => d.data?.items ?? [], []);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await apiSend("POST", "/api/fiscal/tva/paiement", { annee: year, mois: month, treasuryAccountId: f.accountId, date: f.date, reference: f.reference });
    setBusy(false);
    if (!res.ok) { showToast((res.data as { error?: string })?.error || "Paiement refusé.", "error"); return; }
    showToast("Paiement de la TVA enregistré", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Paiement de la TVA — ${MONTHS[month]} ${year}`} size="sm">
      <div className="space-y-3">
        <p className="text-sm">Montant : <b className="font-mono">{MONEY(amount)}</b> (TVA à payer du mois, compte 4441).</p>
        <FormField label="Payé depuis"><select className={selectCls} value={f.accountId} onChange={e => setF(p => ({ ...p, accountId: e.target.value }))}><option value="">— Compte de trésorerie —</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select></FormField>
        <FormField label="Date du paiement"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
        <FormField label="Référence de la quittance"><input className={inputCls} maxLength={60} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={busy || !f.accountId} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
