"use client";
import { useState } from "react";
import { BookUser, Plus, HandCoins, History, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { SALE_METHOD_LABEL } from "@/components/comptoir/SalesTab";

const MONEY = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} FCFA`;
interface Customer { _id: string; name: string; phone?: string; creditLimit: number; balance: number; remaining: number; overLimit: boolean; debtDays: number; active: boolean }
interface Move { _id: string; kind: "sale" | "payment" | "cancel"; amount: number; date: string; label?: string; method?: string }

/** Lien WhatsApp de rappel (numéro nigérien sans indicatif : +227 ajouté). */
function waLink(c: Customer, deskName: string) {
  const digits = (c.phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const num = digits.length === 8 ? `227${digits}` : digits;
  const text = `Bonjour ${c.name}, votre ardoise chez ${deskName} s'élève à ${MONEY(c.balance)}. Merci de passer la régler. Bonne journée !`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

/**
 * Ardoises des habitués : plafond de crédit, dû, reste autorisé, ancienneté
 * de la dette, règlement (espèces, mobile money…), rappel WhatsApp et
 * historique.
 */
export function CreditTab({ deskId, deskName, onChange }: { deskId: string; deskName: string; onChange: () => void }) {
  const { data, reload } = useApi<{ items: Customer[]; totalDue: number }>(`/api/comptoir/customers?deskId=${deskId}`, d => d?.data ?? { items: [], totalDue: 0 }, { items: [], totalDue: 0 });
  const [add, setAdd] = useState(false);
  const [settle, setSettle] = useState<Customer | null>(null);
  const [history, setHistory] = useState<Customer | null>(null);
  const [edit, setEdit] = useState<Customer | null>(null);
  const late = data.items.filter(c => c.balance > 0 && (c.debtDays > 14 || c.overLimit));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink2">Total dû par les clients : <b className="text-ink">{MONEY(data.totalDue)}</b>{late.length ? <span className="text-warn"> · {late.length} ardoise(s) à relancer</span> : null}</p>
          <p className="text-xs text-ink3">Une vente à l&apos;ardoise se fait depuis un ticket, moyen de paiement « Ardoise ». Elle compte dans le chiffre d&apos;affaires, pas dans la caisse, jusqu&apos;au règlement.</p>
        </div>
        <button onClick={() => setAdd(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouveau client</button>
      </div>
      {data.items.length === 0 ? <EmptyState icon={<BookUser size={20} />} title="Aucune ardoise" hint="Ajoutez vos habitués avec un plafond de crédit." /> : (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Client</th><th className="text-right">Dû</th><th className="text-right">Plafond</th><th className="text-right">Reste autorisé</th><th>Depuis</th><th></th></tr></thead>
            <tbody>
              {data.items.map(c => {
                const wa = c.balance > 0 ? waLink(c, deskName) : null;
                return (
                  <tr key={c._id} className={c.active ? "" : "opacity-50"}>
                    <td className="text-ink font-medium">{c.name}{c.phone && <span className="block text-[11px] text-ink3 font-normal">{c.phone}</span>}
                      {c.overLimit && <Pill tone="neg">plafond dépassé</Pill>}{!c.overLimit && c.debtDays > 14 && <Pill tone="warn">à relancer</Pill>}</td>
                    <td className={`text-right font-mono font-semibold ${c.balance > 0 ? "text-neg" : "text-ink2"}`}>{MONEY(c.balance)}</td>
                    <td className="text-right font-mono text-ink2">{MONEY(c.creditLimit)}</td>
                    <td className="text-right font-mono">{MONEY(c.remaining)}</td>
                    <td className="text-ink2">{c.balance > 0 ? `${c.debtDays} j` : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      {c.balance > 0 && <button onClick={() => setSettle(c)} className="px-2 h-8 rounded-md border border-pos/30 text-pos text-xs mr-1 inline-flex items-center gap-1"><HandCoins size={13} /> Régler</button>}
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="p-1.5 inline-flex text-ink3 hover:text-pos" title="Rappel WhatsApp"><MessageCircle size={14} /></a>}
                      <button onClick={() => setHistory(c)} className="p-1.5 text-ink3 hover:text-section" title="Historique"><History size={14} /></button>
                      <button onClick={() => setEdit(c)} className="p-1.5 text-ink3 hover:text-section text-xs" title="Modifier">✎</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
      {(add || edit) && <CustomerDialog deskId={deskId} current={edit} onClose={() => { setAdd(false); setEdit(null); }} onDone={() => { setAdd(false); setEdit(null); reload(); }} />}
      {settle && <SettleDialog c={settle} onClose={() => setSettle(null)} onDone={() => { setSettle(null); reload(); onChange(); }} />}
      {history && <HistoryDialog c={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function CustomerDialog({ deskId, current, onClose, onDone }: { deskId: string; current: Customer | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: current?.name ?? "", phone: current?.phone ?? "", creditLimit: String(current?.creditLimit ?? "10000"), active: current?.active ?? true });
  async function save() {
    const res = current
      ? await apiSend("PATCH", `/api/comptoir/customers/${current._id}`, { ...f, creditLimit: Number(f.creditLimit) || 0 })
      : await apiSend("POST", "/api/comptoir/customers", { deskId, ...f, creditLimit: Number(f.creditLimit) || 0 });
    if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={current ? `Ardoise — ${current.name}` : "Nouveau client à l'ardoise"} size="sm">
      <div className="space-y-4">
        <FormField label="Nom" required><input className={inputCls} maxLength={120} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></FormField>
        <FormField label="Téléphone" hint="Pour le rappel WhatsApp"><input className={inputCls} maxLength={30} value={f.phone} onChange={e => setF(p => ({ ...p, phone: e.target.value }))} /></FormField>
        <FormField label="Plafond de crédit (FCFA)" hint="0 : plus de vente à crédit"><input type="number" min={0} className={inputCls} value={f.creditLimit} onChange={e => setF(p => ({ ...p, creditLimit: e.target.value }))} /></FormField>
        {current && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF(p => ({ ...p, active: e.target.checked }))} className="accent-section" /> Ardoise active</label>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button></div>
      </div>
    </Modal>
  );
}

function SettleDialog({ c, onClose, onDone }: { c: Customer; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(c.balance));
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await apiSend("POST", `/api/comptoir/customers/${c._id}/settle`, { amount: Number(amount), method });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Règlement refusé.", "error"); return; }
    showToast(`Règlement enregistré. Reste dû : ${MONEY(res.data.data.balance)}.`, "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Règlement — ${c.name}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Dû : <b className="text-ink">{MONEY(c.balance)}</b></p>
        <FormField label="Montant réglé"><input type="number" min={1} max={c.balance} className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Moyen"><select className={selectCls} value={method} onChange={e => setMethod(e.target.value)}>{Object.entries(SALE_METHOD_LABEL).filter(([k]) => k !== "credit").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || !(Number(amount) > 0)} onClick={save} className={buttonClass("primary", "md")}>Encaisser</button></div>
      </div>
    </Modal>
  );
}

function HistoryDialog({ c, onClose }: { c: Customer; onClose: () => void }) {
  const { data } = useApi<{ moves: Move[] } | null>(`/api/comptoir/customers/${c._id}`, d => d?.data ?? null, null);
  const KIND: Record<Move["kind"], string> = { sale: "Vente à crédit", payment: "Règlement", cancel: "Annulation" };
  return (
    <Modal open onClose={onClose} title={`Historique — ${c.name}`} size="md">
      {!data ? <p className="text-sm text-ink3">Chargement…</p> : data.moves.length === 0 ? <p className="text-sm text-ink3">Aucun mouvement.</p> : (
        <ul className="divide-y divide-line text-sm">
          {data.moves.map(m => (
            <li key={m._id} className="py-1.5 flex justify-between gap-2">
              <span><span className="text-ink">{KIND[m.kind]}</span> <span className="text-ink3">· {new Date(m.date).toLocaleDateString("fr-FR")}{m.label ? ` · ${m.label}` : ""}{m.method ? ` · ${SALE_METHOD_LABEL[m.method] ?? m.method}` : ""}</span></span>
              <span className={`font-mono ${m.amount > 0 ? "text-neg" : "text-pos"}`}>{m.amount > 0 ? "+" : "−"}{MONEY(Math.abs(m.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
