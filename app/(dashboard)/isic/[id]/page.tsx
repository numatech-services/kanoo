"use client";

import { isicBatchFinance, ISIC_COST_LABEL, type IsicCostKey } from "@/lib/isic-finance";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Truck, Banknote, Upload, Download, Trash2, ArrowRight, Ban, FileText, BookUser } from "lucide-react";
import { ISIC_STATUS, fmt, delivered as sumDelivered } from "../page";
import { useMe, meCan, meCanDo } from "@/lib/useMe";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
interface Delivery { _id: string; date: string; quantity: number; note?: string }
interface Payment { _id: string; date: string; amount: number; method?: string; note?: string }
interface Batch {
  _id: string; reference: string; universityName: string; academicYear?: string; status: string;
  totalCards: number; unitLicenseFee: number; unitSalePrice: number; unitPrintCost?: number; unitLanyardCost?: number;
  costs?: Array<{ _id: string; category: string; label: string; quantity?: number; unitCost?: number; amount: number; date: string; supplier?: string; note?: string }>;
  receivedFile?: { name?: string; dataUri?: string }; isicFile?: { name?: string; dataUri?: string };
  submittedAt?: string; numberedAt?: string; deliveries: Delivery[]; payments: Payment[];
  licensePayments?: Payment[]; universityId?: { _id?: string; name?: string } | string; invoiceId?: string; notes?: string;
}
interface ClientOpt { _id: string; name: string }

const STAGES: { key: string; label: string }[] = [
  { key: "received", label: "Reçu" }, { key: "processing", label: "Traitement" },
  { key: "submitted", label: "Envoyé ISIC" }, { key: "numbered", label: "Numéros reçus" },
  { key: "printing", label: "Impression" }, { key: "printed", label: "Imprimées" },
  { key: "delivering", label: "Livraison" }, { key: "completed", label: "Terminé" },
];
const NEXT: Record<string, string> = { received: "processing", processing: "submitted", submitted: "numbered", numbered: "printing", printing: "printed" };
const dt = (d?: string) => (d ? new Date(d).toLocaleDateString("fr-FR") : "");

export default function IsicBatchPage() {
  const { id } = useParams();
  const router = useRouter();
  const { resources } = useMe();
  const canFinance = meCan(resources, "isicFinance");
  // Facturer l'université : droit de créer des factures (et de lire les clients),
  // pas seulement le suivi financier ISIC.
  const canInvoiceUni = meCan(resources, "invoices") && meCan(resources, "clients");
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const me = useMe();
  const canDelete = meCanDo(me, "isic", "delete");
  const canDeleteFinance = meCanDo(me, "isicFinance", "delete");
  const [b, setB] = useState<Batch | null>(null);
  const [delivery, setDelivery] = useState({ quantity: 0, note: "" });
  const [payment, setPayment] = useState({ amount: 0, method: "", note: "" });
  const [licPay, setLicPay] = useState({ amount: 0, note: "" });
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<{ _id: string; studentName: string; matricule?: string; isicNumber?: string; status: string }[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    apiJson(`/api/isic/${id}`).then(d => setB(d.data || d));
  }, [id]);
  const loadCards = useCallback(() => {
    apiJson(`/api/isic/${id}/cards`)
      .then(d => { setCards(d.data?.cards || []); setCounts(d.data?.counts || {}); }).catch(() => {});
  }, [id]);
  useEffect(() => { load(); loadCards(); }, [load, loadCards]);

  async function cardsAction(bodyOrFile: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await apiSend("POST", `/api/isic/${id}/cards`, bodyOrFile);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Échec");
      loadCards();
    } catch (e) { showToast(e instanceof Error ? e.message : "Action impossible", "error"); } finally { setBusy(false); }
  }
  // Synchronisation avec le registre ISIC (fiches étudiants, numéros, licences).
  const [sync, setSync] = useState<null | {
    academicYear: string; cards: number; linked: number; studentsCreated: number; numbersToRegistry: number;
    numbersFromRegistry: number; licencesCreated: number;
    conflicts: { line: number; name: string; reason: string }[]; skipped: { line: number; reason: string }[];
  }>(null);
  async function syncRegistry() {
    setBusy(true);
    try {
      let res = await apiSend("POST", `/api/isic/${id}/registry`, {});
      let d = res.data;
      if (!res.ok && /année académique/i.test(d.error || "")) {
        const y = await promptDialog({ title: "Année académique du lot (format 2025-2026) :" });
        if (!y) return;
        res = await apiSend("POST", `/api/isic/${id}/registry`, { academicYear: y.trim() });
        d = res.data;
      }
      if (!res.ok) throw new Error(d.error || "Synchronisation impossible");
      setSync(d.data);
      loadCards();
    } catch (e) { showToast(e instanceof Error ? e.message : "Synchronisation impossible", "error"); } finally { setBusy(false); }
  }

  function importCsv(action: "import-students" | "import-numbers", file: File) {
    const reader = new FileReader();
    reader.onload = () => cardsAction({ action, csv: String(reader.result) });
    reader.readAsText(file);
  }
  useEffect(() => {
    if (!canInvoiceUni) return;
    apiJson("/api/clients?limit=500")
      .then(d => setClients(Array.isArray(d.data) ? d.data : d.data?.items || [])).catch(() => {});
  }, [canInvoiceUni]);

  async function generateInvoice() {
    const uniId = typeof b!.universityId === "object" ? b!.universityId?._id : b!.universityId;
    if (!uniId) { showToast("Liez d'abord un client (université) pour facturer.", "warning"); return; }
    setBusy(true);
    try {
      const today = new Date(); const due = new Date(today); due.setDate(due.getDate() + 30);
      const res = await apiSend("POST", "/api/invoices", {
          clientId: uniId, issueDate: today.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10),
          lines: [{ description: `Cartes ISIC ${b!.academicYear || ""} — ${b!.reference}`.trim(), quantity: b!.totalCards, unitPrice: b!.unitSalePrice, tvaRate: 0 }],
        });
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Échec");
      const invId = d.data?._id || d.data?.id;
      await patch({ invoiceId: invId });
      showToast("Facture générée.", "success");
    } catch (e) { showToast(e instanceof Error ? e.message : "Génération impossible", "error"); } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await apiSend("PATCH", `/api/isic/${id}`, body);
    if (res.ok) load(); else showToast((res.data).error || "Échec", "error");
  }
  async function post(path: string, body: Record<string, unknown>, reset: () => void) {
    const res = await apiSend("POST", `/api/isic/${id}/${path}`, body);
    if (res.ok) { reset(); load(); } else showToast((res.data).error || "Échec", "error");
  }
  async function del(path: string, qs: string) {
    const res = await apiSend("DELETE", `/api/isic/${id}/${path}?${qs}`);
    if (res.ok) load();
  }
  async function deleteBatch() {
    if (!(await confirmDialog({ title: "Supprimer ce lot ?", danger: true }))) return;
    const res = await apiSend("DELETE", `/api/isic/${id}`);
    if (res.ok) router.push("/isic"); else showToast("Suppression impossible.", "error");
  }
  function upload(field: "receivedFile" | "isicFile", file: File) {
    if (file.size > 2_500_000) { showToast("Fichier trop lourd (2,5 Mo max).", "warning"); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ [field]: { name: file.name, dataUri: String(reader.result) } });
    reader.readAsDataURL(file);
  }

  if (!b) return <div className="p-6"><div className="h-32 bg-surface rounded-xl animate-pulse" /></div>;
  const s = ISIC_STATUS[b.status] || { label: b.status, cls: "bg-surface2 text-ink2" };
  const done = sumDelivered(b); const remaining = b.totalCards - done;
  const licenseCost = b.totalCards * b.unitLicenseFee, saleAmount = b.totalCards * b.unitSalePrice;
  const fin = isicBatchFinance(b);
  const paid = b.payments.reduce((x, p) => x + p.amount, 0); const balance = saleAmount - paid;
  const licPaid = (b.licensePayments || []).reduce((x, p) => x + p.amount, 0);
  const terminal = b.status === "cancelled" || b.status === "completed";
  const currentIdx = STAGES.findIndex(st => st.key === b.status);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <Link href="/isic" className="text-xs text-ink2 hover:text-ink">← Cartes ISIC</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="page-title">{b.universityName}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
          </div>
          <p className="text-sm text-ink2 font-mono">{b.reference}{b.academicYear ? ` · ${b.academicYear}` : ""}</p>
        </div>
        <div className="flex gap-2">
          {NEXT[b.status] && <button onClick={() => patch({ status: NEXT[b.status] })} className="px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 inline-flex items-center gap-1.5">Étape suivante <ArrowRight size={15} /></button>}
          {!terminal && <button onClick={async () => { if (await confirmDialog({ title: "Annuler ce lot ?", danger: true })) patch({ status: "cancelled" }); }} className="px-3 h-10 rounded-lg border border-warn/25 text-warn text-sm hover:bg-warn-50 inline-flex items-center gap-1.5"><Ban size={15} /> Annuler</button>}
          {canDelete && <button onClick={deleteBatch} className="px-3 h-10 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50">Supprimer</button>}
        </div>
      </div>

      {/* Étapes */}
      <div className="surface-card p-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {STAGES.map((st, i) => (
            <div key={st.key} className="flex items-center gap-1">
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${i <= currentIdx && b.status !== "cancelled" ? "bg-section text-white" : "bg-surface2 text-ink3"}`}>{st.label}</span>
              {i < STAGES.length - 1 && <ArrowRight size={12} className="text-ink3" />}
            </div>
          ))}
        </div>
      </div>

      {/* Cartes — suivi détaillé (production, visible aussi de l'opérateur). */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Cartes (suivi détaillé)</h2>
          <div className="flex gap-1.5 text-[11px]">
            {[["pending", "À traiter"], ["numbered", "Numérotées"], ["printed", "Imprimées"], ["delivered", "Livrées"]].map(([k, l]) => (
              <span key={k} className="px-2 py-0.5 rounded-full bg-surface2 text-ink2">{l} <b className="text-ink">{counts[k] || 0}</b></span>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
            <Upload size={14} /> Importer les étudiants (CSV)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && importCsv("import-students", e.target.files[0])} />
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
            <Upload size={14} /> Importer les numéros ISIC (CSV)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && importCsv("import-numbers", e.target.files[0])} />
          </label>
          {cards.length > 0 && (
            <button disabled={busy} onClick={syncRegistry} title="Rattache les cartes aux fiches du registre, ouvre les licences de l'année et reporte les numéros déjà connus"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-section/40 text-section text-sm font-semibold hover:bg-section/5 disabled:opacity-50">
              <BookUser size={14} /> Synchroniser avec le registre
            </button>
          )}
          {(counts.numbered || 0) > 0 && <button disabled={busy} onClick={() => cardsAction({ action: "advance", from: "numbered", to: "printed" })} className="px-3 h-9 rounded-lg bg-ink text-onink text-sm font-semibold">Marquer imprimées</button>}
          {(counts.printed || 0) > 0 && <button disabled={busy} onClick={() => cardsAction({ action: "advance", from: "printed", to: "delivered" })} className="px-3 h-9 rounded-lg bg-section text-white text-sm font-semibold">Marquer livrées</button>}
        </div>
        {sync && (
          <div className="rounded-lg border border-section/25 bg-section/5 p-3 text-sm space-y-1.5">
            <div className="flex justify-between items-start gap-2">
              <p className="font-semibold text-ink">Registre synchronisé — licences {sync.academicYear}</p>
              <button onClick={() => setSync(null)} className="text-xs text-ink3 hover:text-ink">Fermer</button>
            </div>
            <p className="text-ink2">
              {sync.linked}/{sync.cards} cartes rattachées · {sync.studentsCreated} nouvel(s) étudiant(s) ·{" "}
              {sync.licencesCreated} licence(s) ouverte(s) · {sync.numbersFromRegistry} numéro(s) repris d&apos;anciens étudiants ·{" "}
              {sync.numbersToRegistry} numéro(s) ajouté(s) au registre
            </p>
            {[...sync.conflicts, ...sync.skipped.map(x => ({ ...x, name: "" }))].length > 0 && (
              <ul className="text-xs text-warn list-disc pl-5 max-h-32 overflow-y-auto">
                {sync.conflicts.map((c, i) => <li key={`c${i}`}>Carte {c.line} — {c.name} : {c.reason}</li>)}
                {sync.skipped.map((c, i) => <li key={`s${i}`}>Carte {c.line} : {c.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {cards.length > 0 ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
            <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead><tr className="bg-surface2/50"><th>Étudiant</th><th>Matricule</th><th>N° ISIC</th><th>Statut</th></tr></thead>
              <tbody>
                {cards.slice(0, 200).map(c => (
                  <tr key={c._id} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink">{c.studentName}</td>
                    <td className="px-3 py-1.5 text-ink2 font-mono text-xs">{c.matricule || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{c.isicNumber || <span className="text-ink3">—</span>}</td>
                    <td className="px-3 py-1.5 text-xs">{({ pending: "À traiter", numbered: "Numérotée", printed: "Imprimée", delivered: "Livrée" } as Record<string, string>)[c.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {cards.length > 200 && <p className="text-[11px] text-ink3 px-3 py-1.5">… et {cards.length - 200} autres.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink3">Importez le fichier étudiants pour un suivi carte par carte (facultatif — le suivi par lot reste dispo).</p>
        )}
      </section>

      {/* Finances — visibles seulement pour un rôle financier. */}
      {canFinance && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[["Revente université", fmt(fin.sale), "text-ink"], ["Coût de revient / carte", fmt(fin.unitCostForecast), "text-ink"],
              ["Marge / carte", fmt(fin.unitMarginForecast), fin.unitMarginForecast < 0 ? "text-neg" : "text-pos"],
              ["Marge du lot", `${fmt(fin.forecastMargin)}${fin.marginRate !== null ? ` · ${fin.marginRate} %` : ""}`, fin.forecastMargin < 0 ? "text-neg" : "text-pos"]].map(([k, v, c]) => (
              <div key={k} className="surface-card p-4"><p className="text-[11px] text-ink2 uppercase font-semibold">{k}</p><p className={`text-lg font-bold ${c}`}>{v}</p></div>
            ))}
          </div>
          <IsicCostsPanel batch={b} fin={fin} canEdit={canFinance} canDelete={canDeleteFinance}
            onPatch={patch} onAdd={(body, reset) => post("costs", body, reset)} onDelete={costId => del("costs", `costId=${costId}`)} />
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Livraisons au fur et à mesure */}
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink flex items-center gap-2"><Truck size={17} /> Livraisons</h2>
            <span className="text-sm text-ink2">{done}/{b.totalCards} · reste <b className={remaining ? "text-warn" : "text-pos"}>{remaining}</b></span>
          </div>
          {b.deliveries.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {b.deliveries.map(d => (
                <li key={d._id} className="flex items-center justify-between py-1.5">
                  <span><b className="text-ink">{d.quantity}</b> cartes · <span className="text-ink2">{dt(d.date)}</span>{d.note && <span className="text-ink3"> — {d.note}</span>}</span>
                  {canDelete && <button onClick={() => del("delivery", `deliveryId=${d._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>}
                </li>
              ))}
            </ul>
          )}
          {remaining > 0 && b.status !== "cancelled" && (
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="text-[11px] text-ink3">Quantité livrée</label><input type="number" min={1} max={remaining} className="w-full p-2 border border-line rounded-lg text-sm" value={delivery.quantity || ""} onChange={e => setDelivery(d => ({ ...d, quantity: Number(e.target.value) }))} /></div>
              <input placeholder="Note (bordereau…)" className="flex-1 p-2 border border-line rounded-lg text-sm" value={delivery.note} onChange={e => setDelivery(d => ({ ...d, note: e.target.value }))} />
              <button onClick={() => post("delivery", delivery, () => setDelivery({ quantity: 0, note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-onink text-sm font-semibold">Livrer</button>
            </div>
          )}
        </section>

        {/* Encaissements — volet financier. */}
        {canFinance && (
        <section className="surface-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink flex items-center gap-2"><Banknote size={17} /> Encaissements</h2>
            <span className="text-sm text-ink2">Payé {fmt(paid)} · reste <b className={balance > 0 ? "text-warn" : "text-pos"}>{fmt(balance)}</b></span>
          </div>
          {b.payments.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {b.payments.map(p => (
                <li key={p._id} className="flex items-center justify-between py-1.5">
                  <span><b className="text-ink">{fmt(p.amount)}</b> · <span className="text-ink2">{dt(p.date)}</span>{p.method && <span className="text-ink3"> — {p.method}</span>}</span>
                  {canDeleteFinance && <button onClick={() => del("payment", `paymentId=${p._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1"><label className="text-[11px] text-ink3">Montant (FCFA)</label><input type="number" min={1} className="w-full p-2 border border-line rounded-lg text-sm" value={payment.amount || ""} onChange={e => setPayment(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
            <input placeholder="Mode (virement…)" className="flex-1 p-2 border border-line rounded-lg text-sm" value={payment.method} onChange={e => setPayment(p => ({ ...p, method: e.target.value }))} />
            <button onClick={() => post("payment", payment, () => setPayment({ amount: 0, method: "", note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-onink text-sm font-semibold">Ajouter</button>
          </div>
        </section>
        )}
      </div>

      {/* Achat licences + facturation (financier) */}
      {canFinance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="surface-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink flex items-center gap-2"><Banknote size={17} /> Frais de licence ISIC</h2>
              <span className="text-sm text-ink2">Payé {fmt(licPaid)} / {fmt(licenseCost)}</span>
            </div>
            {(b.licensePayments || []).length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {(b.licensePayments || []).map(p => (
                  <li key={p._id} className="flex items-center justify-between py-1.5">
                    <span><b className="text-ink">{fmt(p.amount)}</b> · <span className="text-ink2">{dt(p.date)}</span></span>
                    {canDeleteFinance && <button onClick={() => del("license-payment", `paymentId=${p._id}`)} className="text-ink3 hover:text-neg"><Trash2 size={13} /></button>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="text-[11px] text-ink3">Montant versé à ISIC (FCFA)</label><input type="number" min={1} className="w-full p-2 border border-line rounded-lg text-sm" value={licPay.amount || ""} onChange={e => setLicPay(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
              <button onClick={() => post("license-payment", licPay, () => setLicPay({ amount: 0, note: "" }))} className="px-3 h-9 rounded-lg bg-ink text-onink text-sm font-semibold">Enregistrer</button>
            </div>
          </section>

          {canInvoiceUni ? <section className="surface-card p-5 space-y-3">
            <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Facturation université</h2>
            <div>
              <label className="text-[11px] text-ink3">Client (université) à facturer</label>
              <select className="w-full mt-1 p-2 border border-line rounded-lg text-sm" value={(typeof b.universityId === "object" ? b.universityId?._id : b.universityId) || ""} onChange={e => patch({ universityId: e.target.value })}>
                <option value="">— Lier un client —</option>
                {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            {b.invoiceId ? (
              <Link href={`/invoices/${b.invoiceId}`} className="inline-flex items-center gap-1.5 text-sm text-pos hover:underline">Facture générée — l&apos;ouvrir →</Link>
            ) : (
              <button onClick={generateInvoice} disabled={busy || !b.unitSalePrice} className={buttonClass("primary", "md", "w-full")}>
                {busy ? "Génération…" : "Générer la facture de revente"}
              </button>
            )}
            {!b.unitSalePrice && <p className="text-[11px] text-warn">Renseignez le prix de revente pour facturer.</p>}
          </section> : (
            <section className="surface-card p-5 text-sm text-ink2">
              <h2 className="font-semibold text-ink flex items-center gap-2 mb-1"><FileText size={17} /> Facturation université</h2>
              {b.invoiceId ? "Facture émise par la comptabilité." : "La facture de revente est émise par la comptabilité."}
            </section>
          )}
        </div>
      )}

      {/* Fichiers */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Fichiers</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {([["receivedFile", "Fichier reçu de l'université"], ["isicFile", "Fichier ISIC (avec numéros)"]] as const).map(([field, label]) => {
            const f = b[field];
            return (
              <div key={field} className="text-sm">
                <p className="text-ink2 mb-1">{label}</p>
                {f?.dataUri ? (
                  <div className="flex items-center gap-3">
                    <a href={f.dataUri} download={f.name} className="inline-flex items-center gap-1.5 text-section hover:underline"><Download size={14} /> {f.name || "Télécharger"}</a>
                    <button onClick={() => patch({ [field]: null })} className="text-xs text-neg hover:underline">Retirer</button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-ink2 hover:bg-surface2 cursor-pointer">
                    <Upload size={14} /> Joindre (2,5 Mo max)
                    <input type="file" className="hidden" onChange={e => e.target.files?.[0] && upload(field, e.target.files[0])} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface-card p-5">
        <label className="text-sm font-semibold text-ink">Notes</label>
        <textarea className="w-full mt-2 p-2 border border-line rounded-lg text-sm" rows={2} defaultValue={b.notes || ""} onBlur={e => e.target.value !== (b.notes || "") && patch({ notes: e.target.value })} placeholder="Remarques internes…" />
      </section>
    </div>
  );
}

const COST_CATEGORIES: Array<{ key: "printing" | "lanyard" | "operations" | "other"; hint: string }> = [
  { key: "printing", hint: "Impression des cartes (prestataire, consommables)" },
  { key: "lanyard", hint: "Achat des tours de cou personnalisés" },
  { key: "operations", hint: "Transport, livraison, saisie, frais bancaires…" },
  { key: "other", hint: "Toute autre dépense du lot" },
];

/** Coûts du lot : prévu (par carte) et réel (dépenses saisies), catégorie par catégorie. */
function IsicCostsPanel({ batch, fin, canEdit, canDelete, onPatch, onAdd, onDelete }: {
  batch: Batch; fin: ReturnType<typeof isicBatchFinance>; canEdit: boolean; canDelete: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void> | void;
  onAdd: (body: Record<string, unknown>, reset: () => void) => Promise<void> | void;
  onDelete: (costId: string) => void;
}) {
  const empty = { category: "printing", label: "", quantity: "", unitCost: "", amount: "", supplier: "", date: new Date().toISOString().slice(0, 10) };
  const [f, setF] = useState(empty);
  const [units, setUnits] = useState({ print: String(batch.unitPrintCost ?? ""), lanyard: String(batch.unitLanyardCost ?? "") });
  const computed = f.quantity && f.unitCost ? Math.round(Number(f.quantity) * Number(f.unitCost)) : 0;
  const keys = Object.keys(ISIC_COST_LABEL) as IsicCostKey[];
  return (
    <section className="surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink">Coûts du lot</h2>
          <p className="text-xs text-ink2">Prévu : coûts par carte × {batch.totalCards} cartes. Réel : licences réglées et dépenses saisies ci-dessous.</p>
        </div>
        {canEdit && (
          <div className="flex items-end gap-2 text-xs">
            <label className="text-ink3">Impression / carte<input type="number" min={0} className="block w-28 p-1.5 border border-line rounded-lg text-sm" value={units.print} onChange={e => setUnits(u => ({ ...u, print: e.target.value }))} /></label>
            <label className="text-ink3">Tour de cou / carte<input type="number" min={0} className="block w-28 p-1.5 border border-line rounded-lg text-sm" value={units.lanyard} onChange={e => setUnits(u => ({ ...u, lanyard: e.target.value }))} /></label>
            <button onClick={() => onPatch({ unitPrintCost: Number(units.print) || 0, unitLanyardCost: Number(units.lanyard) || 0 })} className="px-3 h-9 rounded-lg border border-line2 text-sm font-semibold hover:bg-surface2">Enregistrer</button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
      <table className="table-dense w-full">
        <thead><tr className="text-left text-ink2"><th>Poste</th><th className="text-right">Prévu</th><th className="text-right">Réel</th></tr></thead>
        <tbody>
          {keys.map(k => (
            <tr key={k} className="border-t border-line">
              <td className="text-sm">{ISIC_COST_LABEL[k]}</td>
              <td className="text-right font-mono">{fin.planned[k] ? fmt(fin.planned[k]) : "—"}</td>
              <td className="text-right font-mono">{fin.actual[k] ? fmt(fin.actual[k]) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold"><td>Total des coûts</td><td className="text-right font-mono">{fmt(fin.plannedTotal)}</td><td className="text-right font-mono">{fmt(fin.actualTotal)}</td></tr>
          <tr className="font-semibold"><td>Marge (revente {fmt(fin.sale)})</td><td className={`text-right font-mono ${fin.plannedMargin < 0 ? "text-neg" : "text-pos"}`}>{fmt(fin.plannedMargin)}</td><td className="text-right font-mono text-ink3 text-xs">à terminaison {fmt(fin.forecastMargin)}</td></tr>
        </tfoot>
      </table></div>

      {(batch.costs ?? []).length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {(batch.costs ?? []).map(c => (
            <li key={c._id} className="flex items-center justify-between py-1.5 gap-2">
              <span><b className="text-ink">{fmt(c.amount)}</b> · {ISIC_COST_LABEL[c.category as IsicCostKey] ?? c.category} — {c.label}
                {c.quantity && c.unitCost ? <span className="text-ink3"> ({c.quantity} × {fmt(c.unitCost)})</span> : null}
                {c.supplier && <span className="text-ink3"> · {c.supplier}</span>}
                <span className="text-ink3"> · {new Date(c.date).toLocaleDateString("fr-FR")}</span></span>
              {canDelete && <button onClick={() => onDelete(c._id)} className="text-ink3 hover:text-neg" aria-label="Retirer"><Trash2 size={13} /></button>}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-2 items-end">
          <label className="text-[11px] text-ink3 col-span-2 lg:col-span-1">Poste
            <select className="w-full p-2 border border-line rounded-lg text-sm" value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))} title={COST_CATEGORIES.find(c => c.key === f.category)?.hint}>
              {COST_CATEGORIES.map(c => <option key={c.key} value={c.key}>{ISIC_COST_LABEL[c.key]}</option>)}
            </select></label>
          <label className="text-[11px] text-ink3 col-span-2">Libellé<input className="w-full p-2 border border-line rounded-lg text-sm" value={f.label} placeholder="Ex. impression 1 200 cartes" onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></label>
          <label className="text-[11px] text-ink3">Quantité<input type="number" min={0} className="w-full p-2 border border-line rounded-lg text-sm" value={f.quantity} onChange={e => setF(x => ({ ...x, quantity: e.target.value }))} /></label>
          <label className="text-[11px] text-ink3">Coût unitaire<input type="number" min={0} className="w-full p-2 border border-line rounded-lg text-sm" value={f.unitCost} onChange={e => setF(x => ({ ...x, unitCost: e.target.value }))} /></label>
          <label className="text-[11px] text-ink3">Montant{computed ? ` (= ${fmt(computed)})` : ""}<input type="number" min={0} className="w-full p-2 border border-line rounded-lg text-sm" value={f.amount} placeholder={computed ? String(computed) : ""} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} /></label>
          <button onClick={() => onAdd({ ...f, amount: f.amount || (computed || "") }, () => setF(empty))} className="h-9 rounded-lg bg-ink text-onink text-sm font-semibold">Ajouter</button>
          <label className="text-[11px] text-ink3 col-span-2 lg:col-span-2">Fournisseur<input className="w-full p-2 border border-line rounded-lg text-sm" value={f.supplier} onChange={e => setF(x => ({ ...x, supplier: e.target.value }))} /></label>
          <label className="text-[11px] text-ink3">Date<input type="date" className="w-full p-2 border border-line rounded-lg text-sm" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></label>
        </div>
      )}
    </section>
  );
}
