"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { SearchBox } from "@/components/ui/SearchBox";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useMe, meCanDo } from "@/lib/useMe";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
import { todayLocal } from "@/lib/format";
import { PageLoading } from "@/components/ui/PageState";
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
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
  cancelReason?: string;
  treasuryAccountId?: { name?: string; label?: string } | null;
}

export default function PaymentsPage() {
  const me = useMe();
  const canDelete = meCanDo(me, "payments", "delete");
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const LIMIT = 20;

  // Lecture d'une page : renvoie la liste ou le message d'échec, l'état n'est
  // modifié qu'à l'arrivée de la réponse (`apply`).
  const fetchPayments = useCallback((): Promise<{ items: Payment[] | null; total: number; error: string | null }> => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
      ...(search ? { search } : {}),
    });
    return fetch(`/api/payments?${params}`, { credentials: "include" })
      .then(async res => {
        if (!res.ok) {
          // On rend l'échec visible plutôt que d'afficher une page vide qui donne
          // l'impression que « rien ne s'ouvre » : accès refusé, session expirée…
          const d = await res.json().catch(() => ({}));
          return { items: [], total: 0, error: res.status === 403
            ? "Votre profil n'a pas accès aux paiements. Demandez le droit « Paiements » à un administrateur."
            : (d.error || "Impossible de charger les paiements. Réessayez.") };
        }
        const d = await res.json();
        return { items: d.data?.items || [], total: d.data?.pagination?.total || 0, error: null };
      })
      // Coupure réseau : la liste affichée est conservée, seul le message change.
      .catch(() => ({ items: null, total: 0, error: "Connexion impossible au serveur des paiements. Vérifiez votre réseau puis réessayez." }));
  }, [page, search]);

  function apply(r: { items: Payment[] | null; total: number; error: string | null }) {
    setError(r.error);
    if (r.items) { setItems(r.items); setTotal(r.total); }
    setLoading(false);
  }

  useEffect(() => {
    let live = true;
    fetchPayments().then(r => { if (live) apply(r); });
    return () => { live = false; };
  }, [fetchPayments]);

  // Relecture après une action (annulation, confirmation, « Réessayer »).
  function load() {
    setLoading(true);
    setError(null);
    fetchPayments().then(apply);
  }

  // L'encaissement d'un paiement en attente se confirme avec sa date réelle et le compte crédité.

  async function cancelPayment(id: string, pending: boolean, cash = false) {
    let res: { ok: boolean; data: { error?: string } };
    if (pending) {
      if (!(await confirmDialog({ title: "Supprimer ce paiement en attente ?", danger: true, confirmLabel: "Supprimer" }))) return;
      res = await apiSend("DELETE", `/api/payments/${id}`);
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
      // Espèces : le timbre-quittance reste dû si le reçu a été remis au client.
      const keepStamp = cash && await confirmDialog({
        title: "Le reçu a-t-il été remis au client ?",
        message: "Si oui, le timbre-quittance reste dû et n'est pas annulé. S'il s'agit d'une erreur de saisie, il est annulé avec l'encaissement.",
        confirmLabel: "Oui, reçu remis",
        cancelLabel: "Non, erreur de saisie",
      });
      res = await apiSend("POST", `/api/payments/${id}/cancel`, { reason, keepStamp });
    }
    if (res.ok) load();
    else showToast(res.data?.error || "Annulation impossible.", "error");
  }

  if (!mounted) return <PageLoading />;

  const columns: Column<Payment>[] = [
    { 
      key: "date", 
      label: "Date", 
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") 
    },
    { 
      key: "invoiceId", 
      label: "N° Facture", 
      render: (v) => (v && typeof v === "object") ? (v as { number?: string }).number : "—" 
    },
    { 
      key: "clientId", 
      label: "Client", 
      className: "font-medium text-ink",
      // On va chercher le nom dans invoiceId -> clientId -> name
      render: (_, record) => {
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
      render: (v) => `${Number(v).toLocaleString("fr-FR")} FCFA` 
    },
    {
      key: "treasuryAccountId",
      label: "Compte",
      render: (v) => {
        const account = v as Payment["treasuryAccountId"] | undefined;
        return (account?.label || account?.name) ? <span className="text-ink">{account.label || account.name}</span> : <span className="text-ink2 italic text-xs">Non imputé</span>;
      }
    },
    {
      key: "status",
      label: "État",
      render: (v, record) => v === "pending"
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
              {canDelete && <button onClick={() => cancelPayment(record._id, false, record.method === "cash")} className="text-[11px] text-neg hover:underline">Annuler</button>}
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
          <h1 className="page-title">Encaissements</h1>
          <p className="text-sm text-ink2 mt-0.5">
            {total} encaissement{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <SearchBox onSearch={q => { setSearch(q); setPage(1); }} placeholder="Référence, n° de facture, client…" className="w-full sm:w-80" />

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
        onPage={p => { if (p !== page) { setLoading(true); setError(null); } setPage(p); }} 
      />
      {confirming && <ConfirmDialog payment={confirming} onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); load(); }} />}
    </div>
  );
}

function ConfirmDialog({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const today = todayLocal();
  const planned = payment.date ? String(payment.date).slice(0, 10) : today;
  const [date, setDate] = useState(planned > today ? today : planned);
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string }>>([]);
  const [accountId, setAccountId] = useState((payment.treasuryAccountId as { _id?: string } | null)?._id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiJson("/api/treasury-accounts").then(d => {
      const list = d.data?.items || [];
      setAccounts(list);
      if (!accountId && list.length === 1) setAccountId(list[0]._id);
    }).catch(() => {});
  }, [accountId]);
  async function submit() {
    setSaving(true); setError("");
    const res = await apiSend("PATCH", `/api/payments/${payment._id}`, { status: "effective", date, ...(accountId ? { treasuryAccountId: accountId } : {}) });
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Confirmation impossible."); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Confirmer l'encaissement" size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <p className="text-sm text-ink2">{Number(payment.amount).toLocaleString("fr-FR")} FCFA{payment.invoiceId?.number ? ` — facture ${payment.invoiceId.number}` : ""}. La facture, la comptabilité et la trésorerie sont mises à jour à la date indiquée.</p>
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
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !date || !accountId} className="px-5 h-10 rounded-lg bg-pos text-onink text-sm font-semibold disabled:opacity-60">{saving ? "Enregistrement…" : "Confirmer l'encaissement"}</button>
        </div>
      </div>
    </Modal>
  );
}