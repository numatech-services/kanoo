"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, Wallet, Smartphone, Scale, Plus, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { KpiCard } from "@/components/ui/KpiCard";
import { fullXof } from "@/components/ui/charts/geometry";
import { EditAccountDialog, TransferDialog, ManualMovementDialog, MovementsDialog, type TreasuryAccountLite } from "@/components/treasury/TreasuryDialogs";
import { useMe, meCanDo } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatMoney, todayLocal } from "@/lib/format";
interface Account {
  ledgerCode?: string;
  _id: string;
  type: string;
  label: string;
  /** Solde calculé côté serveur : ouverture + mouvements. */
  balance: number;
  openingBalance: number;
  movementCount: number;
  pendingCount: number;
  statementLineCount: number;
  currency: string;
  /** Solde dans la devise du compte (suivi en contre-valeur FCFA). */
  foreignBalance?: number | null;
  isActive: boolean;
}

const TYPE_META: Record<string, { label: string; Icon: typeof Landmark }> = {
  bank: { label: "Banque", Icon: Landmark },
  cash: { label: "Caisse", Icon: Wallet },
  mobile_money: { label: "Mobile Money", Icon: Smartphone },
};

export default function TreasuryPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    label: "", type: "bank", openingBalance: 0,
    openingDate: todayLocal(), bankName: "",
  });
  const [saving, setSaving] = useState(false);
  const me = useMe();
  const canEdit = meCanDo(me, "treasuryAccounts", "update");

  // Compte ancien : un compte comptable dédié, avec reclassement de son solde
  // depuis le compte général (521000 / 571000).
  async function dedicate(a: Account) {
    const ok = await confirmDialog({
      title: `Attribuer un compte comptable dédié à « ${a.label} » ?`,
      message: "Ses prochaines opérations seront écrites sur son propre compte, et son solde comptable actuel y sera reclassé par une écriture d'OD. Le grand livre suivra alors ce compte séparément.",
      confirmLabel: "Attribuer",
    });
    if (!ok) return;
    try {
      const r = await api.patch<{ ledgerCode: string; reclassed: number }>(`/api/treasury-accounts/${a._id}`, { assignLedgerCode: true });
      showToast(`Compte ${r.ledgerCode} attribué${r.reclassed ? `, ${formatMoney(Math.abs(r.reclassed))} reclassés` : ""}.`, "success");
      reload();
    } catch (e) { showToast(apiErrorMessage(e, "Attribution impossible."), "error"); }
  }
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [listing, setListing] = useState<Account | null>(null);
  const [allMoves, setAllMoves] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [manual, setManual] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion(v => v + 1);

  useEffect(() => {
    apiJson(`/api/treasury-accounts?all=${showInactive}`)
      .then(d => setAccounts(d.data?.items || []))
      .catch(() => setError("Lecture des comptes impossible."))
      .finally(() => setLoading(false));
  }, [showInactive, version]);
  const active = accounts.filter(a => a.isActive !== false);

  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const pending = accounts.reduce((s, a) => s + a.pendingCount, 0);
  const withStatements = accounts.filter(a => a.statementLineCount > 0).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend("POST", "/api/treasury-accounts", form);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Création refusée");
      setAccounts(a => [...a, {
        ...d.data, balance: d.data.openingBalance ?? 0,
        movementCount: 0, pendingCount: 0, statementLineCount: 0,
      }]);
      setModalOpen(false);
      setForm(f => ({ ...f, label: "", openingBalance: 0, bankName: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Trésorerie</h1>
          <p className="text-sm text-ink2">
            Chaque solde est calculé&nbsp;: solde d&apos;ouverture, plus les mouvements enregistrés.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" className="accent-section" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Comptes désactivés</label>
          {accounts.length > 0 && <button onClick={() => setAllMoves(true)} className={buttonClass("secondary", "md")}>Recettes et dépenses</button>}
          {canEdit && active.length > 1 && <button onClick={() => setTransfer(true)} className={buttonClass("secondary", "md")}>Virement interne</button>}
          {canEdit && active.length > 0 && <button onClick={() => setManual(true)} className={buttonClass("secondary", "md")}>Opération</button>}
          <button onClick={() => setModalOpen(true)}
            className={buttonClass("primary", "md")}>
            <Plus size={16} /> Nouveau compte
          </button>
        </div>
      </div>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Solde consolidé" value={total} format={fullXof}
          tone={total >= 0 ? "section" : "neg"}
          hint={`${accounts.length} compte(s) actif(s)`} />
        <KpiCard label="Mouvements à rapprocher" value={pending}
          tone={pending === 0 ? "pos" : "warn"}
          hint={pending === 0 ? "Rien en attente" : "Enregistrés, pas encore vus au relevé"} />
        <KpiCard label="Comptes avec relevé" value={`${withStatements} / ${accounts.length}`}
          tone="info"
          hint="Sans relevé importé, le solde n'est pas confronté à la banque" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <div key={i} className="h-40 surface-card animate-pulse" />)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="surface-card p-12 text-center">
          <p className="text-ink2">Aucun compte de trésorerie.</p>
          <p className="text-sm text-ink3 mt-1">
            Créez-en un avec son solde à une date connue&nbsp;: c&apos;est le point de départ
            à partir duquel tout le reste se calcule.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map(a => {
            const meta = TYPE_META[a.type] ?? { label: a.type, Icon: Wallet };
            const Icon = meta.Icon;
            return (
              <div key={a._id} className="surface-card p-5 lift flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <span className="w-9 h-9 rounded-lg bg-section-soft text-section grid place-items-center">
                    <Icon size={17} />
                  </span>
                  <span className="text-[11px] text-ink2 bg-surface2 px-2 py-0.5 rounded-full">
                    {meta.label}
                  </span>
                </div>

                <p className="font-semibold text-ink">{a.label}</p>
                <p className={`text-2xl font-bold mt-1 num ${a.balance >= 0 ? "text-pos" : "text-neg"}`}>
                  {a.balance.toLocaleString("fr-FR")}
                  <span className="text-sm font-normal text-ink2 ml-1">FCFA</span>
                </p>
                {a.currency && a.currency !== "XOF" && (
                  <p className="text-xs text-ink2">{a.foreignBalance != null ? `≈ ${a.foreignBalance.toLocaleString("fr-FR")} ${a.currency}` : `Compte en ${a.currency} : cours à renseigner`} · suivi en contre-valeur FCFA</p>
                )}

                <p className="text-[11px] text-ink3 mt-1">
                  Ouverture {a.openingBalance.toLocaleString("fr-FR")} · {a.movementCount} mouvement(s){a.isActive === false ? " · désactivé" : ""}
                </p>
                <p className="text-[11px] text-ink3 mt-0.5">
                  {a.ledgerCode
                    ? <>Compte comptable <span className="num">{a.ledgerCode}</span></>
                    : <>Compte comptable général (partagé){canEdit && <> · <button onClick={() => dedicate(a)} className="text-section hover:underline">Attribuer un compte dédié</button></>}</>}
                </p>
                <div className="mt-2 flex gap-3 text-xs">
                  <button onClick={() => setListing(a)} className="text-section hover:underline">Mouvements</button>
                  {canEdit && <button onClick={() => setEditing(a)} className="text-ink2 hover:underline">Modifier</button>}
                </div>

                <div className="mt-4 pt-3 border-t border-line flex items-center justify-between">
                  {a.pendingCount > 0 ? (
                    <span className="text-xs font-medium text-warn">
                      {a.pendingCount} à rapprocher
                    </span>
                  ) : a.statementLineCount > 0 ? (
                    <span className="text-xs font-medium text-pos">Rapproché</span>
                  ) : (
                    <span className="text-xs text-ink3">Aucun relevé importé</span>
                  )}
                  <Link href={`/treasury/${a._id}/rapprochement`}
                    className="text-xs font-medium text-section hover:underline inline-flex items-center gap-1">
                    <Scale size={13} /> Rapprocher <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <EditAccountDialog account={editing as unknown as TreasuryAccountLite} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {allMoves && <MovementsDialog onClose={() => setAllMoves(false)} />}
      {listing && <MovementsDialog account={listing as unknown as TreasuryAccountLite} onClose={() => setListing(null)} />}
      {transfer && <TransferDialog accounts={active as unknown as TreasuryAccountLite[]} onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); reload(); }} />}
      {manual && <ManualMovementDialog accounts={active as unknown as TreasuryAccountLite[]} onClose={() => setManual(false)} onDone={() => { setManual(false); reload(); }} />}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau compte de trésorerie">
        <form onSubmit={handleCreate} className="space-y-4">
          <FormField label="Libellé" required>
            <input className={inputCls} value={form.label} required
              onChange={e => setForm(p => ({ ...p, label: e.target.value }))} />
          </FormField>

          <FormField label="Type">
            <select className={selectCls} value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
              <option value="bank">Banque</option>
              <option value="cash">Caisse</option>
              <option value="mobile_money">Mobile Money</option>
            </select>
          </FormField>

          {form.type === "bank" && (
            <FormField label="Banque">
              <input className={inputCls} value={form.bankName}
                onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
            </FormField>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="Solde d'ouverture (FCFA)"
              hint="Le solde réel à la date ci-contre.">
              <input type="number" className={inputCls} value={form.openingBalance}
                onChange={e => setForm(p => ({ ...p, openingBalance: Number(e.target.value) }))} />
            </FormField>
            <FormField label="À la date du" required>
              <input type="date" className={inputCls} value={form.openingDate} required
                onChange={e => setForm(p => ({ ...p, openingDate: e.target.value }))} />
            </FormField>
          </div>

          <p className="text-xs text-ink2">
            Ce solde n&apos;est pas modifié ensuite&nbsp;: le solde affiché se recalcule à
            partir des règlements et des relevés. Le corriger après coup se fait en
            reprenant cette date d&apos;ouverture, pas en écrasant un total.
          </p>

          <div className="flex justify-end gap-3 pt-2 border-t border-line">
            <button type="button" onClick={() => setModalOpen(false)}
              className={buttonClass("secondary", "md")}>
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className={buttonClass("primary", "md")}>
              {saving ? "Création…" : "Créer"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
