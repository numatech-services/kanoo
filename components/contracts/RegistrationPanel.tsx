"use client";
import { useState } from "react";
import { Stamp, Landmark, Undo2, FileCheck2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { promptDialog, confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";

interface Estimate { buyerType: string; kind: string; duty: number; stamp: number; total: number; article: string; explanation: string; dueDate: string | null }
interface Registration { assessed: number; paid: number; duty: number; stamp: number; receptionStamp: number; dueDate?: string; assessedAt?: string; number?: string; date?: string; payments?: Array<{ date: string; amount: number }> }
interface Data { estimate: Estimate; registration: Registration | null; buyerTypes: Record<string, { label: string; public: boolean }>; instruments: Record<string, string> }
interface Settings { buyerType?: string; instrument?: string; approvalDate?: string; pages?: number; isSubcontract?: boolean; receptionDefinitiveDate?: string; status?: string }

const day = (d?: string | null) => (d ? d.slice(0, 10) : "");

/**
 * Droits d'enregistrement et timbres du marché (CGI art. 470, 471, 481, 548,
 * 584) : nature de l'acheteur et de l'acte, date d'approbation (le délai d'un
 * mois en part), estimation, constat (charge du marché) et paiement.
 */
export function RegistrationPanel({ contractId, settings, canEdit, onChange }: {
  contractId: string; settings: Settings; canEdit: boolean; onChange: () => void;
}) {
  const { data, reload } = useApi<Data | null>(`/api/contracts/${contractId}/registration`, d => d?.data ?? null, null, { quiet: true });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    const res = await apiSend("POST", `/api/contracts/${contractId}/registration`, body);
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Opération refusée.", "error"); return false; }
    showToast(ok, "success"); reload(); onChange();
    return true;
  }

  if (!data) return null;
  const e = data.estimate, r = data.registration;
  const remaining = r ? Math.max(0, (r.assessed ?? 0) - (r.paid ?? 0)) : 0;
  const due = r?.dueDate ?? e.dueDate;
  const late = due && remaining + (r ? 0 : e.total) > 0 && new Date(due) < new Date();
  const isPublic = data.buyerTypes[e.buyerType]?.public;

  return (
    <section className="surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><Stamp size={16} /> Enregistrement et timbres</h2>
          <p className="text-xs text-ink2">{data.buyerTypes[e.buyerType]?.label ?? "Acheteur à préciser"} · {data.instruments[settings.instrument ?? "market"] ?? "Marché"} · {e.article}</p>
        </div>
        {canEdit && !r?.assessedAt && <button onClick={() => setEditing(true)} className={buttonClass("secondary", "sm")}>Préciser l&apos;acheteur et l&apos;acte</button>}
      </div>

      <p className="text-sm text-ink">{e.explanation}</p>

      <div className="grid sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-ink2">Droit d&apos;enregistrement</p><p className="font-mono font-semibold">{formatMoney(r?.assessedAt ? r.duty : e.duty)}</p></div>
        <div><p className="text-xs text-ink2">Timbres</p><p className="font-mono font-semibold">{formatMoney(r?.assessedAt ? (r.stamp ?? 0) + (r.receptionStamp ?? 0) : e.stamp)}</p></div>
        <div><p className="text-xs text-ink2">{r?.assessedAt ? "Reste à payer" : "Total estimé"}</p><p className={`font-mono font-bold ${late ? "text-neg" : "text-ink"}`}>{formatMoney(r?.assessedAt ? remaining : e.total)}</p></div>
        <div><p className="text-xs text-ink2">Échéance (approbation + 1 mois)</p><p className={`font-semibold ${late ? "text-neg" : "text-ink"}`}>{due ? formatDate(due) : "Date d'approbation à saisir"}</p></div>
      </div>

      {r?.assessedAt && remaining === 0 && (
        <p className="text-sm text-pos inline-flex items-center gap-2"><FileCheck2 size={15} /> Droits payés{r.number ? ` — quittance n° ${r.number}` : ""}{r.date ? ` du ${formatDate(r.date)}` : ""}.</p>
      )}

      {canEdit && (
        <div className="flex gap-2 flex-wrap">
          {!r?.assessedAt && (
            <button disabled={busy || !e.total} onClick={async () => {
              if (await confirmDialog({ title: "Constater les droits du marché ?", message: `${formatMoney(e.total)} passés en charge du marché (646) et en dette envers l'État (447300).`, confirmLabel: "Constater" })) act({ action: "assess" }, "Droits constatés : ils entrent dans la marge du marché.");
            }} className={buttonClass("primary", "sm")}><Stamp size={14} /> Constater les droits</button>
          )}
          {r?.assessedAt && remaining > 0 && <button disabled={busy} onClick={() => setPaying(true)} className={buttonClass("primary", "sm")}><Landmark size={14} /> Payer à la recette des impôts</button>}
          {r?.assessedAt && isPublic && settings.receptionDefinitiveDate && !(r.receptionStamp > 0) && (
            <button disabled={busy} onClick={() => act({ action: "reception_stamp" }, "Timbre du PV de réception constaté.")} className={buttonClass("secondary", "sm")}>Timbre du PV de réception (25 000)</button>
          )}
          {r?.assessedAt && (r.paid ?? 0) === 0 && (
            <button disabled={busy} onClick={async () => {
              const reason = await promptDialog({ title: "Annuler le constat ?", message: "Les écritures sont extournées. À refaire avec la bonne nature d'acheteur ou le bon montant.", label: "Motif", required: true, confirmLabel: "Annuler le constat" });
              if (reason) act({ action: "cancel", reason }, "Constat annulé.");
            }} className={buttonClass("ghost", "sm")}><Undo2 size={14} /> Annuler le constat</button>
          )}
        </div>
      )}

      {editing && <SettingsDialog contractId={contractId} settings={settings} data={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChange(); }} />}
      {paying && <PayDialog remaining={remaining} onClose={() => setPaying(false)} onPay={async body => { if (await act({ action: "pay", ...body }, "Paiement des droits enregistré.")) setPaying(false); }} />}
    </section>
  );
}

function SettingsDialog({ contractId, settings, data, onClose, onSaved }: { contractId: string; settings: Settings; data: Data; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    buyerType: settings.buyerType ?? data.estimate.buyerType, instrument: settings.instrument ?? "market",
    approvalDate: day(settings.approvalDate), pages: String(settings.pages ?? ""), isSubcontract: !!settings.isSubcontract,
  });
  const [error, setError] = useState("");
  async function save() {
    const res = await apiSend("PATCH", `/api/contracts/${contractId}`, {
      buyerType: f.buyerType, instrument: f.instrument, approvalDate: f.approvalDate || null,
      pages: f.pages ? Number(f.pages) : null, isSubcontract: f.isSubcontract,
    });
    if (!res.ok) { setError(res.data?.error || "Enregistrement impossible."); return; }
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Acheteur, acte et approbation">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Nature de l'acheteur" hint="Commande publique : 5 % HT. Entreprise, particulier ou ONG : 2 % HT.">
          <select className={selectCls} value={f.buyerType} onChange={e => setF(p => ({ ...p, buyerType: e.target.value }))}>
            {Object.entries(data.buyerTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </FormField>
        <FormField label="Nature de l'acte">
          <select className={selectCls} value={f.instrument} onChange={e => setF(p => ({ ...p, instrument: e.target.value }))}>
            {Object.entries(data.instruments).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date d'approbation" hint="Le délai d'enregistrement d'un mois en part"><input type="date" className={inputCls} value={f.approvalDate} onChange={e => setF(p => ({ ...p, approvalDate: e.target.value }))} /></FormField>
          <FormField label="Pages de l'acte" hint="Bon de commande < 1 M : 1 500 FCFA par page"><input type="number" min={1} className={inputCls} value={f.pages} onChange={e => setF(p => ({ ...p, pages: e.target.value }))} /></FormField>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={f.isSubcontract} onChange={e => setF(p => ({ ...p, isSubcontract: e.target.checked }))} className="accent-section" />
          Contrat de sous-traitance prévu au marché principal (droit fixe de 50 000 FCFA)
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}

function PayDialog({ remaining, onClose, onPay }: { remaining: number; onClose: () => void; onPay: (b: Record<string, unknown>) => void }) {
  const { data: accounts } = useApi<Array<{ _id: string; label: string }>>("/api/treasury-accounts", d => d?.data?.items ?? [], [], { quiet: true });
  const [f, setF] = useState({ treasuryAccountId: "", date: todayLocal(), number: "", amount: String(remaining) });
  return (
    <Modal open onClose={onClose} title="Payer les droits d'enregistrement">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Reste à payer : <b className="text-ink">{formatMoney(remaining)}</b>. Le décaissement et l&apos;écriture (447300 / banque) sont enregistrés.</p>
        <FormField label="Compte qui paie" required>
          <select className={selectCls} value={f.treasuryAccountId} onChange={e => setF(p => ({ ...p, treasuryAccountId: e.target.value }))}>
            <option value="">— Choisir —</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date du paiement"><input type="date" className={inputCls} value={f.date} max={todayLocal()} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
          <FormField label="Montant"><input type="number" min={1} className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} /></FormField>
        </div>
        <FormField label="N° de quittance (enregistrement)" hint="Imprimé ensuite sur les factures du marché"><input className={inputCls} value={f.number} onChange={e => setF(p => ({ ...p, number: e.target.value }))} /></FormField>
        <button disabled={!f.treasuryAccountId} onClick={() => onPay({ ...f, amount: Number(f.amount) })} className={buttonClass("primary", "md", "w-full")}>Enregistrer le paiement</button>
      </div>
    </Modal>
  );
}
