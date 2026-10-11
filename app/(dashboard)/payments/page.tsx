"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useMe, meCanDo } from "@/lib/useMe";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";

interface Payment {
  _id: string;
  invoiceId: { 
    number: string; 
    clientId?: { name: string } 
  } | null;
  amount: number;
  method: string;
  date: string;
  reference?: string;
  status?: string;
  treasuryAccountId?: { name?: string } | null;
}

export default function PaymentsPage() {
  const me = useMe();
  const canDelete = meCanDo(me, "payments", "delete");
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/payments?${params}`, { credentials: "include" });
      if (!res.ok) {
        // On rend l'échec visible plutôt que d'afficher une page vide qui donne
        // l'impression que « rien ne s'ouvre » : accès refusé, session expirée…
        const d = await res.json().catch(() => ({}));
        setError(res.status === 403
          ? "Votre profil n'a pas accès aux paiements. Demandez le droit « Paiements » à un administrateur."
          : (d.error || "Impossible de charger les paiements. Réessayez."));
        setItems([]); setTotal(0);
        return;
      }
      const d = await res.json();
      setItems(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } catch {
      setError("Connexion impossible au serveur des paiements. Vérifiez votre réseau puis réessayez.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  // L'encaissement d'un paiement en attente se confirme avec sa date réelle et le compte crédité.

  async function cancelPayment(id: string, pending: boolean) {
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    let res: Response;
    if (pending) {
      if (!(await confirmDialog({ title: "Supprimer ce paiement en attente ?", danger: true, confirmLabel: "Supprimer" }))) return;
      res = await fetch(`/api/payments/${id}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": csrfToken } });
    } else {
      const reason = await promptDialog({
        title: "Annuler cet encaissement ?",
        message: "Chèque impayé, erreur… L'écriture sera extournée et la facture rouverte.",
        label: "Motif",
        confirmLabel: "Annuler l'encaissement",
        required: true,
        multiline: true,
      });
      if (!reason) return;
      res = await fetch(`/api/payments/${id}/cancel`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ reason }) });
    }
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); showToast(d.error || "Annulation impossible.", "error"); }
  }

  if (!mounted) return null;

  const columns: Column<Payment>[] = [
    { 
      key: "date", 
      label: "Date", 
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") 
    },
    { 
      key: "invoiceId", 
      label: "N° Facture", 
      render: (v) => (v && typeof v === "object") ? (v as any).number : "—" 
    },
    { 
      key: "clientId", 
      label: "Client", 
      className: "font-medium text-ink",
      // On va chercher le nom dans invoiceId -> clientId -> name
      render: (_, record: any) => {
        const name = record.invoiceId?.clientId?.name;
        return name ? name : <span className="text-ink2">—</span>;
      }
    },
    { 
      key: "method", 
      label: "Méthode", 
      render: (v) => {
        const methodes: Record<string, string> = {
          "cash": "Espèces",
          "bank_transfer": "Virement",
          "cheque": "Chèque",
          "check": "Chèque",
          "mobile_money": "Mobile Money",
          "orange_money": "OM / Moov",
          "card": "Carte bancaire",
          "other": "Autre"
        };
        return methodes[String(v).toLowerCase()] || String(v);
      }
    },
    { 
      key: "amount", 
      label: "Montant", 
      className: "font-mono font-bold text-pos text-right",
      render: (v) => `${Number(v).toLocaleString("fr-FR")} XOF` 
    },
    {
      key: "treasuryAccountId",
      label: "Compte",
      render: (v: any) => (v?.label || v?.name) ? <span className="text-ink">{v.label || v.name}</span> : <span className="text-ink2 italic text-xs">Non imputé</span>
    },
    {
      key: "status",
      label: "État",
      render: (v, record: any) => v === "pending"
        ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-warn-50 text-warn border border-warn/25">En attente</span>
            <button onClick={() => setConfirming(record)}
              className="text-[11px] font-semibold text-pos hover:underline">Marquer encaissé</button>
            {canDelete && <button onClick={() => cancelPayment(record._id, true)} className="text-[11px] text-neg hover:underline">Supprimer</button>}
          </div>
        )
        : v === "cancelled"
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface2 text-ink2 border border-line" title={record.cancelReason}>Annulé</span>
          : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-pos-50 text-pos border border-pos/25">Encaissé</span>
              {canDelete && <button onClick={() => cancelPayment(record._id, false)} className="text-[11px] text-neg hover:underline">Annuler</button>}
            </div>
          )
    },
    {
      key: "reference",
      label: "Réf / N° Chèque",
      render: (v) => v ? String(v) : <span className="text-ink2 italic text-xs">Aucune</span>
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Historique des Paiements</h1>
          <p className="text-sm text-ink2 mt-0.5">
            {total} encaissement{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
          <span>{error}</span>
          <button onClick={load} className="shrink-0 px-3 h-8 rounded-lg border border-neg/40 text-neg text-xs font-semibold hover:bg-neg/10">
            Réessayer
          </button>
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-line overflow-hidden shadow-sm">
        <DataTable
          columns={columns} 
          data={items} 
          loading={loading} 
          keyExtractor={(d) => d._id} 
          emptyMessage="Aucun paiement trouvé dans l'historique"
        />
      </div>

      <Pagination 
        page={page} 
        totalPages={Math.ceil(total / LIMIT)} 
        total={total} 
        limit={LIMIT} 
        onPage={setPage} 
      />
      {confirming && <ConfirmDialog payment={confirming} onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); load(); }} />}
    </div>
  );
}

function ConfirmDialog({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const planned = payment.date ? String(payment.date).slice(0, 10) : today;
  const [date, setDate] = useState(planned > today ? today : planned);
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string }>>([]);
  const [accountId, setAccountId] = useState((payment.treasuryAccountId as { _id?: string } | null)?._id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" }).then(r => r.json()).then(d => {
      const list = d.data?.items || [];
      setAccounts(list);
      if (!accountId && list.length === 1) setAccountId(list[0]._id);
    }).catch(() => {});
  }, [accountId]);
  async function submit() {
    setSaving(true); setError("");
    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const res = await fetch(`/api/payments/${payment._id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ status: "effective", date, ...(accountId ? { treasuryAccountId: accountId } : {}) }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error || "Confirmation impossible."); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Confirmer l'encaissement" size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <p className="text-sm text-ink2">{Number(payment.amount).toLocaleString("fr-FR")} XOF{payment.invoiceId?.number ? ` — facture ${payment.invoiceId.number}` : ""}. La facture, la comptabilité et la trésorerie sont mises à jour à la date indiquée.</p>
        <FormField label="Date réelle de l'encaissement" required>
          <input type="date" className={inputCls} value={date} max={today} onChange={e => setDate(e.target.value)} />
        </FormField>
        <FormField label="Compte crédité" hint="Banque, caisse ou mobile money qui a reçu l'argent.">
          <select className={selectCls} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">— Choisir le compte —</option>
            {accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
          </select>
        </FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm hover:bg-surface2">Annuler</button>
          <button onClick={submit} disabled={saving || !date || !accountId} className="px-5 h-10 rounded-lg bg-pos text-white text-sm font-semibold disabled:opacity-60">{saving ? "Enregistrement…" : "Confirmer l'encaissement"}</button>
        </div>
      </div>
    </Modal>
  );
}