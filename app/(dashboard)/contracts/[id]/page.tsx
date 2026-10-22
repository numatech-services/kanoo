"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PenLine, ReceiptText, FolderKanban, Plus, Trash2, Wallet, FileText } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { RetentionPanel } from "@/components/contracts/RetentionPanel";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";
import { ImputedFlows } from "@/components/shared/ImputedFlows";
import { useMe, meCanDo } from "@/lib/useMe";
import type { MarketFinance } from "@/lib/market-finance";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { formatMoney } from "@/lib/format";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Action refusée");
  return d.data;
}
const pct = (n?: number | null) => (n === null || n === undefined ? "—" : `${n.toLocaleString("fr-FR")} %`);

interface Milestone { _id: string; label: string; amount: number; kind?: "deposit" | "standard"; dueDate?: string; status: string; invoiceId?: string }
interface Contract {
  _id: string; title: string; reference: string; status: string; type: string; amount: number; isRecurring?: boolean;
  clientId?: { name?: string } | null; projectId?: { _id: string; code: string; name: string } | null; devisId?: { _id: string; number: string } | null;
  milestones?: Milestone[];
  retentionRate?: number; receptionProvisoireDate?: string; receptionDefinitiveDate?: string; guaranteeMonths?: number;
}

export default function ContractDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const me = useMe();
  const canEdit = meCanDo(me, "contracts", "update");
  const canInvoice = meCanDo(me, "invoices", "create");
  const canBuy = meCanDo(me, "purchases", "create");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<null | { mode: "deposit" | "standard" }>(null);
  const [milestoneOpen, setMilestoneOpen] = useState(false);

  // Lectures silencieuses : l'écran dit lui-même « introuvable ».
  const contractRes = useApi<Contract | null>(id ? `/api/contracts/${id}` : null, c => (c?.success === false ? null : c?.data ?? null), null, { quiet: true });
  const financeRes = useApi<MarketFinance | null>(id ? `/api/contracts/${id}/finance` : null, f => (f?.success === false ? null : f?.data ?? null), null, { quiet: true });
  const contract = contractRes.data;
  const finance = financeRes.data;
  // Seul le premier chargement affiche « Chargement… ».
  const loading = !contractRes.loaded || !financeRes.loaded;
  const reloadContract = contractRes.reload, reloadFinance = financeRes.reload;
  const load = useCallback(() => { reloadContract(); reloadFinance(); }, [reloadContract, reloadFinance]);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Action impossible" }); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="p-6">Chargement…</div>;
  if (!contract) {
    return (
      <div className="p-6">
        <p className="text-ink2">Contrat introuvable ou erreur de chargement.</p>
        <Link href="/contracts" className="text-section underline mt-2 block">Retour à la liste</Link>
      </div>
    );
  }
  const isMarket = contract.type === "client";
  const billable = ["active", "renewed"].includes(contract.status);
  const invoiceNo = new Map((finance?.invoices ?? []).map(i => [i._id, i.number]));

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <Link href="/contracts" className="text-xs text-ink2 hover:text-ink">← Contrats</Link>
          <h1 className="page-title">{contract.title}</h1>
          <p className="text-sm text-ink2"><span className="font-mono">{contract.reference}</span>{contract.clientId?.name ? ` · ${contract.clientId.name}` : ""}
            {contract.devisId && <> · devis <Link href={`/devis/${contract.devisId._id}`} className="text-section hover:underline font-mono">{contract.devisId.number}</Link></>}
            {contract.projectId && <> · projet <Link href={`/projects/${contract.projectId._id}`} className="text-section hover:underline font-mono">{contract.projectId.code}</Link></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={contract.status} />
          {contract.status === "draft" && canEdit && (
            <button onClick={() => run(() => send(`/api/contracts/${id}/sign`, "POST"), "Contrat signé.")} disabled={busy}
              className={buttonClass("primary", "md")}><PenLine size={15} /> Signer</button>
          )}
          {isMarket && !contract.projectId && canEdit && (
            <button onClick={() => run(() => send(`/api/contracts/${id}/project`, "POST", {}), "Projet d'exécution créé : imputez-y les dépenses du marché.")} disabled={busy}
              className={buttonClass("secondary", "md")}><FolderKanban size={15} /> Créer le projet d&apos;exécution</button>
          )}
          {isMarket && contract.projectId && canBuy && (
            <Link href={`/depenses/nouvelle?projectId=${contract.projectId._id}`} className={buttonClass("secondary", "md")}><Wallet size={15} /> Imputer une dépense</Link>
          )}
          {isMarket && billable && canInvoice && (
            <>
              <button onClick={() => setInvoiceFor({ mode: "deposit" })} className={buttonClass("secondary", "md")}><ReceiptText size={15} /> Facture d&apos;acompte</button>
              <button onClick={() => setInvoiceFor({ mode: "standard" })} className={buttonClass("primary", "md")}><ReceiptText size={15} /> Facturer</button>
            </>
          )}
        </div>
      </div>
      {msg && <p className={`p-3 rounded-lg text-sm ${msg.ok ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>{msg.text}</p>}

      {finance && isMarket && <MarketPanel f={finance} hasProject={!!contract.projectId} />}

      {isMarket && (
        <section className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-ink">Échéancier</h2>
              <p className="text-xs text-ink2">Acomptes et situations prévus ; chaque échéance se facture d&apos;un clic.</p>
            </div>
            {canEdit && <button onClick={() => setMilestoneOpen(true)} className="px-3 h-8 rounded-lg border border-line2 text-xs font-semibold hover:bg-surface2 inline-flex items-center gap-1"><Plus size={13} /> Échéance</button>}
          </div>
          {(contract.milestones ?? []).length === 0 ? <p className="px-5 py-5 text-sm text-ink3">Aucune échéance. Exemple : acompte de 30 % à la commande, solde à la livraison.</p> : (
            <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr className="text-left text-ink2"><th>Échéance</th><th>Nature</th><th>Prévue le</th><th className="text-right">Montant HT</th><th>État</th><th /></tr></thead>
              <tbody>
                {(contract.milestones ?? []).map(m => (
                  <tr key={m._id} className="border-t border-line">
                    <td className="text-sm">{m.label}</td>
                    <td>{m.kind === "deposit" ? <Pill tone="info">Acompte</Pill> : <Pill tone="mute">Facture</Pill>}</td>
                    <td className="text-xs text-ink2">{m.dueDate ? new Date(m.dueDate).toLocaleDateString("fr-FR") : "—"}</td>
                    <td className="text-right font-mono">{formatMoney(m.amount)}</td>
                    <td className="text-xs">{m.status === "pending" ? "À facturer" : <>Facturée{m.invoiceId && invoiceNo.get(String(m.invoiceId)) ? <> · <Link href={`/invoices/${m.invoiceId}`} className="text-section hover:underline font-mono">{invoiceNo.get(String(m.invoiceId))}</Link></> : ""}</>}</td>
                    <td className="text-right whitespace-nowrap">
                      {m.status === "pending" && billable && canInvoice && <button disabled={busy} onClick={() => run(() => send(`/api/contracts/${id}/invoice`, "POST", { milestoneId: m._id }), `Facture de l'échéance « ${m.label} » créée (brouillon).`)} className="px-2 h-7 rounded border border-line2 text-xs font-semibold hover:bg-surface2">Facturer</button>}
                      {m.status === "pending" && canEdit && <button disabled={busy} onClick={async () => { if (await confirmDialog({ title: `Retirer l'échéance « ${m.label} » ?`, danger: true })) run(() => send(`/api/contracts/${id}/milestones/${m._id}`, "DELETE"), "Échéance retirée."); }} className="ml-1 p-1 text-ink3 hover:text-neg" aria-label="Retirer"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {finance && finance.invoices.length > 0 && (
        <section className="surface-card overflow-hidden">
          <h2 className="font-semibold text-ink px-5 py-4 border-b border-line">Factures du marché</h2>
          <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr className="text-left text-ink2"><th>N°</th><th>Nature</th><th>Date</th><th className="text-right">HT</th><th className="text-right">TTC</th><th className="text-right">Encaissé</th><th>Statut</th></tr></thead>
            <tbody>
              {finance.invoices.map(i => (
                <tr key={i._id} className="border-t border-line">
                  <td className="whitespace-nowrap"><Link href={`/invoices/${i._id}`} className="font-mono text-section hover:underline">{i.number}</Link></td>
                  <td>{i.documentType === "credit_note" ? <Pill tone="warn">Avoir</Pill> : i.kind === "deposit" ? <Pill tone="info">Acompte</Pill> : <Pill tone="mute">Facture</Pill>}</td>
                  <td className="text-xs text-ink2">{new Date(i.issueDate).toLocaleDateString("fr-FR")}</td>
                  <td className="text-right font-mono whitespace-nowrap">{formatMoney(i.totalHT)}</td>
                  <td className="text-right font-mono whitespace-nowrap">{formatMoney(i.totalTTC)}</td>
                  <td className="text-right font-mono whitespace-nowrap">{i.documentType === "credit_note" ? "—" : formatMoney(i.paidAmount)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {isMarket && <RetentionPanel contractId={id} settings={contract} canEdit={canEdit} canCollect={meCanDo(me, "payments", "create")} onChange={load} />}

      {finance && contract.projectId && <ImputedFlows projectId={contract.projectId._id} />}

      <div className="bg-surface rounded-xl border border-line p-6">
        <h2 className="font-semibold mb-4">Informations générales</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="text-ink2">Montant du marché (HT)</div><div className="font-medium">{formatMoney(contract.amount)}</div>
          <div className="text-ink2">Client</div><div className="font-medium">{contract.clientId?.name || "—"}</div>
          {contract.isRecurring && <><div className="text-ink2">Facturation</div><div className="font-medium">Récurrente
            {canInvoice && billable && <button onClick={() => run(() => send(`/api/contracts/${id}/generate-invoice`, "POST"), "Facture de la période générée.")} disabled={busy} className="ml-2 text-section text-xs font-semibold hover:underline">Générer la facture de la période</button>}
          </div></>}
        </div>
      </div>

      <AttachmentPanel host="contracts" hostId={String(id)} title="Documents du contrat"
        hint="Contrat signé, avenants, courriers. PDF, Word, Excel ou image." categories={["contrat", "avenant", "courrier", "autre"]} defaultCategory="contrat" />

      {invoiceFor && finance && (
        <InvoiceDialog contractId={id} mode={invoiceFor.mode} f={finance} onClose={() => setInvoiceFor(null)}
          onDone={text => { setInvoiceFor(null); setMsg({ ok: true, text }); load(); }} />
      )}
      {milestoneOpen && (
        <MilestoneDialog contractId={id} amount={contract.amount} onClose={() => setMilestoneOpen(false)}
          onDone={() => { setMilestoneOpen(false); load(); }} />
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <p className="text-[11px] font-semibold text-ink2 uppercase">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink3 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink2">{label}{hint && <span className="block text-[11px] text-ink3">{hint}</span>}</span>
      <span className={`font-mono whitespace-nowrap ${strong ? "font-bold text-ink" : "text-ink"}`}>{value}</span>
    </div>
  );
}

/** Montants séparés : devis, marché, acomptes, facturé / encaissé, dépenses par catégorie, marges. */
function MarketPanel({ f, hasProject }: { f: MarketFinance; hasProject: boolean }) {
  const b = f.billing, m = f.margin;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Devis (HT)" value={f.quote ? formatMoney(f.quote.totalHT) : "—"} sub={f.quote ? `Devis ${f.quote.number}` : "Pas de devis lié"} />
        <Kpi label="Marché (HT)" value={formatMoney(f.contractHT)} sub={f.quote && f.quote.totalHT !== f.contractHT ? `Écart avec le devis : ${formatMoney(f.contractHT - f.quote.totalHT)}` : "Montant contractuel"} />
        <Kpi label="Dépenses réalisées" value={formatMoney(f.costs.actual)} sub={f.costs.committed ? `+ ${formatMoney(f.costs.committed)} engagées` : "Imputées au projet"} />
        <Kpi label="Marge à terminaison" value={formatMoney(m.atCompletion)} sub={`${pct(m.atCompletionRate)} du marché`} tone={m.atCompletion < 0 ? "neg" : "pos"} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <section className="surface-card p-5">
          <h2 className="font-semibold text-ink mb-2">Facturation et encaissements</h2>
          <div className="divide-y divide-line">
            <Row label="Montant du marché" value={formatMoney(f.contractHT)} strong />
            <Row label="Acomptes facturés" value={formatMoney(b.depositsHT)} hint={b.depositsDeductedHT ? `dont ${formatMoney(b.depositsDeductedHT)} déduits des factures` : undefined} />
            <Row label="Acomptes restant à déduire" value={formatMoney(b.depositsOutstandingHT)} />
            <Row label="Travaux facturés (HT)" value={formatMoney(b.workHT)} hint="Chiffre d'affaires reconnu" />
            <Row label="Reste à facturer (HT)" value={formatMoney(b.toInvoiceHT)} strong />
            <Row label="Facturé TTC" value={formatMoney(b.invoicedTTC)} />
            <Row label="Encaissé" value={formatMoney(b.collectedTTC)} />
            <Row label="Reste à encaisser" value={formatMoney(b.dueTTC)} strong />
          </div>
        </section>
        <section className="surface-card p-5 lg:col-span-2">
          <h2 className="font-semibold text-ink mb-1">Dépenses du marché</h2>
          {!hasProject ? <p className="text-sm text-warn">Créez le projet d&apos;exécution : les dépenses s&apos;imputent à ce projet (achats, commandes, notes de frais, charges).</p> : (
            <>
              <p className="text-[11px] text-ink3 mb-2">Classées selon le compte de charge. Engagé : bons de commande et achats pas encore comptabilisés. Réalisé : comptabilisé.</p>
              <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead><tr className="text-left text-ink2"><th>Catégorie</th><th className="text-right">Engagé</th><th className="text-right">Réalisé</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {f.costs.categories.map(c => (
                    <tr key={c.key} className="border-t border-line">
                      <td className="text-sm">{c.label}<span className="block text-[11px] text-ink3">{c.hint}</span></td>
                      <td className="text-right font-mono">{c.committed ? formatMoney(c.committed) : "—"}</td>
                      <td className="text-right font-mono">{c.actual ? formatMoney(c.actual) : "—"}</td>
                      <td className="text-right font-mono font-semibold">{c.committed + c.actual ? formatMoney(c.committed + c.actual) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-line font-semibold"><td>Total</td><td className="text-right font-mono">{formatMoney(f.costs.committed)}</td><td className="text-right font-mono">{formatMoney(f.costs.actual)}</td><td className="text-right font-mono">{formatMoney(f.costs.committed + f.costs.actual)}</td></tr></tfoot>
              </table></div>
              {f.costs.supplierDueTTC > 0 && <p className="text-xs text-ink2 mt-2">Reste à payer aux fournisseurs : <b className="font-mono">{formatMoney(f.costs.supplierDueTTC)}</b></p>}
            </>
          )}
        </section>
      </div>
      <section className="surface-card p-5">
        <h2 className="font-semibold text-ink mb-2">Marges</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><p className="text-xs text-ink2">Marge prévue au devis</p><p className="text-sm text-ink3 mt-1">À venir : coût estimé par ligne de devis.</p></div>
          <div><p className="text-xs text-ink2">Marge réelle (travaux facturés − dépenses réalisées)</p><p className={`text-xl font-bold ${m.actual < 0 ? "text-neg" : "text-pos"}`}>{formatMoney(m.actual)} <span className="text-sm font-normal text-ink2">{pct(m.actualRate)}</span></p></div>
          <div><p className="text-xs text-ink2">Marge à terminaison (marché − réalisé − engagé)</p><p className={`text-xl font-bold ${m.atCompletion < 0 ? "text-neg" : "text-pos"}`}>{formatMoney(m.atCompletion)} <span className="text-sm font-normal text-ink2">{pct(m.atCompletionRate)}</span></p></div>
        </div>
      </section>
    </div>
  );
}

function InvoiceDialog({ contractId, mode, f, onClose, onDone }: { contractId: string; mode: "deposit" | "standard"; f: MarketFinance; onClose: () => void; onDone: (text: string) => void }) {
  const deposit = mode === "deposit";
  const [by, setBy] = useState<"rate" | "amount">(deposit ? "rate" : "amount");
  const [value, setValue] = useState(deposit ? "30" : String(Math.max(0, f.contractHT - f.billing.workHT)));
  const [deduct, setDeduct] = useState(true);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const amount = by === "rate" ? Math.round(f.contractHT * Number(value || 0) / 100) : Math.round(Number(value || 0));
  const deduction = !deposit && deduct ? Math.min(f.billing.depositsOutstandingHT, amount) : 0;
  async function submit() {
    setSaving(true); setError("");
    try {
      const d = await send(`/api/contracts/${contractId}/invoice`, "POST", { mode, ...(by === "rate" ? { rate: Number(value) } : { amountHT: Number(value) }), deductDeposits: deduct, description: description || undefined });
      onDone(d?.message ?? "Facture créée.");
    } catch (e) { setError(e instanceof Error ? e.message : "Facturation refusée"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={deposit ? "Facture d'acompte" : "Facturer le marché"} size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <p className="text-sm text-ink2">{deposit
          ? "Avance demandée au client : comptabilisée en avances reçues (419), pas en chiffre d'affaires. Elle sera déduite des factures suivantes."
          : "Facture des travaux du marché. Les acomptes non encore déduits viennent en moins."}</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Base">
            <select className={selectCls} value={by} onChange={e => setBy(e.target.value as "rate" | "amount")}><option value="rate">% du marché</option><option value="amount">Montant HT</option></select>
          </FormField>
          <FormField label={by === "rate" ? "Pourcentage" : "Montant HT (FCFA)"}>
            <input type="number" min={0} className={inputCls} value={value} onChange={e => setValue(e.target.value)} />
          </FormField>
        </div>
        {!deposit && f.billing.depositsOutstandingHT > 0 && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-section" checked={deduct} onChange={e => setDeduct(e.target.checked)} /> Déduire les acomptes ({formatMoney(f.billing.depositsOutstandingHT)} disponibles)</label>
        )}
        <FormField label="Libellé (facultatif)"><input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} placeholder={deposit ? "Acompte à la commande" : "Situation n°1, solde…"} /></FormField>
        <div className="surface-card p-3 text-sm divide-y divide-line">
          <Row label="Montant HT" value={formatMoney(amount)} />
          {deduction > 0 && <Row label="Acompte déduit (HT)" value={`− ${formatMoney(deduction)}`} />}
          <Row label="Net HT à facturer" value={formatMoney(amount - deduction)} strong />
        </div>
        {!deposit && f.retention.rate > 0 && <p className="text-xs text-ink2">Retenue de garantie : {(f.retention.rate * 100).toLocaleString("fr-FR")} % du TTC sera gardé par le client jusqu&apos;à la réception définitive (non exigible, jamais relancé).</p>}
        <p className="text-[11px] text-ink3 flex items-center gap-1"><FileText size={12} /> La facture est créée en brouillon ; TVA et timbre sont calculés comme sur toute facture.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !(amount > 0)} className={buttonClass("primary", "md")}>{saving ? "Création…" : "Créer la facture"}</button>
        </div>
      </div>
    </Modal>
  );
}

function MilestoneDialog({ contractId, amount, onClose, onDone }: { contractId: string; amount: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ label: "", kind: "deposit", by: "rate", value: "30", dueDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ht = f.by === "rate" ? Math.round(amount * Number(f.value || 0) / 100) : Math.round(Number(f.value || 0));
  async function submit() {
    setSaving(true); setError("");
    try {
      await send(`/api/contracts/${contractId}/milestones`, "POST", { label: f.label, kind: f.kind, dueDate: f.dueDate || undefined, ...(f.by === "rate" ? { rate: Number(f.value) } : { amount: Number(f.value) }) });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Échéance refusée"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nouvelle échéance" size="md">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Libellé" required><input className={inputCls} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} placeholder="Acompte à la commande, livraison, réception…" /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nature">
            <select className={selectCls} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value }))}><option value="deposit">Acompte (avance)</option><option value="standard">Facture (travaux)</option></select>
          </FormField>
          <FormField label="Prévue le"><input type="date" className={inputCls} value={f.dueDate} onChange={e => setF(x => ({ ...x, dueDate: e.target.value }))} /></FormField>
          <FormField label="Base">
            <select className={selectCls} value={f.by} onChange={e => setF(x => ({ ...x, by: e.target.value }))}><option value="rate">% du marché</option><option value="amount">Montant HT</option></select>
          </FormField>
          <FormField label={f.by === "rate" ? "Pourcentage" : "Montant HT"} hint={f.by === "rate" ? `= ${formatMoney(ht)} HT` : undefined}>
            <input type="number" min={0} className={inputCls} value={f.value} onChange={e => setF(x => ({ ...x, value: e.target.value }))} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={submit} disabled={saving || !f.label.trim() || !(ht > 0)} className={buttonClass("primary", "md")}>Ajouter</button>
        </div>
      </div>
    </Modal>
  );
}
