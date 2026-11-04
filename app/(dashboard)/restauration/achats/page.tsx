"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBasket, TrendingUp, TrendingDown, FileCheck2, HandCoins } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";
import { Modal } from "@/components/ui/Modal";
import { promptDialog } from "@/components/ui/Dialogs";
import { RestoNav } from "@/components/restauration/RestoNav";
import { StandingSetup } from "@/components/restauration/StandingDeliveries";
import { GroupedOrders } from "@/components/restauration/GroupedOrders";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${(Math.round(n * 100) / 100).toLocaleString("fr-FR")} FCFA`);
const DATE = (d: string) => new Date(d).toLocaleDateString("fr-FR");

interface Data {
  prices: Array<{ itemId: string; name: string; unit: string; last: { unitCost: number; date: string; supplier: string | null }; avg: number; min: number; max: number; purchases: number; changePct: number | null; best: string | null; savings: number;
    suppliers: Array<{ name: string; avg: number; last: number; lastDate: string; purchases: number }> }>;
  receptions: Array<{ unvalued?: boolean; _id: string; item: string; unit: string; supplier: string | null; quantity: number; unitCost: number; amount: number; date: string; reference: string | null }>;
  orders: Array<{ _id: string; number: string; supplier: string | null; totalTTC: number; status: string; date: string }>;
  payables: { total: number; overdue: number; estimatedOrders: number; suppliers: Array<{ supplier: string; total: number; credits: number; paid: number; rest: number; overdue: number; invoices: Invoice[] }> };
}
interface Invoice { _id: string; number: string; ref: string | null; date: string; dueDate: string | null; total: number; credits: number; paid: number; rest: number; late: boolean }

/**
 * Achats du restaurant : évolution et comparaison des prix d'achat (90 jours),
 * meilleur fournisseur et économie possible ; réceptions et commandes reçues
 * qui attendent leur facture, à rapprocher par le comptable.
 */
export default function AchatsPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [invoice, setInvoice] = useState("");
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const { data, loading, error, reload } = useApi<Data | null>(deskId ? `/api/restauration/achats?deskId=${deskId}` : null, d => (d?.data as Data) ?? null, null, { quiet: true });
  const totalPicked = (data?.receptions ?? []).filter(r => picked.includes(r._id)).reduce((t, r) => t + r.amount, 0);

  async function valueOne(id: string, item: string) {
    const v = await promptDialog({ title: `Prix unitaire de ${item}`, message: "La dette fournisseur sera créée et le coût moyen corrigé.", label: "Prix (FCFA)", type: "number", required: true });
    if (!v) return;
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/achats", { deskId, action: "value", ids: [id], unitCost: Number(v) });
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    showToast("Réception valorisée", "success"); reload();
  }

  async function reconcile() {
    const r = await apiSend<{ error?: string; data?: { matched: number } }>("POST", "/api/restauration/achats", { deskId, ids: picked, invoiceRef: invoice });
    if (!r.ok) return showToast(r.data.error || "Rapprochement refusé", "error");
    showToast(`${r.data.data?.matched ?? 0} réception(s) rapprochée(s) de la facture ${invoice}`, "success");
    setPicked([]); setInvoice(""); reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><ShoppingBasket size={22} /> Achats</h1>
          <p className="text-sm text-ink2">Ce que coûtent vos achats, chez qui ils sont le moins chers, et ce qui attend encore sa facture.</p>
        </div>
        <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => { setPicked([]); setDeskId(e.target.value); }}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
      </div>
      <RestoNav />
      <GroupedOrders />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-48 surface-card animate-pulse" /> : !data ? null : <>
        <Payables deskId={deskId} data={data.payables} onDone={reload} />
        <section className="surface-card p-4 space-y-2">
          <h2 className="font-semibold text-ink">Prix d&apos;achat des 90 derniers jours</h2>
          {!data.prices.length ? <p className="text-sm text-ink3">Aucun achat valorisé : les prix apparaissent à la réception en réserve ou à la réception d&apos;une commande.</p> : (
            <div className="overflow-x-auto"><table className="table-dense w-full">
              <thead><tr><th>Article</th><th className="text-right">Dernier prix</th><th className="text-right">Évolution</th><th className="text-right">Moyenne</th><th className="text-right">Plus bas / plus haut</th><th>Fournisseurs (moyenne)</th><th className="text-right">Économie possible</th></tr></thead>
              <tbody>{data.prices.map(p => (
                <tr key={p.itemId} className="border-t border-line">
                  <td>{p.name}<span className="block text-[11px] text-ink3">{p.purchases} achat(s), par {p.unit}</span></td>
                  <td className="text-right font-mono">{MONEY(p.last.unitCost)}<span className="block text-[11px] text-ink3">{DATE(p.last.date)}{p.last.supplier ? ` · ${p.last.supplier}` : ""}</span></td>
                  <td className={`text-right font-mono ${(p.changePct ?? 0) > 0 ? "text-neg" : (p.changePct ?? 0) < 0 ? "text-pos" : ""}`}>{p.changePct === null ? "—" : <>{p.changePct > 0 ? <TrendingUp size={12} className="inline" /> : p.changePct < 0 ? <TrendingDown size={12} className="inline" /> : null} {p.changePct > 0 ? "+" : ""}{p.changePct} %</>}</td>
                  <td className="text-right font-mono">{MONEY(p.avg)}</td>
                  <td className="text-right font-mono text-ink2">{MONEY(p.min)} / {MONEY(p.max)}</td>
                  <td className="text-sm">{p.suppliers.map((s, i) => <span key={s.name} className="block">{i === 0 && p.suppliers.length > 1 ? <Pill tone="pos">moins cher</Pill> : null} {s.name} : {MONEY(s.avg)} <span className="text-ink3 text-[11px]">({s.purchases})</span></span>)}</td>
                  <td className="text-right font-mono">{p.savings ? MONEY(p.savings) : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="text-[11px] text-ink3">Économie possible : ce qu&apos;auraient coûté les mêmes quantités au prix moyen du fournisseur le moins cher.</p>
        </section>

        <section className="surface-card p-4 space-y-3">
          <h2 className="font-semibold text-ink inline-flex items-center gap-2"><FileCheck2 size={16} /> Réceptions en attente de facture</h2>
          {!data.receptions.length ? <p className="text-sm text-ink3">Aucune : toutes les réceptions non payées en caisse sont rapprochées d&apos;une facture.</p> : <>
            <div className="overflow-x-auto"><table className="table-dense w-full">
              <thead><tr><th></th><th>Date</th><th>Article</th><th>Fournisseur</th><th className="text-right">Quantité</th><th className="text-right">Montant</th><th>Référence</th></tr></thead>
              <tbody>{data.receptions.map(r => (
                <tr key={r._id} className="border-t border-line">
                  <td><input type="checkbox" checked={picked.includes(r._id)} onChange={e => setPicked(x => e.target.checked ? [...x, r._id] : x.filter(y => y !== r._id))} aria-label="Choisir" /></td>
                  {r.unvalued && <td><button onClick={() => valueOne(r._id, r.item)} className={buttonClass("secondary", "sm")}>Valoriser</button></td>}
                  <td className="text-ink2">{DATE(r.date)}</td><td>{r.item}</td><td>{r.supplier ?? "—"}</td>
                  <td className="text-right font-mono">{r.quantity.toLocaleString("fr-FR")} {r.unit}</td>
                  <td className="text-right font-mono">{r.unitCost ? MONEY(r.amount) : <span className="text-warn text-xs">à valoriser</span>}</td>
                  <td className="text-ink2">{r.reference ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="flex flex-wrap gap-2 items-end">
              <FormField label="Numéro de la facture du fournisseur"><input className={inputCls} value={invoice} onChange={e => setInvoice(e.target.value)} /></FormField>
              <button disabled={!picked.length || !invoice.trim()} onClick={reconcile} className={buttonClass("primary", "md")}>Rapprocher {picked.length ? `(${picked.length}, ${MONEY(totalPicked)})` : ""}</button>
            </div>
            <p className="text-[11px] text-ink3">La facture elle-même se saisit dans Achats & stock → Factures et dépenses ; le rapprochement relie la réception à son numéro pour le comptable.</p>
          </>}
          {data.orders.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink mt-2">Commandes reçues sans facture d&apos;achat</p>
              <ul className="text-sm space-y-1">{data.orders.map(o => <li key={o._id}><Link href={`/commandes/${o._id}`} className="hover:text-section">{o.number}</Link> · {o.supplier ?? "—"} · {MONEY(o.totalTTC)} · {o.status === "received" ? "reçue" : "reçue en partie"}</li>)}</ul>
            </div>
          )}
        </section>
      </>}
      {deskId && <StandingSetup key={deskId} deskId={deskId} />}
    </div>
  );
}

/**
 * Ce que le site doit, fournisseur par fournisseur : facturé, avoirs, déjà
 * payé, reste dû. Payer solde la dette, ce n'est pas un nouvel achat.
 */
function Payables({ deskId, data, onDone }: { deskId: string; data: Data["payables"]; onDone: () => void }) {
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [back, setBack] = useState<Invoice | null>(null);
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><HandCoins size={16} /> Ce que vous devez aux fournisseurs</h2>
        <p className="text-sm text-ink2">Total : <b className="font-mono">{MONEY(data.total)}</b>{data.overdue > 0 && <> · <span className="text-neg">en retard : {MONEY(data.overdue)}</span></>}</p>
      </div>
      {data.estimatedOrders > 0 && <p className="text-sm text-warn">Plus {MONEY(data.estimatedOrders)} estimés : commandes reçues dont la facture n&apos;est pas enregistrée.</p>}
      {!data.suppliers.length ? <p className="text-sm text-ink3">Rien à payer : chaque réception à crédit apparaît ici dès qu&apos;elle est enregistrée.</p> : data.suppliers.map(s => (
        <div key={s.supplier} className="rounded-lg border border-line p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <p className="font-semibold">{s.supplier}</p>
            <p className="text-ink2">Facturé {MONEY(s.total)}{s.credits ? ` − avoirs ${MONEY(s.credits)}` : ""} − payé {MONEY(s.paid)} = <b className="font-mono text-ink">{MONEY(s.rest)}</b></p>
          </div>
          <ul className="divide-y divide-line">{s.invoices.map(i => (
            <li key={i._id} className="py-1.5 flex items-center justify-between gap-2 flex-wrap text-sm">
              <span>{i.number}{i.ref ? ` · ${i.ref}` : ""} <span className="text-ink3">· {DATE(i.date)}</span> {i.late ? <Pill tone="neg">en retard</Pill> : null}</span>
              <span className="flex items-center gap-2"><b className="font-mono">{MONEY(i.rest)}</b>
                <button onClick={() => setPaying(i)} className={buttonClass("secondary", "sm")}>Payer</button>
                <button onClick={() => setBack(i)} className={buttonClass("ghost", "sm")}>Retour</button>
              </span>
            </li>
          ))}</ul>
        </div>
      ))}
      {paying && <PayDialog deskId={deskId} invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onDone(); }} />}
      {back && <ReturnDialog deskId={deskId} invoice={back} onClose={() => setBack(null)} onDone={() => { setBack(null); onDone(); }} />}
    </section>
  );
}

function PayDialog({ deskId, invoice, onClose, onDone }: { deskId: string; invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [amount, setAmount] = useState(String(invoice.rest)), [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string }>>([]);
  useEffect(() => { apiJson("/api/treasury-accounts").then(d => setAccounts((Array.isArray(d.data) ? d.data : d.data?.items ?? []) as Array<{ _id: string; label: string }>)).catch(() => {}); }, []);
  async function pay() {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/achats", { deskId, action: "pay", purchaseId: invoice._id, amount: Number(amount.replace(/\s/g, "").replace(",", ".")), treasuryAccountId: account || undefined }, op.headers());
    if (!r.ok) return showToast(r.data.error || "Paiement refusé", "error");
    op.done(); showToast("Paiement enregistré", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Payer ${invoice.number}`} description={`Reste dû : ${MONEY(invoice.rest)}`} size="sm" footer={<button onClick={pay} className={buttonClass("primary", "md")}>Payer</button>}>
      <div className="space-y-3">
        <FormField label="Montant (FCFA)"><input className={inputCls} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Payé depuis"><select className={selectCls} value={account} onChange={e => setAccount(e.target.value)}><option value="">La caisse du site</option>{accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

function ReturnDialog({ deskId, invoice, onClose, onDone }: { deskId: string; invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const { data: lines } = useApi<Array<{ itemId: string; name: string; unit: string; quantity: number; unitCost: number }>>(`/api/restauration/achats?deskId=${deskId}&lines=${invoice._id}`, d => (d?.data as never) ?? [], [], { quiet: true });
  const [qty, setQty] = useState<Record<string, string>>({}), [reason, setReason] = useState("");
  async function send() {
    const out = lines.filter(l => Number(qty[l.itemId]) > 0).map(l => ({ itemId: l.itemId, quantity: Number(qty[l.itemId]), unitCost: l.unitCost }));
    if (!out.length) return showToast("Saisissez une quantité retournée.", "error");
    const r = await apiSend<{ error?: string; data?: { amount: number } }>("POST", "/api/restauration/achats", { deskId, action: "return", purchaseId: invoice._id, lines: out, reason }, op.headers());
    if (!r.ok) return showToast(r.data.error || "Retour refusé", "error");
    op.done(); showToast(`Retour enregistré : avoir de ${MONEY(r.data.data?.amount)}`, "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Retour sur ${invoice.number}`} description="La marchandise sort de la réserve et la dette baisse. Ce n'est ni une perte ni une vente." size="md" footer={<button onClick={send} className={buttonClass("primary", "md")}>Enregistrer le retour</button>}>
      <div className="space-y-3">
        {!lines.length ? <p className="text-sm text-ink3">Aucune réception reliée à cette facture.</p> : lines.map(l => (
          <label key={l.itemId} className="flex items-center justify-between gap-2 text-sm"><span>{l.name} <span className="text-ink3">({l.quantity} {l.unit} à {MONEY(l.unitCost)})</span></span><input className={`${inputCls} w-24`} inputMode="decimal" value={qty[l.itemId] ?? ""} onChange={e => setQty(q => ({ ...q, [l.itemId]: e.target.value }))} aria-label={`Quantité retournée de ${l.name}`} /></label>
        ))}
        <FormField label="Motif" required><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="Carton abîmé à la livraison" /></FormField>
      </div>
    </Modal>
  );
}
