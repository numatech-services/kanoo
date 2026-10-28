"use client";
import { useMemo, useState } from "react";
import { Receipt, Plus, Trash2, Printer, Ban, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useMe, meCanDo } from "@/lib/useMe";

const MONEY = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
export const SALE_METHOD_LABEL: Record<string, string> = {
  cash: "Espèces", orange_money: "OM / Moov / Airtel", card: "Carte", bank_transfer: "Virement", check: "Chèque", other: "Autre",
};
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const h = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Item { _id: string; name: string; unit: string; quantity: number; salePrice?: number; productId?: { _id: string } | null }
interface SaleLine { label: string; quantity: number; unitPriceTTC: number; discount: number; totalTTC: number; totalHT: number; tvaRate: number; costTotal?: number; marginHT?: number | null }
interface Sale {
  _id: string; number: string; date: string; status: "paid" | "cancelled"; lines: SaleLine[];
  totalTTC: number; totalHT: number; totalTVA: number; marginHT?: number; costTotal?: number;
  payments: Array<{ method: string; amount: number }>; changeGiven?: number; customerName?: string; cancelReason?: string;
  cashierId?: { firstName?: string; lastName?: string } | null;
}

/** Reçu de caisse imprimable (80 mm). Tout texte saisi est échappé. */
export function printReceipt(sale: Sale, deskName: string) {
  const rows = sale.lines.map(l => `<tr><td>${h(l.label)}<br><small>${l.quantity} × ${h(MONEY(l.unitPriceTTC))}${l.discount ? ` − ${l.discount} %` : ""}</small></td><td class="r">${h(MONEY(l.totalTTC))}</td></tr>`).join("");
  const pays = sale.payments.map(p => `<div class="f"><span>${h(SALE_METHOD_LABEL[p.method] || p.method)}</span><span>${h(MONEY(p.amount))}</span></div>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${h(sale.number)}</title>
    <style>body{font-family:system-ui,Arial,sans-serif;width:72mm;margin:0 auto;padding:8px;color:#111;font-size:12px}
    h1{font-size:14px;text-align:center;margin:4px 0}p{margin:2px 0;text-align:center}table{width:100%;border-collapse:collapse;margin:8px 0}
    td{padding:3px 0;border-bottom:1px dashed #bbb;vertical-align:top}.r{text-align:right;white-space:nowrap}.f{display:flex;justify-content:space-between;padding:2px 0}
    .t{font-weight:700;font-size:14px;border-top:1px solid #111;margin-top:4px;padding-top:4px}</style></head>
    <body><h1>${h(deskName)}</h1><p>Ticket ${h(sale.number)}</p><p>${h(new Date(sale.date).toLocaleString("fr-FR"))}</p>
    ${sale.customerName ? `<p>Client : ${h(sale.customerName)}</p>` : ""}
    <table>${rows}</table>
    <div class="f"><span>Total HT</span><span>${h(MONEY(sale.totalHT))}</span></div>
    <div class="f"><span>TVA</span><span>${h(MONEY(sale.totalTVA))}</span></div>
    <div class="f t"><span>Total TTC</span><span>${h(MONEY(sale.totalTTC))}</span></div>
    ${pays}${sale.changeGiven ? `<div class="f"><span>Monnaie rendue</span><span>${h(MONEY(sale.changeGiven))}</span></div>` : ""}
    ${sale.status === "cancelled" ? `<p><b>TICKET ANNULÉ</b></p>` : ""}<p style="margin-top:10px">Merci de votre visite</p></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
}

/** Tickets de caisse du comptoir : saisie multi-articles, liste du jour, reçus, annulations. */
export function SalesTab({ deskId, deskName, onChange }: { deskId: string; deskName: string; onChange: () => void }) {
  const canCancel = meCanDo(useMe(), "comptoir", "delete");
  const [from, setFrom] = useState(localDay());
  const [to, setTo] = useState(localDay());
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<{ items: Sale[]; showCosts: boolean }>(
    `/api/comptoir/sales?deskId=${deskId}&from=${from}&to=${to}`, d => d?.data ?? { items: [], showCosts: false }, { items: [], showCosts: false });
  const sales = data.items;
  const paid = sales.filter(s => s.status === "paid");
  const total = paid.reduce((t, s) => t + s.totalTTC, 0);
  const margin = paid.reduce((t, s) => t + (s.marginHT ?? 0), 0);
  // Taux de marque sur les seules lignes valorisées (même règle que la page Marges).
  const ht = paid.reduce((t, s) => t + s.lines.reduce((u, l) => u + (l.marginHT !== null && l.marginHT !== undefined ? l.totalHT : 0), 0), 0);

  async function cancel(s: Sale) {
    const reason = await promptDialog({ title: `Annuler le ticket ${s.number} ?`, message: "Les articles reviennent en stock, l'encaissement et l'écriture sont annulés.", label: "Motif", required: true, confirmLabel: "Annuler le ticket" });
    if (!reason) return;
    const res = await apiSend("POST", `/api/comptoir/sales/${s._id}/cancel`, { reason });
    if (!res.ok) { showToast(res.data?.error || "Annulation refusée.", "error"); return; }
    showToast("Ticket annulé.", "success"); reload(); onChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2 items-end">
          <FormField label="Du"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></FormField>
          <FormField label="Au"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></FormField>
        </div>
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouveau ticket</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Tickets</p><p className="text-xl font-bold text-ink">{paid.length}</p></div>
        <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Ventes TTC</p><p className="text-xl font-bold text-section">{MONEY(total)}</p></div>
        {data.showCosts && <>
          <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Marge brute HT</p><p className={`text-xl font-bold ${margin < 0 ? "text-neg" : "text-pos"}`}>{MONEY(margin)}</p></div>
          <div className="surface-card p-4"><p className="text-xs text-ink2 uppercase font-semibold">Taux de marque</p><p className="text-xl font-bold text-ink">{ht > 0 ? `${Math.round((margin / ht) * 1000) / 10} %` : "—"}</p></div>
        </>}
      </div>

      {sales.length === 0 ? (
        <EmptyState icon={<Receipt size={20} />} title="Aucun ticket sur la période" hint="« Nouveau ticket » : plusieurs articles, remise, paiement en espèces, mobile money ou carte." />
      ) : (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Ticket</th><th>Heure</th><th>Articles</th><th>Paiement</th><th className="text-right">Total TTC</th>{data.showCosts && <th className="text-right">Marge HT</th>}<th>Caissier</th><th></th></tr></thead>
            <tbody>
              {sales.map(s => (
                <tr key={s._id} className={s.status === "cancelled" ? "opacity-60" : ""}>
                  <td className="font-mono text-ink">{s.number}{s.status === "cancelled" && <span className="ml-2"><Pill tone="neg">annulé</Pill></span>}</td>
                  <td className="text-ink2 whitespace-nowrap">{new Date(s.date).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="text-ink2">{s.lines.map(l => `${l.label} × ${l.quantity}`).join(", ")}</td>
                  <td className="text-ink2">{s.payments.map(p => SALE_METHOD_LABEL[p.method] || p.method).join(" + ")}</td>
                  <td className="text-right font-mono font-semibold">{MONEY(s.totalTTC)}</td>
                  {data.showCosts && <td className={`text-right font-mono ${(s.marginHT ?? 0) < 0 ? "text-neg" : "text-ink2"}`}>{MONEY(s.marginHT ?? 0)}</td>}
                  <td className="text-ink2">{s.cashierId ? `${s.cashierId.firstName ?? ""} ${s.cashierId.lastName ?? ""}` : "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => printReceipt(s, deskName)} className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title="Imprimer le reçu"><Printer size={15} /></button>
                    {canCancel && s.status === "paid" && <button onClick={() => cancel(s)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Annuler le ticket"><Ban size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {open && <SaleDialog deskId={deskId} deskName={deskName} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); onChange(); }} />}
    </div>
  );
}

interface Draft { itemId: string; quantity: string; price: string; discount: string }

function SaleDialog({ deskId, deskName, onClose, onSaved }: { deskId: string; deskName: string; onClose: () => void; onSaved: () => void }) {
  const { data: items } = useApi<Item[]>(`/api/comptoir/items?deskId=${deskId}`, d => d?.data ?? [], []);
  const byId = useMemo(() => new Map(items.map(i => [i._id, i])), [items]);
  const [lines, setLines] = useState<Draft[]>([{ itemId: "", quantity: "1", price: "", discount: "" }]);
  const [payments, setPayments] = useState<Array<{ method: string; amount: string }>>([{ method: "cash", amount: "" }]);
  const [cashGiven, setCashGiven] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lineTotal = (l: Draft) => {
    const it = byId.get(l.itemId);
    const price = l.price !== "" ? Number(l.price) : it?.salePrice ?? 0;
    return Math.round((Number(l.quantity) || 0) * price * (1 - (Math.min(100, Number(l.discount) || 0)) / 100));
  };
  const total = lines.reduce((t, l) => t + (l.itemId ? lineTotal(l) : 0), 0);
  // Un seul moyen : il prend le total ; plusieurs : le dernier prend le reste.
  const amounts = payments.map((p, i) => (payments.length === 1 ? total : i === payments.length - 1 ? Math.max(0, total - payments.slice(0, -1).reduce((t, x) => t + (Number(x.amount) || 0), 0)) : Number(p.amount) || 0));
  const cashDue = payments.reduce((t, p, i) => t + (p.method === "cash" ? amounts[i] : 0), 0);
  const change = cashGiven && Number(cashGiven) > cashDue ? Number(cashGiven) - cashDue : 0;
  const set = (i: number, patch: Partial<Draft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setError("");
    const body = {
      deskId, customerName: customerName || undefined, cashGiven: cashGiven ? Number(cashGiven) : undefined,
      lines: lines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, quantity: Number(l.quantity), ...(l.price !== "" ? { unitPriceTTC: Number(l.price) } : {}), discount: Number(l.discount) || 0 })),
      payments: payments.map((p, i) => ({ method: p.method, amount: amounts[i] })),
    };
    if (!body.lines.length) { setError("Ajoutez au moins un article."); return; }
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/sales", body);
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Ticket refusé."); return; }
    const { sale, warnings } = res.data.data as { sale: Sale; warnings: string[] };
    showToast(`Ticket ${sale.number} enregistré.`, "success");
    for (const w of warnings ?? []) showToast(w, "warning");
    if (print) printReceipt(sale, deskName);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Nouveau ticket" size="lg">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg inline-flex gap-2"><AlertTriangle size={16} /> {error}</p>}
        <div className="space-y-2">
          {lines.map((l, i) => {
            const it = byId.get(l.itemId);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-5">
                  <FormField label={i === 0 ? "Article" : ""}>
                    <select className={selectCls} value={l.itemId} onChange={e => set(i, { itemId: e.target.value, price: "" })}>
                      <option value="">— Choisir —</option>
                      {items.map(x => <option key={x._id} value={x._id} disabled={x.quantity <= 0}>{x.name} ({x.quantity} {x.unit}){x.salePrice ? ` — ${MONEY(x.salePrice)}` : ""}</option>)}
                    </select>
                  </FormField>
                </div>
                <div className="col-span-3 sm:col-span-2"><FormField label={i === 0 ? "Qté" : ""}><input type="number" min="0" step="any" className={inputCls} value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} /></FormField></div>
                <div className="col-span-4 sm:col-span-2"><FormField label={i === 0 ? "Prix TTC" : ""}><input type="number" min="0" className={inputCls} placeholder={it?.salePrice != null ? String(it.salePrice) : ""} value={l.price} onChange={e => set(i, { price: e.target.value })} /></FormField></div>
                <div className="col-span-3 sm:col-span-1"><FormField label={i === 0 ? "Rem. %" : ""}><input type="number" min="0" max="100" className={inputCls} value={l.discount} onChange={e => set(i, { discount: e.target.value })} /></FormField></div>
                <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1 pb-2">
                  <span className="font-mono text-sm text-ink">{l.itemId ? MONEY(lineTotal(l)) : ""}</span>
                  {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button>}
                </div>
              </div>
            );
          })}
          <button onClick={() => setLines(ls => [...ls, { itemId: "", quantity: "1", price: "", discount: "" }])} className={buttonClass("ghost", "sm")}><Plus size={14} /> Ajouter un article</button>
        </div>

        <div className="surface-card p-4 flex justify-between items-center">
          <span className="text-sm text-ink2">Total à payer</span>
          <span className="text-2xl font-bold text-ink">{MONEY(total)}</span>
        </div>

        <div className="space-y-2">
          {payments.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6"><FormField label={i === 0 ? "Paiement" : ""}>
                <select className={selectCls} value={p.method} onChange={e => setPayments(ps => ps.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>
                  {Object.entries(SALE_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField></div>
              <div className="col-span-5"><FormField label={i === 0 ? "Montant" : ""}>
                {payments.length === 1 || i === payments.length - 1
                  ? <input className={inputCls} disabled value={MONEY(amounts[i])} />
                  : <input type="number" min="0" className={inputCls} value={p.amount} onChange={e => setPayments(ps => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />}
              </FormField></div>
              <div className="col-span-1 pb-2">{payments.length > 1 && <button onClick={() => setPayments(ps => ps.filter((_, j) => j !== i))} className="p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button>}</div>
            </div>
          ))}
          <button onClick={() => setPayments(ps => [{ method: ps[0]?.method === "cash" ? "orange_money" : "cash", amount: "" }, ...ps])} className={buttonClass("ghost", "sm")}><Plus size={14} /> Paiement en plusieurs moyens</button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {cashDue > 0 && <FormField label="Espèces remises" hint={change ? `Monnaie à rendre : ${MONEY(change)}` : undefined}><input type="number" min="0" className={inputCls} value={cashGiven} onChange={e => setCashGiven(e.target.value)} /></FormField>}
          <FormField label="Client (facultatif)"><input className={inputCls} value={customerName} maxLength={120} onChange={e => setCustomerName(e.target.value)} /></FormField>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={print} onChange={e => setPrint(e.target.checked)} className="accent-section" /> Imprimer le reçu</label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button disabled={busy || total <= 0} onClick={save} className={buttonClass("primary", "md")}><Receipt size={15} /> Encaisser {MONEY(total)}</button>
        </div>
      </div>
    </Modal>
  );
}
