"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Banknote, Ban, Trash2, Undo2, Edit3 } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";
import { PurchaseForm, type PurchaseFormValue } from "@/components/achats/PurchaseForm";
import { useMe, meCanDo } from "@/lib/useMe";

type Ref = { _id: string; code?: string; name?: string; label?: string; type?: string } | null | undefined;
interface Purchase {
  _id: string; number: string; kind: "invoice" | "cash"; date: string; dueDate?: string; payee?: string; supplierRef?: string; notes?: string;
  supplierId?: Ref; commandeId?: { _id: string; number: string } | null;
  lines: Array<{ description: string; accountCode: string; accountLabel?: string; quantity: number; unitPrice: number; amountHT: number; tvaRate: number; amountTVA: number; projectId?: Ref; activityId?: Ref; costCenter?: string }>;
  totalHT: number; totalTVA: number; totalTTC: number; paidAmount: number; status: string;
  payments: Array<{ _id: string; date: string; amount: number; treasuryAccountId?: Ref; reference?: string; cancelledAt?: string }>;
  cancelReason?: string; validatedAt?: string;
}
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const STATUS: Record<string, string> = { draft: "Brouillon", validated: "À payer", partial: "Payé en partie", paid: "Payé", cancelled: "Annulé" };
const CC: Record<string, string> = { direction: "Direction", admin: "Administration", comm: "Communication", prosp: "Prospection", dev: "Développement", prod: "Production & Cartes", spot: "The Spot", secu: "Sécurité", compta: "Comptabilité" };
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Action impossible");
  return d.data;
}
const idOf = (v: Ref | string | undefined) => (v && typeof v === "object" ? v._id : v ? String(v) : undefined);

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canUpdate = meCanDo(me, "purchases", "update");
  const canDelete = meCanDo(me, "purchases", "delete");
  const [p, setP] = useState<Purchase | null>(null);
  const [error, setError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch(`/api/achats/${id}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    setP(d?.data ?? null);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  async function act(fn: () => Promise<unknown>) { setError(""); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Action impossible"); } }

  if (!p) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  const rest = p.totalTTC - p.paidAmount;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/depenses" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Achats & dépenses</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-ink">{p.kind === "cash" ? "Dépense" : "Facture fournisseur"} {p.number}</h1>
            <StatusBadge status={p.status} label={STATUS[p.status]} />
          </div>
          <p className="text-sm text-ink2">{p.supplierId?.name ?? p.payee}{p.supplierRef ? ` · réf. ${p.supplierRef}` : ""}{p.commandeId ? <> · <Link href={`/commandes/${p.commandeId._id}`} className="text-section hover:underline">BC {p.commandeId.number}</Link></> : null}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canUpdate && p.status === "draft" && <button onClick={() => setEditOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm hover:bg-surface2"><Edit3 size={16} /> Modifier</button>}
          {canUpdate && p.status === "draft" && <button onClick={() => act(() => send(`/api/achats/${id}/validate`, "POST"))} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold"><CheckCircle2 size={16} /> Valider</button>}
          {canUpdate && ["validated", "partial"].includes(p.status) && <button onClick={() => setPayOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-pos text-white text-sm font-semibold"><Banknote size={16} /> Enregistrer un règlement</button>}
          {canDelete && p.status === "draft" && <button onClick={async () => { if (!confirm("Supprimer ce brouillon ?")) return; try { await send(`/api/achats/${id}`, "DELETE"); router.push("/depenses"); } catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); } }} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50"><Trash2 size={16} /> Supprimer</button>}
          {canDelete && p.status === "validated" && <button onClick={() => { const reason = prompt("Motif de l'annulation (l'écriture sera extournée) :"); if (reason) act(() => send(`/api/achats/${id}/cancel`, "POST", { reason })); }} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50"><Ban size={16} /> Annuler</button>}
        </div>
      </div>
      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {p.status === "cancelled" && p.cancelReason && <p className="px-4 py-3 bg-surface2 rounded-xl text-sm text-ink2">Annulé : {p.cancelReason}</p>}

      <div className="grid sm:grid-cols-4 gap-4">
        {[["Date", new Date(p.date).toLocaleDateString("fr-FR")], ["Échéance", p.dueDate ? new Date(p.dueDate).toLocaleDateString("fr-FR") : "—"], ["Total TTC", `${fmt(p.totalTTC)} XOF`], ["Reste à payer", p.status === "cancelled" ? "—" : `${fmt(rest)} XOF`]].map(([k, v]) => (
          <div key={k} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className="text-lg font-bold mt-1 text-ink">{v}</p></div>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th>Libellé</th><th>Compte</th><th>Imputation</th><th className="text-right">HT</th><th className="text-right">TVA</th></tr></thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td>{l.description}<span className="block text-[11px] text-ink3">{l.quantity} × {fmt(l.unitPrice)}</span></td>
                <td className="text-xs"><span className="font-mono">{l.accountCode}</span><span className="block text-ink3">{l.accountLabel}</span></td>
                <td className="text-xs">{[l.projectId && `${l.projectId.code ?? ""} ${l.projectId.name ?? ""}`.trim(), l.activityId?.name, l.costCenter && CC[l.costCenter]].filter(Boolean).join(" · ") || <span className="text-ink3">Frais généraux</span>}</td>
                <td className="text-right font-mono">{fmt(l.amountHT)}</td>
                <td className="text-right font-mono">{fmt(l.amountTVA)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold"><td colSpan={3} className="text-right">Totaux</td><td className="text-right font-mono">{fmt(p.totalHT)}</td><td className="text-right font-mono">{fmt(p.totalTVA)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-line p-4 space-y-2">
        <h2 className="font-semibold text-ink">Règlements</h2>
        {p.payments.length === 0 ? <p className="text-sm text-ink3">Aucun règlement.</p> : (
          <ul className="divide-y divide-line">
            {p.payments.map(x => (
              <li key={x._id} className={`py-2 flex items-center justify-between gap-2 text-sm ${x.cancelledAt ? "opacity-50 line-through" : ""}`}>
                <span>{new Date(x.date).toLocaleDateString("fr-FR")} · {x.treasuryAccountId?.label ?? "compte"}{x.reference ? ` · ${x.reference}` : ""}</span>
                <span className="flex items-center gap-2">
                  <b className="font-mono">{fmt(x.amount)} XOF</b>
                  {canDelete && !x.cancelledAt && <button title="Annuler ce règlement" onClick={() => confirm("Annuler ce règlement ? L'écriture sera extournée et la trésorerie recréditée.") && act(() => send(`/api/achats/${id}/payments/${x._id}`, "DELETE"))} className="p-1 text-ink3 hover:text-neg"><Undo2 size={14} /></button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.notes && <p className="text-sm text-ink2 whitespace-pre-wrap">{p.notes}</p>}
      <AttachmentPanel host="purchases" hostId={p._id} title="Justificatifs (facture, reçu)" defaultCategory="facture" readOnly={!canUpdate} />

      {payOpen && <PayDialog id={p._id} rest={rest} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); load(); }} />}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier ${p.number}`} size="xl">
        <PurchaseForm
          initial={{
            kind: p.kind, supplierId: idOf(p.supplierId) ?? "", payee: p.payee ?? "", supplierRef: p.supplierRef ?? "",
            date: p.date.slice(0, 10), dueDate: p.dueDate?.slice(0, 10) ?? "", notes: p.notes ?? "", pay: false,
            lines: p.lines.map(l => ({ description: l.description, accountCode: l.accountCode, quantity: l.quantity, unitPrice: l.unitPrice, tvaRate: l.tvaRate, projectId: idOf(l.projectId), activityId: idOf(l.activityId), costCenter: l.costCenter })),
          }}
          onSubmit={async (v: PurchaseFormValue, validate: boolean) => {
            await send(`/api/achats/${id}`, "PATCH", { kind: v.kind, supplierId: v.supplierId || null, payee: v.payee, supplierRef: v.supplierRef, date: v.date, dueDate: v.dueDate || null, notes: v.notes, lines: v.lines });
            if (validate) await send(`/api/achats/${id}/validate`, "POST");
            setEditOpen(false); load();
          }}
        />
      </Modal>
    </div>
  );
}

function PayDialog({ id, rest, onClose, onDone }: { id: string; rest: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string; type: string; balance?: number }>>([]);
  const [f, setF] = useState({ amount: rest, date: new Date().toISOString().slice(0, 10), treasuryAccountId: "", reference: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/treasury-accounts", { credentials: "include" }).then(r => r.json()).then(d => {
      const list = d.data?.items ?? []; setAccounts(list);
      if (list.length === 1) setF(p => ({ ...p, treasuryAccountId: list[0]._id }));
    }).catch(() => {});
  }, []);
  async function submit() {
    setSaving(true); setError("");
    try { await send(`/api/achats/${id}/pay`, "POST", f); onDone(); } catch (e) { setError(e instanceof Error ? e.message : "Règlement impossible"); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Enregistrer un règlement">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant (XOF)" hint={`Reste : ${fmt(rest)}`}><input type="number" min={1} max={rest} className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: Number(e.target.value) }))} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></FormField>
        </div>
        <FormField label="Compte qui paie" required>
          <select className={selectCls} value={f.treasuryAccountId} onChange={e => setF(p => ({ ...p, treasuryAccountId: e.target.value }))}>
            <option value="">— Choisir —</option>
            {accounts.map(a => <option key={a._id} value={a._id}>{a.label}{a.balance !== undefined ? ` — solde ${fmt(a.balance)}` : ""}</option>)}
          </select>
        </FormField>
        <FormField label="Référence (chèque, virement…)"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></FormField>
        <button onClick={submit} disabled={saving} className="w-full h-10 rounded-lg bg-pos text-white text-sm font-semibold disabled:opacity-60">{saving ? "Enregistrement…" : "Enregistrer le règlement"}</button>
      </div>
    </Modal>
  );
}
