"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, Wallet, Smartphone, Scale, Plus, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { KpiCard } from "@/components/ui/KpiCard";
import { fullXof } from "@/components/ui/charts/geometry";

interface Account {
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
    openingDate: new Date().toISOString().slice(0, 10), bankName: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" })
      .then(r => r.json())
      .then(d => setAccounts(d.data?.items || []))
      .catch(() => setError("Lecture des comptes impossible."))
      .finally(() => setLoading(false));
  }, []);

  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const pending = accounts.reduce((s, a) => s + a.pendingCount, 0);
  const withStatements = accounts.filter(a => a.statementLineCount > 0).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      const res = await fetch("/api/treasury-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const d = await res.json();
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
          <h1 className="text-2xl font-bold text-ink">Trésorerie</h1>
          <p className="text-sm text-ink2">
            Chaque solde est calculé&nbsp;: solde d&apos;ouverture, plus les mouvements enregistrés.
          </p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau compte
        </button>
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
                  <span className="text-sm font-normal text-ink2 ml-1">{a.currency || "XOF"}</span>
                </p>

                <p className="text-[11px] text-ink3 mt-1">
                  Ouverture {a.openingBalance.toLocaleString("fr-FR")} · {a.movementCount} mouvement(s)
                </p>

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
            <FormField label="Solde d'ouverture (XOF)"
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
              className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
              {saving ? "Création…" : "Créer"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
