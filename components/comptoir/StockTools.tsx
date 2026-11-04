"use client";
import { useState } from "react";
import { ShoppingCart, ClipboardCheck, AlertTriangle, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";
import { LOSS_REASONS } from "@/lib/spot";

const MONEY = (n: number | undefined) => (n === undefined ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const h = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface ReorderLine { itemId: string; name: string; unit: string; stock: number; dailyAverage: number; daysLeft: number | null; quantity: number; packs: number | null; packLabel?: string; urgent: boolean; estimatedCost?: number; linked: boolean; supplier: { _id: string; name: string } | null }
interface Plan { leadDays: number; coverDays: number; windowDays: number; basis?: "schedule" | "history"; lines: ReorderLine[]; totalCost?: number }

/**
 * Réassort conseillé : ventes moyennes des 28 derniers jours, jours de stock
 * restants, quantité à commander (en paquets entiers) pour couvrir le délai
 * de livraison et la période choisie. Un clic crée les bons de commande par
 * fournisseur ; les achats au marché forment une liste de courses.
 */
export function ReorderDialog({ deskId, onClose }: { deskId: string; onClose: () => void }) {
  const { data } = useApi<Plan | null>(`/api/comptoir/reorder?deskId=${deskId}`, d => d?.data ?? null, null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lines = (data?.lines ?? []).filter(l => l.quantity > 0 || l.urgent);
  const q = (l: ReorderLine) => (qty[l.itemId] !== undefined ? Number(qty[l.itemId]) || 0 : l.quantity);

  async function order() {
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/reorder", { deskId, lines: lines.map(l => ({ itemId: l.itemId, quantity: q(l) })).filter(l => l.quantity > 0) });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Commande refusée.", "error"); return; }
    const r = res.data.data as { orders: Array<{ number: string }>; shopping: Array<{ name: string; quantity: number }>; noSupplier: string[] };
    showToast(`${r.orders.length} bon(s) de commande brouillon créé(s)${r.orders.length ? ` : ${r.orders.map(o => o.number).join(", ")}` : ""}.`, "success");
    if (r.noSupplier.length) showToast(`Sans fournisseur habituel (fiche article) : ${r.noSupplier.join(", ")}.`, "warning");
    if (r.shopping.length) printShopping(r.shopping);
    onClose();
  }
  function printShopping(list: Array<{ name: string; quantity: number }>) {
    const rows = list.map(l => `<tr><td>☐ ${h(l.name)}</td><td style="text-align:right">${h(l.quantity)}</td></tr>`).join("");
    const w = window.open("", "_blank");
    if (w) { w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Liste de courses</title><style>body{font-family:system-ui,Arial;padding:24px}td{padding:6px;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse}</style></head><body><h1>Liste de courses du comptoir</h1><p>${new Date().toLocaleDateString("fr-FR")}</p><table>${rows}</table></body></html>`); w.document.close(); w.print(); }
  }

  return (
    <Modal open onClose={onClose} title="Réassort conseillé" size="lg">
      {!data ? <p className="text-sm text-ink3">Calcul…</p> : (
        <div className="space-y-4">
          <p className="text-sm text-ink2">{data.basis === "schedule"
            ? `Demande prévue d'après l'emploi du temps du campus (cours, vacances, examens) sur les ${data.leadDays + data.coverDays} prochains jours`
            : `Ventes des ${data.windowDays} derniers jours`} · livraison en {data.leadDays} j · commande pour {data.coverDays} j (réglable dans les paramètres du comptoir).</p>
          {lines.length === 0 ? <p className="text-sm text-pos">Stock suffisant : rien à commander.</p> : (
            <div className="overflow-x-auto"><table className="table-dense">
              <thead><tr><th>Article</th><th className="text-right">Stock</th><th className="text-right">Vente/jour</th><th className="text-right">Jours restants</th><th className="text-right">À commander</th>{data.totalCost !== undefined && <th className="text-right">Coût estimé</th>}<th>Où</th></tr></thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.itemId}>
                    <td className="text-ink">{l.name} {l.urgent && <Pill tone="neg">rupture avant livraison</Pill>}</td>
                    <td className="text-right font-mono">{l.stock} {l.unit}</td>
                    <td className="text-right font-mono">{l.dailyAverage}</td>
                    <td className="text-right font-mono">{l.daysLeft ?? "—"}</td>
                    <td className="text-right"><input type="number" min={0} className="w-24 h-8 px-2 rounded border border-line2 text-right font-mono" value={qty[l.itemId] ?? String(l.quantity)} onChange={e => setQty(p => ({ ...p, [l.itemId]: e.target.value }))} />{l.packs ? <span className="block text-[11px] text-ink3">{l.packs} {l.packLabel || "paquet"}(s)</span> : null}</td>
                    {data.totalCost !== undefined && <td className="text-right font-mono text-ink2">{MONEY(l.estimatedCost)}</td>}
                    <td className="text-xs text-ink2">{l.linked ? l.supplier?.name ?? <span className="text-warn">fournisseur à renseigner</span> : "Liste de courses"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button>
            {lines.length > 0 && <button disabled={busy} onClick={order} className={buttonClass("primary", "md")}><ShoppingCart size={15} /> Créer les commandes et la liste de courses</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

interface CountItem { itemId: string; name: string; unit: string; counted: { expected: number; counted: number; gap: number; gapValue?: number } | null; lastCounted: string | null }

/**
 * Inventaire tournant : quelques articles à compter chaque jour (jamais
 * comptés, à forte valeur ou rotation, ou touchés par des pertes). La
 * quantité théorique n'est pas montrée : on compte, Kanoo calcule l'écart.
 */
export function CycleCountPanel({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const { data, reload } = useApi<{ day: string; items: CountItem[]; doneToday: number } | null>(`/api/comptoir/cycle-count?deskId=${deskId}`, d => d?.data ?? null, null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!data || data.items.length === 0) return null;
  const todo = data.items.filter(i => !i.counted);
  async function save() {
    const counts = todo.filter(i => values[i.itemId] !== undefined && values[i.itemId] !== "").map(i => ({ itemId: i.itemId, counted: Number(values[i.itemId]) }));
    if (!counts.length) return;
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/cycle-count", { deskId, counts });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Comptage refusé.", "error"); return; }
    const gaps = (res.data.data.results as Array<{ name: string; gap: number }>).filter(r => r.gap !== 0);
    showToast(gaps.length ? `Écarts : ${gaps.map(g => `${g.name} ${g.gap > 0 ? "+" : ""}${g.gap}`).join(", ")}` : "Comptage juste.", gaps.length ? "warning" : "success");
    setValues({}); reload(); onChange();
  }
  return (
    <section className="surface-card p-4 space-y-3">
      <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><ClipboardCheck size={15} /> Inventaire du jour ({data.items.length} article(s))</h3>
      <div className="grid sm:grid-cols-2 gap-2">
        {data.items.map(i => (
          <div key={i.itemId} className="flex items-center justify-between gap-2 border border-line rounded-lg px-3 py-2">
            <span className="text-sm text-ink">{i.name}<span className="block text-[11px] text-ink3">{i.lastCounted ? `compté le ${new Date(`${i.lastCounted}T12:00:00`).toLocaleDateString("fr-FR")}` : "jamais compté"}</span></span>
            {i.counted
              ? <span className={`text-sm font-mono ${i.counted.gap < 0 ? "text-neg" : i.counted.gap > 0 ? "text-warn" : "text-pos"}`}>{i.counted.counted} {i.unit}{i.counted.gap ? ` (${i.counted.gap > 0 ? "+" : ""}${i.counted.gap}${i.counted.gapValue !== undefined ? `, ${MONEY(i.counted.gapValue)}` : ""})` : " ✓"}</span>
              : <input type="number" min={0} step="any" placeholder={i.unit} className="w-24 h-9 px-2 rounded border border-line2 text-right font-mono" value={values[i.itemId] ?? ""} onChange={e => setValues(p => ({ ...p, [i.itemId]: e.target.value }))} aria-label={`Compté — ${i.name}`} />}
          </div>
        ))}
      </div>
      {todo.length > 0 && <div className="flex justify-end"><button disabled={busy} onClick={save} className={buttonClass("primary", "sm")}>Enregistrer le comptage</button></div>}
    </section>
  );
}

/** Perte, casse, offert, consommation du personnel : sortie de stock motivée et chiffrée. */
export function LossDialog({ deskId, item, onClose, onDone }: { deskId: string; item: { _id: string; name: string; unit: string; quantity: number }; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [f, setF] = useState({ quantity: "", reason: "broken", note: "", employeeId: "" });
  const [busy, setBusy] = useState(false);
  // Repas du personnel : rattaché au collaborateur (avantage en nature sur son bulletin).
  const { data: team } = useApi<Array<{ employeeId: string; name: string }>>(f.reason === "staff" ? `/api/restauration/planning?deskId=${deskId}` : null, d => ((d?.data as { team?: Array<{ employeeId: string; name: string }> })?.team ?? []), [], { quiet: true });
  async function save() {
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/losses", { deskId, itemId: item._id, quantity: Number(f.quantity), reason: f.reason, note: f.note || undefined, employeeId: f.reason === "staff" && f.employeeId ? f.employeeId : undefined }, op.headers());
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Déclaration refusée.", "error"); return; }
    op.done();
    const v = res.data.data.lossValue;
    showToast(`Perte enregistrée${v !== undefined ? ` (${MONEY(v)} au coût)` : ""}.`, "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Perte — ${item.name}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ink2 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Stock actuel : {item.quantity} {item.unit}. La perte compte dans la marge de la semaine.</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quantité" required><input type="number" min={0} step="any" className={inputCls} value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} /></FormField>
          <FormField label="Motif"><select className={selectCls} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))}>{Object.entries(LOSS_REASONS).filter(([k]) => k !== "inventory").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        </div>
        {f.reason === "staff" && (
          <FormField label="Collaborateur (facultatif)" hint="Le repas compte dans ses avantages en nature du mois.">
            <select className={selectCls} value={f.employeeId} onChange={e => setF(p => ({ ...p, employeeId: e.target.value }))}>
              <option value="">— Non nominatif —</option>
              {team.map(t => <option key={t.employeeId} value={t.employeeId}>{t.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField label="Précision (facultatif)"><input className={inputCls} maxLength={120} value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} /></FormField>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || !(Number(f.quantity) > 0)} onClick={save} className={buttonClass("primary", "md")}><Trash2 size={14} /> Déclarer</button></div>
      </div>
    </Modal>
  );
}

