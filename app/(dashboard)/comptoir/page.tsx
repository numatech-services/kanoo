"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Wallet, Package, AlertTriangle, ArrowDownLeft, ArrowUpRight, Trash2, RotateCcw, Coins } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";

interface Desk { _id: string; name: string; description?: string }
interface Item { _id: string; name: string; unit: string; quantity: number; unitCost: number; salePrice?: number; threshold?: number }
interface CashEntry { _id: string; direction: "in" | "out"; amount: number; label: string; method: string; date: string }
interface Move { _id: string; type: "in" | "out" | "adjust"; quantity: number; quantityAfter: number; reason?: string; date: string; itemId?: { name?: string; unit?: string } }
interface Summary { itemCount: number; stockValue: number; lowStock: { name: string; unit: string; quantity: number; threshold?: number }[]; cashIn: number; cashOut: number; cashBalance: number }

const MONEY = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} XOF`;
const METHOD_LABEL: Record<string, string> = {
  cash: "Espèces", bank_transfer: "Virement", orange_money: "OM / Moov", card: "Carte", check: "Chèque", other: "Autre",
};

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}
async function post(url: string, body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Opération refusée");
  return res.status === 204 ? null : res.json();
}

export default function ComptoirPage() {
  const [desks, setDesks] = useState<Desk[]>([]);
  const [deskId, setDeskId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"caisse" | "stock">("caisse");
  const [newDeskOpen, setNewDeskOpen] = useState(false);

  const loadDesks = useCallback(() => {
    fetch("/api/comptoir/desks", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const list: Desk[] = d.data || [];
        setDesks(list);
        setDeskId(prev => prev || list[0]?._id || "");
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadDesks(); }, [loadDesks]);

  if (loading) return <div className="h-64 surface-card animate-pulse" />;

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Store size={22} /> Comptoir d&apos;activité</h1>
          <p className="text-sm text-ink2">
            Comptabilité matière (stock d&apos;articles) et caisse (recettes / dépenses) d&apos;un point d&apos;activité — The Spot et autres.
          </p>
        </div>
        <button onClick={() => setNewDeskOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau comptoir
        </button>
      </div>

      {desks.length === 0 ? (
        <EmptyState icon={<Store size={20} />} title="Aucun comptoir"
          hint="Lancez une activité (par ex. « The Spot ») avec le bouton « Nouveau comptoir » pour suivre son stock et sa caisse." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <FormField label="Comptoir">
              <select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>
                {desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            </FormField>
          </div>

          {deskId && <DeskView key={deskId} deskId={deskId} tab={tab} setTab={setTab} />}
        </>
      )}

      {newDeskOpen && <NewDeskDialog onClose={() => setNewDeskOpen(false)} onSaved={(id) => { setNewDeskOpen(false); setDeskId(id); loadDesks(); }} />}
    </div>
  );
}

function NewDeskDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState("The Spot");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      const d = await post("/api/comptoir/desks", { name, description });
      onSaved(d.data._id);
    } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nouveau comptoir" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Nom de l'activité" required>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="The Spot" />
        </FormField>
        <FormField label="Description" hint="Facultative">
          <input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Création…" : "Lancer le comptoir"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeskView({ deskId, tab, setTab }: { deskId: string; tab: "caisse" | "stock"; setTab: (t: "caisse" | "stock") => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const reloadSummary = useCallback(() => {
    fetch(`/api/comptoir/summary?deskId=${deskId}`, { credentials: "include" })
      .then(r => r.json()).then(d => setSummary(d.data)).catch(() => {});
  }, [deskId]);
  useEffect(() => { reloadSummary(); }, [reloadSummary]);

  const tabCls = (active: boolean) =>
    `px-4 h-10 inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
      active ? "bg-section text-white" : "text-ink2 hover:bg-surface2 border border-line2"}`;

  return (
    <div className="space-y-5">
      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard icon={<Wallet size={18} />} label="Solde de caisse" value={MONEY(summary?.cashBalance ?? 0)} tone="section" />
        <SummaryCard icon={<Coins size={18} />} label="Valeur du stock" value={MONEY(summary?.stockValue ?? 0)} />
        <SummaryCard icon={<Package size={18} />} label="Articles" value={String(summary?.itemCount ?? 0)} />
        <SummaryCard icon={<AlertTriangle size={18} />} label="Sous le seuil" value={String(summary?.lowStock?.length ?? 0)}
          tone={summary?.lowStock?.length ? "warn" : undefined} />
      </div>

      {summary?.lowStock && summary.lowStock.length > 0 && (
        <div className="px-4 py-3 bg-warn-50 border border-warn/25 rounded-xl text-sm text-warn">
          <span className="font-semibold">Réapprovisionnement conseillé : </span>
          {summary.lowStock.map(l => `${l.name} (${l.quantity} ${l.unit})`).join(", ")}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className={tabCls(tab === "caisse")} onClick={() => setTab("caisse")}><Wallet size={16} /> Caisse</button>
        <button className={tabCls(tab === "stock")} onClick={() => setTab("stock")}><Package size={16} /> Stock matière</button>
      </div>

      {tab === "caisse"
        ? <CaisseTab deskId={deskId} onChange={reloadSummary} />
        : <StockTab deskId={deskId} onChange={reloadSummary} />}
    </div>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "section" | "warn" }) {
  const color = tone === "section" ? "text-section" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="surface-card p-4">
      <div className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink2`}>{icon} {label}</div>
      <p className={`mt-1.5 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ── Caisse (argent) ──────────────────────────────────────────────────────────
function CaisseTab({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/comptoir/cash?deskId=${deskId}`, { credentials: "include" })
      .then(r => r.json()).then(d => setEntries(d.data || [])).catch(() => {});
  }, [deskId]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!confirm("Supprimer cette écriture de caisse ?")) return;
    await post(`/api/comptoir/cash/${id}`, null, "DELETE");
    load(); onChange();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="px-4 h-9 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={15} /> Écriture de caisse
        </button>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title="Caisse vide" hint="Enregistrez une recette ou une dépense." />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="table-dense">
            <thead><tr><th>Date</th><th>Libellé</th><th>Moyen</th><th>Sens</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e._id}>
                  <td className="text-ink2 whitespace-nowrap">{new Date(e.date).toLocaleDateString("fr-FR")}</td>
                  <td className="text-ink font-medium">{e.label}</td>
                  <td className="text-ink2">{METHOD_LABEL[e.method] || e.method}</td>
                  <td>{e.direction === "in"
                    ? <Pill tone="pos"><ArrowDownLeft size={11} className="inline mr-0.5" /> Recette</Pill>
                    : <Pill tone="neg"><ArrowUpRight size={11} className="inline mr-0.5" /> Dépense</Pill>}</td>
                  <td className={`text-right font-mono font-bold ${e.direction === "in" ? "text-pos" : "text-neg"}`}>
                    {e.direction === "in" ? "+" : "−"}{MONEY(e.amount)}
                  </td>
                  <td className="text-right">
                    <button onClick={() => del(e._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <CashDialog deskId={deskId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); onChange(); }} />}
    </div>
  );
}

function CashDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ direction: "in" as "in" | "out", amount: "", label: "", method: "cash", date: new Date().toISOString().split("T")[0] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!form.label.trim()) { setError("Le libellé est requis."); return; }
    if (!(Number(form.amount) > 0)) { setError("Montant invalide."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/cash", { deskId, ...form, amount: Number(form.amount) });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Écriture de caisse" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setForm(f => ({ ...f, direction: "in" }))}
            className={`h-11 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 ${form.direction === "in" ? "border-pos bg-pos-50 text-pos" : "border-line2 text-ink2 hover:bg-surface2"}`}>
            <ArrowDownLeft size={16} /> Recette
          </button>
          <button type="button" onClick={() => setForm(f => ({ ...f, direction: "out" }))}
            className={`h-11 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 ${form.direction === "out" ? "border-neg bg-neg-50 text-neg" : "border-line2 text-ink2 hover:bg-surface2"}`}>
            <ArrowUpRight size={16} /> Dépense
          </button>
        </div>
        <FormField label="Libellé" required>
          <input className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex. Vente boissons, achat glace…" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant (XOF)" required>
            <input className={inputCls} type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </FormField>
          <FormField label="Moyen">
            <select className={selectCls} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Date">
          <input className={inputCls} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Stock matière ────────────────────────────────────────────────────────────
function StockTab({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [moveFor, setMoveFor] = useState<Item | null>(null);

  const load = useCallback(() => {
    fetch(`/api/comptoir/items?deskId=${deskId}`, { credentials: "include" }).then(r => r.json()).then(d => setItems(d.data || [])).catch(() => {});
    fetch(`/api/comptoir/stock?deskId=${deskId}`, { credentials: "include" }).then(r => r.json()).then(d => setMoves(d.data || [])).catch(() => {});
  }, [deskId]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!confirm("Supprimer cet article ? Son historique de mouvements reste conservé.")) return;
    await post(`/api/comptoir/items/${id}`, null, "DELETE");
    load(); onChange();
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => setItemOpen(true)} className="px-4 h-9 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={15} /> Nouvel article
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Package size={20} />} title="Aucun article" hint="Ajoutez un article pour suivre son stock (entrées, sorties, ventes)." />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="table-dense">
            <thead><tr><th>Article</th><th className="text-right">Stock</th><th className="text-right">Coût unit.</th><th className="text-right">Valeur</th><th className="text-center">Mouvement</th><th></th></tr></thead>
            <tbody>
              {items.map(it => {
                const low = it.threshold != null && it.quantity <= it.threshold;
                return (
                  <tr key={it._id}>
                    <td className="text-ink font-medium">{it.name}
                      {low && <span className="ml-2"><Pill tone="warn">seuil</Pill></span>}
                    </td>
                    <td className="text-right font-mono">{it.quantity} <span className="text-ink3 text-xs">{it.unit}</span></td>
                    <td className="text-right font-mono text-ink2">{MONEY(it.unitCost)}</td>
                    <td className="text-right font-mono font-semibold">{MONEY(it.quantity * it.unitCost)}</td>
                    <td className="text-center">
                      <button onClick={() => setMoveFor(it)} className="px-3 h-8 rounded-lg border border-line2 text-xs font-semibold text-ink2 hover:bg-surface2 inline-flex items-center gap-1">
                        <RotateCcw size={13} /> Entrée / Sortie
                      </button>
                    </td>
                    <td className="text-right">
                      <button onClick={() => del(it._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {moves.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-ink mb-2">Derniers mouvements</h3>
          <div className="surface-card overflow-hidden">
            <table className="table-dense">
              <thead><tr><th>Date</th><th>Article</th><th>Type</th><th className="text-right">Qté</th><th className="text-right">Stock après</th><th>Motif</th></tr></thead>
              <tbody>
                {moves.slice(0, 30).map(m => (
                  <tr key={m._id}>
                    <td className="text-ink2 whitespace-nowrap">{new Date(m.date).toLocaleDateString("fr-FR")}</td>
                    <td className="text-ink">{m.itemId?.name || "—"}</td>
                    <td>{m.type === "in" ? <Pill tone="pos">Entrée</Pill> : m.type === "out" ? <Pill tone="neg">Sortie</Pill> : <Pill tone="info">Ajustement</Pill>}</td>
                    <td className="text-right font-mono">{m.quantity}</td>
                    <td className="text-right font-mono text-ink2">{m.quantityAfter}</td>
                    <td className="text-ink2">{m.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {itemOpen && <ItemDialog deskId={deskId} onClose={() => setItemOpen(false)} onSaved={() => { setItemOpen(false); load(); onChange(); }} />}
      {moveFor && <MoveDialog deskId={deskId} item={moveFor} onClose={() => setMoveFor(null)} onSaved={() => { setMoveFor(null); load(); onChange(); }} />}
    </div>
  );
}

function ItemDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", unit: "unité", quantity: "", unitCost: "", salePrice: "", threshold: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!form.name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/items", {
        deskId, name: form.name, unit: form.unit,
        quantity: Number(form.quantity) || 0, unitCost: Number(form.unitCost) || 0,
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
        threshold: form.threshold ? Number(form.threshold) : undefined,
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nouvel article" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Nom de l'article" required>
          <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unité"><input className={inputCls} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></FormField>
          <FormField label="Stock initial"><input className={inputCls} type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></FormField>
          <FormField label="Coût unitaire (XOF)"><input className={inputCls} type="number" min="0" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} /></FormField>
          <FormField label="Prix de vente (XOF)" hint="Indicatif"><input className={inputCls} type="number" min="0" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} /></FormField>
          <FormField label="Seuil d'alerte" hint="Facultatif"><input className={inputCls} type="number" min="0" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} /></FormField>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Enregistrement…" : "Ajouter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MoveDialog({ deskId, item, onClose, onSaved }: { deskId: string; item: Item; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"in" | "out" | "adjust">("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [withCash, setWithCash] = useState(true);
  const [cashAmount, setCashAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pré-remplit l'encaissement d'une vente à partir du prix de vente indicatif.
  useEffect(() => {
    if (type === "out" && item.salePrice && quantity) setCashAmount(String(item.salePrice * Number(quantity)));
  }, [type, quantity, item.salePrice]);

  async function save() {
    if (!(Number(quantity) > 0)) { setError("Quantité invalide."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/stock", {
        deskId, itemId: item._id, type, quantity: Number(quantity), reason,
        ...(type === "out" && withCash && Number(cashAmount) > 0 ? { cashAmount: Number(cashAmount), cashMethod: "cash" } : {}),
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }

  const typeBtn = (t: "in" | "out" | "adjust", label: string) => (
    <button type="button" onClick={() => setType(t)}
      className={`h-10 rounded-lg border text-sm font-semibold ${type === t ? "border-section bg-section/10 text-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={`Mouvement — ${item.name}`} size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <p className="text-sm text-ink2">Stock actuel : <span className="font-semibold text-ink">{item.quantity} {item.unit}</span></p>
        <div className="grid grid-cols-3 gap-2">
          {typeBtn("in", "Entrée")}{typeBtn("out", "Sortie / vente")}{typeBtn("adjust", "Ajustement")}
        </div>
        <FormField label={type === "adjust" ? "Nouveau stock" : "Quantité"} required>
          <input className={inputCls} type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
        </FormField>
        {type === "out" && (
          <div className="rounded-xl border border-section/25 bg-section/5 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={withCash} onChange={e => setWithCash(e.target.checked)} />
              Encaisser la vente en caisse
            </label>
            {withCash && (
              <FormField label="Montant encaissé (XOF)">
                <input className={inputCls} type="number" min="0" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <FormField label="Motif" hint="Facultatif">
          <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="Réapprovisionnement, vente, casse…" />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Enregistrement…" : "Valider le mouvement"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
