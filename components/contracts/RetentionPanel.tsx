"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Landmark, Undo2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { formatDate, formatMoney, todayLocal } from "@/lib/format";
import { GUARANTEE_TYPES } from "@/lib/guarantees";

interface Retention {
  rate: number; held: number; released: number; outstanding: number; releasableFrom: string | null; claimable: boolean;
  invoices: Array<{ _id: string; number: string; retentionAmount: number }>;
  releases: Array<{ _id: string; date: string; amount: number; reference?: string }>;
}
interface Settings { retentionRate?: number; receptionProvisoireDate?: string; receptionDefinitiveDate?: string; guaranteeMonths?: number }
interface Guarantee { _id: string; type: keyof typeof GUARANTEE_TYPES; amount: number; status: string; expiryDate?: string; alert?: string | null }

const day = (d?: string) => (d ? d.slice(0, 10) : "");

/**
 * Retenue de garantie du marché (taux, réceptions, reste à récupérer,
 * reversements) et cautions bancaires qui le couvrent.
 */
export function RetentionPanel({ contractId, settings, canEdit, canCollect, onChange }: {
  contractId: string; settings: Settings; canEdit: boolean; canCollect: boolean; onChange: () => void;
}) {
  const [r, setR] = useState<Retention | null>(null);
  const [guarantees, setGuarantees] = useState<Guarantee[]>([]);
  const [editing, setEditing] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // Écrit à l'arrivée des réponses (`.then`), jamais avant : appelable depuis l'effet.
  const load = useCallback(() => Promise.all([apiJson(`/api/contracts/${contractId}/retention`), apiJson(`/api/cautions?contractId=${contractId}`)])
    .then(([a, g]) => { setR(a?.data ?? null); setGuarantees(g?.data?.items ?? []); }), [contractId]);
  useEffect(() => { load(); }, [load]);

  async function cancelRelease(releaseId: string) {
    const reason = await promptDialog({ title: "Annuler ce reversement ?", message: "L'écriture est extournée et la trésorerie corrigée.", label: "Motif", required: true, confirmLabel: "Annuler le reversement" });
    if (!reason) return;
    const res = await apiSend("DELETE", `/api/contracts/${contractId}/retention?releaseId=${releaseId}&reason=${encodeURIComponent(reason)}`);
    if (!res.ok) { showToast(res.data?.error || "Annulation refusée.", "error"); return; }
    showToast("Reversement annulé.", "success"); load(); onChange();
  }

  if (!r) return null;
  const rate = settings.retentionRate ?? 0;
  return (
    <section className="surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><ShieldCheck size={16} /> Retenue de garantie et cautions</h2>
          <p className="text-xs text-ink2">{rate > 0
            ? `${(rate * 100).toLocaleString("fr-FR")} % du TTC de chaque facture de travaux est gardé par le client jusqu'à la réception définitive.`
            : "Aucune retenue sur les factures de ce marché (ou remplacée par une caution)."}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEdit && <button onClick={() => setEditing(true)} className={buttonClass("secondary", "sm")}>Paramétrer</button>}
          {canCollect && r.outstanding > 0 && <button onClick={() => setCollecting(true)} className={buttonClass(r.claimable ? "primary" : "secondary", "sm")}><Landmark size={14} /> Retenue reversée</button>}
        </div>
      </div>

      {(r.held > 0 || rate > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-ink3">Retenu</p><p className="num font-semibold text-ink">{formatMoney(r.held)}</p></div>
          <div><p className="text-xs text-ink3">Reversé</p><p className="num font-semibold text-pos">{formatMoney(r.released)}</p></div>
          <div><p className="text-xs text-ink3">À récupérer</p><p className={`num font-semibold ${r.claimable ? "text-warn" : "text-ink"}`}>{formatMoney(r.outstanding)}</p></div>
          <div><p className="text-xs text-ink3">Réclamable à partir du</p><p className="font-semibold text-ink">{r.releasableFrom ? formatDate(r.releasableFrom) : "réception provisoire à saisir"}</p></div>
        </div>
      )}
      {r.claimable && <p className="text-sm p-3 rounded-lg bg-warn-50 text-warn">Délai de garantie écoulé : demandez la réception définitive et le reversement de {formatMoney(r.outstanding)}.</p>}

      {r.releases.length > 0 && (
        <ul className="text-sm divide-y divide-line">
          {r.releases.map(x => (
            <li key={x._id} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 text-ink2">Reversé le {formatDate(x.date)}{x.reference ? ` · ${x.reference}` : ""}</span>
              <span className="num font-semibold text-ink">{formatMoney(x.amount)}</span>
              {canCollect && <button onClick={() => cancelRelease(x._id)} className="p-1 text-ink3 hover:text-neg" aria-label="Annuler le reversement"><Undo2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Cautions bancaires</h3>
          <Link href={`/cautions?contractId=${contractId}&new=1`} className="text-xs font-semibold text-section hover:underline inline-flex items-center gap-1"><Plus size={12} /> Ajouter</Link>
        </div>
        {guarantees.length === 0 ? <p className="text-xs text-ink3">Aucune caution liée à ce marché (bonne exécution, restitution d&apos;avance, retenue de garantie…).</p> : (
          <ul className="text-sm divide-y divide-line">
            {guarantees.map(g => (
              <li key={g._id} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 text-ink">{GUARANTEE_TYPES[g.type]}</span>
                <span className="text-xs text-ink2">{g.status === "active" ? (g.expiryDate ? `échéance ${formatDate(g.expiryDate)}` : "en cours") : g.status === "released" ? "mainlevée" : "appelée"}</span>
                {g.alert && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${g.alert === "expired" ? "bg-neg-50 text-neg" : "bg-warn-50 text-warn"}`}>{g.alert === "expired" ? "Échue" : "Bientôt échue"}</span>}
                <span className="num font-semibold text-ink">{formatMoney(g.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && <SettingsDialog contractId={contractId} settings={settings} onClose={() => setEditing(false)} onDone={() => { setEditing(false); load(); onChange(); }} />}
      {collecting && <CollectDialog contractId={contractId} outstanding={r.outstanding} onClose={() => setCollecting(false)} onDone={() => { setCollecting(false); load(); onChange(); }} />}
    </section>
  );
}

function SettingsDialog({ contractId, settings, onClose, onDone }: { contractId: string; settings: Settings; onClose: () => void; onDone: () => void }) {
  const [rate, setRate] = useState(String(Math.round((settings.retentionRate ?? 0) * 10000) / 100));
  const [prov, setProv] = useState(day(settings.receptionProvisoireDate));
  const [months, setMonths] = useState(String(settings.guaranteeMonths ?? 12));
  const [def, setDef] = useState(day(settings.receptionDefinitiveDate));
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try {
      const res = await apiSend("PATCH", `/api/contracts/${contractId}`, {
        retentionRate: Math.round(Number(rate.replace(",", ".")) * 100) / 10000 || 0,
        receptionProvisoireDate: prov || null, receptionDefinitiveDate: def || null, guaranteeMonths: Number(months) || 0,
      });
      if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
      showToast("Retenue de garantie paramétrée.", "success"); onDone();
    } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Retenue de garantie" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Le taux s&apos;applique aux prochaines factures de travaux (pas aux acomptes ni aux factures déjà créées). Mettez 0 si une caution de retenue de garantie la remplace.</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Taux (% du TTC, 10 au plus)"><input inputMode="decimal" className={inputCls} value={rate} onChange={e => setRate(e.target.value)} /></FormField>
          <FormField label="Délai de garantie (mois)"><input type="number" min={0} max={60} className={inputCls} value={months} onChange={e => setMonths(e.target.value)} /></FormField>
          <FormField label="Réception provisoire"><input type="date" className={inputCls} value={prov} onChange={e => setProv(e.target.value)} /></FormField>
          <FormField label="Réception définitive" hint="Si elle est déjà prononcée"><input type="date" className={inputCls} value={def} onChange={e => setDef(e.target.value)} /></FormField>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}

function CollectDialog({ contractId, outstanding, onClose, onDone }: { contractId: string; outstanding: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(String(outstanding));
  const [date, setDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiJson("/api/treasury-accounts?limit=100").then(d => {
      const list = (d?.data?.items ?? []).filter((a: { isActive?: boolean }) => a.isActive !== false);
      setAccounts(list); if (list[0]) setAccountId(list[0]._id);
    });
  }, []);
  async function submit() {
    setSaving(true);
    try {
      const res = await apiSend("POST", `/api/contracts/${contractId}/retention`, { amount: Math.round(Number(amount) || 0), date, treasuryAccountId: accountId });
      if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
      showToast("Reversement de la retenue enregistré.", "success"); onDone();
    } finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Retenue de garantie reversée" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Le client vous reverse la retenue : la banque est débitée, la créance de retenue (4117) soldée.</p>
        <FormField label={`Montant (reste ${formatMoney(outstanding)})`}><input type="number" min={1} max={outstanding} className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Reçu le"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></FormField>
        <FormField label="Sur le compte">
          <select className={selectCls} value={accountId} onChange={e => setAccountId(e.target.value)}>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select>
        </FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !accountId} className={buttonClass("primary", "md")}>{saving ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </Modal>
  );
}
