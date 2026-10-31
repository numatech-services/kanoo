"use client";
import { csvCell } from "@/lib/csv";

import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Wallet, Receipt, CalendarCheck2, Percent, BookUser, Tag, Zap, Smartphone, ShoppingCart, GraduationCap, PlugZap, Package, AlertTriangle, ArrowDownLeft, ArrowUpRight, Trash2, RotateCcw, Coins, Download, FileText, Settings2, Scale } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { FlowFilterBar, useFlowFilter, monthStart, today, type FlowTotals } from "@/components/ui/FlowFilterBar";
import { useMe, meCanDo } from "@/lib/useMe";
import { urlParam } from "@/lib/url-param";
import { LotsEditor, lotsPayload, type LotRow } from "@/components/stock/LotsEditor";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { MetricCard, PillTabs } from "@/components/ui/MetricCard";
import { csrfToken as getCsrfToken, apiJson } from "@/lib/api-client";
import { SalesTab } from "@/components/comptoir/SalesTab";
import { CreditTab } from "@/components/comptoir/CreditTab";
import { PromosTab } from "@/components/comptoir/PromosTab";
import { PlanningTab } from "@/components/comptoir/PlanningTab";
import { EasypayTab } from "@/components/comptoir/EasypayTab";
import { ReorderDialog, CycleCountPanel, LossDialog } from "@/components/comptoir/StockTools";
import { MomoDialog } from "@/components/comptoir/SpotControls";
import Link from "next/link";
import { SessionTab } from "@/components/comptoir/SessionTab";
import { ProfitabilityTab } from "@/components/comptoir/ProfitabilityTab";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { itemEconomics } from "@/lib/comptoir-economics";
import { ClosingDialog } from "@/components/comptoir/ClosingDialog";
import { StockLevels, ReceiveDialog, LevelMoveDialog, StockItemDialog, ReserveLossDialog, type ReserveData, type StockRow } from "@/components/comptoir/RestaurantStock";
import { InventoryPanel } from "@/components/comptoir/InventoryPanel";
import { ResultTab } from "@/components/comptoir/ResultTab";
interface Desk { _id: string; name: string; description?: string; activityId?: string; treasuryAccountId?: string; revenueAccount?: string; expenseAccount?: string; vatRate?: number; targetMarkup?: number;
  leadDays?: number; coverDays?: number; weeklyRevenueTarget?: number; weeklyMarginTarget?: number; cycleCountSize?: number }
interface Item { _id: string; name: string; unit: string; quantity: number; unitCost: number | null; category?: string; pack?: { label?: string; size?: number; cost?: number }; salePrice?: number; threshold?: number; productId?: { _id: string; code: string; label: string; trackingMode?: string } | null }
interface CashEntry { _id: string; direction: "in" | "out"; amount: number; label: string; method: string; date: string; saleId?: string; category?: string }
interface Move { _id: string; type: "in" | "out" | "adjust" | "supply" | "return"; quantity: number; quantityAfter: number; reason?: string; date: string; itemId?: { name?: string; unit?: string } }
interface Summary { itemCount: number; stockValue: number | null; lowStock: { name: string; unit: string; quantity: number; threshold?: number }[]; cashIn: number; cashOut: number; cashBalance: number }

// Jour civil LOCAL (AAAA-MM-JJ) : toISOString() donnerait le jour UTC, et une
// vente passée juste après minuit tomberait sur la veille.
function localDay(d: Date | string = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

const MONEY = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
const METHOD_LABEL: Record<string, string> = {
  cash: "Espèces", bank_transfer: "Virement", orange_money: "OM / Moov", card: "Carte", check: "Chèque", other: "Autre",
};

async function csrf() {
  const csrfToken = await getCsrfToken();
  return csrfToken as string;
}

// Export CSV côté client (séparateur « ; », compatible Excel FR ; BOM UTF-8).
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = csvCell;
  const csv = "﻿" + rows.map(r => r.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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

type Tab = "tickets" | "semaine" | "caisse" | "stock" | "rentabilite" | "resultat" | "ardoises" | "promos" | "planning" | "easypay";
const TAB_KEYS: Tab[] = ["tickets", "semaine", "caisse", "stock", "rentabilite", "resultat", "ardoises", "promos", "planning", "easypay"];

export default function ComptoirPage() {
  const [desks, setDesks] = useState<Desk[]>([]);
  const [deskId, setDeskId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  // Lien d'une notification : /comptoir?desk=…&tab=rentabilite ouvre le bon comptoir sur le bon onglet.
  const [tab, setTab] = useState<Tab>(() => (TAB_KEYS.includes(urlParam("tab") as Tab) ? urlParam("tab") as Tab : "tickets"));
  const [newDeskOpen, setNewDeskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadDesks = useCallback(() => {
    apiJson("/api/comptoir/desks")
      .then(d => {
        const list: Desk[] = d.data || [];
        setDesks(list);
        // Garde le comptoir courant s'il existe encore (il a pu être archivé).
        setDeskId(prev => (prev && list.some(d => d._id === prev)) ? prev : list.some(d => d._id === urlParam("desk")) ? urlParam("desk") : (list[0]?._id || ""));
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadDesks(); }, [loadDesks]);

  if (loading) return <div className="h-64 surface-card animate-pulse" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Comptoir · stock et caisse</p>
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1 truncate">{desks.find(d => d._id === deskId)?.name ?? "Comptoirs"}</h1>
          <p className="text-sm text-ink2 mt-1">Comptabilité matière et caisse d&apos;un point d&apos;activité — ventes, stock, ardoises, promotions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deskId && (
            <button onClick={() => setSettingsOpen(true)} className="h-11 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
              <Settings2 size={16} /> Paramètres
            </button>
          )}
          <button onClick={() => setNewDeskOpen(true)} className="h-11 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
            <Plus size={16} /> Nouveau comptoir
          </button>
          {/* Vendre d'abord : en tête et pleine largeur sur téléphone. */}
          {deskId && (
            <Link href={`/comptoir/rapide?deskId=${deskId}`} className="order-first sm:order-last w-full sm:w-auto justify-center h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105">
              <Zap size={17} /> Caisse rapide
            </Link>
          )}
        </div>
      </div>

      {desks.length === 0 ? (
        <EmptyState icon={<Store size={20} />} title="Aucun comptoir"
          hint="Lancez une activité (par ex. « The Spot ») avec le bouton « Nouveau comptoir » pour suivre son stock et sa caisse." />
      ) : (
        <>
          {/* Plusieurs comptoirs : on passe de l'un à l'autre en un clic. */}
          {desks.length > 1 && (
            <PillTabs label="Comptoirs" value={deskId} onChange={setDeskId}
              tabs={desks.map(d => ({ key: d._id, label: d.name, icon: <Store size={15} /> }))} />
          )}

          {deskId && !desks.find(d => d._id === deskId)?.treasuryAccountId && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-warn/30 bg-warn-50 text-sm text-warn">
              <span>Caisse hors comptabilité : ses ventes et dépenses n&apos;apparaissent ni au compte de résultat ni en trésorerie.</span>
              <button onClick={() => setSettingsOpen(true)} className="h-9 px-3.5 rounded-full border border-warn/40 bg-surface text-[13px] font-semibold text-warn hover:bg-warn-50">Relier à une caisse</button>
            </div>
          )}
          {deskId && <DeskView key={deskId} deskId={deskId} deskName={desks.find(d => d._id === deskId)?.name ?? "Comptoir"} tab={tab} setTab={setTab} />}
        </>
      )}

      {settingsOpen && desks.find(d => d._id === deskId) && (
        <DeskSettingsDialog desk={desks.find(d => d._id === deskId)!}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setSettingsOpen(false); loadDesks(); }} />
      )}
      {newDeskOpen && <NewDeskDialog onClose={() => setNewDeskOpen(false)} onSaved={(id) => { setNewDeskOpen(false); setDeskId(id); loadDesks(); }} />}
    </div>
  );
}

function NewDeskDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState("The Spot");
  const [description, setDescription] = useState("");
  const [activityId, setActivityId] = useState("");
  // Secteurs analytiques — proposés seulement si l'utilisateur y a accès.
  const sectors = useSectors();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      const d = await post("/api/comptoir/desks", { name, description, activityId: activityId || undefined });
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
        {sectors.length > 0 && (
          <FormField label="Secteur analytique lié" hint="Sa caisse remontera dans « Rentabilité par secteur ».">
            <select className={selectCls} value={activityId} onChange={e => setActivityId(e.target.value)}>
              <option value="">— Aucun (frais généraux) —</option>
              {sectors.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </FormField>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
            {saving ? "Création…" : "Lancer le comptoir"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Secteurs analytiques visibles par l'utilisateur (vide s'il n'y a pas accès).
function useSectors() {
  const [sectors, setSectors] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    fetch("/api/comptoir/catalog", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.data?.sectors && setSectors(d.data.sectors))
      .catch(() => {});
  }, []);
  return sectors;
}

function DeskSettingsDialog({ desk, onClose, onSaved }: { desk: Desk; onClose: () => void; onSaved: () => void }) {
  const sectors = useSectors();
  const [name, setName] = useState(desk.name);
  const [description, setDescription] = useState(desk.description || "");
  const [activityId, setActivityId] = useState(desk.activityId ? String(desk.activityId) : "");
  const [treasuryAccountId, setTreasuryAccountId] = useState(desk.treasuryAccountId ? String(desk.treasuryAccountId) : "");
  const [revenueAccount, setRevenueAccount] = useState(desk.revenueAccount || "701100");
  const [expenseAccount, setExpenseAccount] = useState(desk.expenseAccount || "601100");
  const [vatRate, setVatRate] = useState(desk.vatRate ?? 0);
  const [targetMarkup, setTargetMarkup] = useState(String(Math.round((desk.targetMarkup ?? 0.3) * 100)));
  const [ops, setOps] = useState({ leadDays: String(desk.leadDays ?? 2), coverDays: String(desk.coverDays ?? 7), weeklyRevenueTarget: String(desk.weeklyRevenueTarget ?? ""), weeklyMarginTarget: String(desk.weeklyMarginTarget ?? ""), cycleCountSize: String(desk.cycleCountSize ?? 5) });
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string; type?: string }>>([]);
  useEffect(() => {
    fetch("/api/treasury-accounts?limit=100", { credentials: "include" }).then(r => r.ok ? r.json() : null)
      .then(d => setAccounts(d?.data?.items ?? [])).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra: Record<string, unknown> = {}) {
    if (!name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      // Le secteur n'est envoyé que si l'utilisateur voit la liste des secteurs :
      // sinon on laisserait croire qu'il a été détaché.
      const payload: Record<string, unknown> = { name, description, treasuryAccountId: treasuryAccountId || null, revenueAccount, expenseAccount, vatRate, targetMarkup: (Number(targetMarkup) || 0) / 100,
        leadDays: Number(ops.leadDays) || 0, coverDays: Number(ops.coverDays) || 7, cycleCountSize: Number(ops.cycleCountSize) || 5,
        weeklyRevenueTarget: ops.weeklyRevenueTarget === "" ? null : Number(ops.weeklyRevenueTarget), weeklyMarginTarget: ops.weeklyMarginTarget === "" ? null : Number(ops.weeklyMarginTarget), ...extra };
      if (sectors.length > 0) payload.activityId = activityId || null;
      await post(`/api/comptoir/desks/${desk._id}`, payload, "PATCH");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Paramètres du comptoir" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Nom" required>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} />
        </FormField>
        <FormField label="Description" hint="Facultative">
          <input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} />
        </FormField>
        {sectors.length > 0 && (
          <FormField label="Secteur analytique lié" hint="Sa caisse remonte dans « Rentabilité par secteur ».">
            <select className={selectCls} value={activityId} onChange={e => setActivityId(e.target.value)}>
              <option value="">— Aucun (frais généraux) —</option>
              {sectors.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </FormField>
        )}
        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-ink2">Comptabilité</legend>
          <FormField label="Caisse de trésorerie" hint="Chaque vente et dépense du comptoir y est enregistrée, avec son écriture comptable. Sans caisse, rien n'est comptabilisé.">
            <select className={selectCls} value={treasuryAccountId} onChange={e => setTreasuryAccountId(e.target.value)}>
              <option value="">— Non reliée —</option>
              {accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
            </select>
          </FormField>
          <div className="grid sm:grid-cols-3 gap-3">
            <FormField label="Compte des ventes">
              <select className={selectCls} value={revenueAccount} onChange={e => setRevenueAccount(e.target.value)}>
                <option value="701100">701100 — Marchandises</option><option value="706300">706300 — Restauration</option><option value="706000">706000 — Prestations</option>
              </select>
            </FormField>
            <FormField label="Compte des dépenses">
              <select className={selectCls} value={expenseAccount} onChange={e => setExpenseAccount(e.target.value)}>
                <option value="601100">601100 — Achats de marchandises</option><option value="604000">604000 — Fournitures consommables</option><option value="658000">658000 — Charges diverses</option>
              </select>
            </FormField>
            <FormField label="TVA dans les prix">
              <select className={selectCls} value={vatRate} onChange={e => setVatRate(Number(e.target.value))}>
                <option value={0}>Aucune</option><option value={0.19}>19 %</option><option value={0.1}>10 %</option>
              </select>
            </FormField>
            <FormField label="Objectif de marge (% du prix hors taxes)" hint="Part du prix de vente HT qui doit rester en marge : sert au prix conseillé, à l'écart de marge et aux alertes du matin. Un article peut avoir son propre objectif (onglet Marges).">
              <input className={inputCls} type="number" min={0} max={90} value={targetMarkup} onChange={e => setTargetMarkup(e.target.value)} />
            </FormField>
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-line p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <legend className="px-1 text-xs font-semibold text-ink2">Pilotage</legend>
          <FormField label="Objectif CA / semaine"><input className={inputCls} type="number" min={0} value={ops.weeklyRevenueTarget} onChange={e => setOps(o => ({ ...o, weeklyRevenueTarget: e.target.value }))} /></FormField>
          <FormField label="Objectif marge / semaine"><input className={inputCls} type="number" min={0} value={ops.weeklyMarginTarget} onChange={e => setOps(o => ({ ...o, weeklyMarginTarget: e.target.value }))} /></FormField>
          <FormField label="Articles à compter / jour"><input className={inputCls} type="number" min={1} max={50} value={ops.cycleCountSize} onChange={e => setOps(o => ({ ...o, cycleCountSize: e.target.value }))} /></FormField>
          <FormField label="Délai de livraison (j)"><input className={inputCls} type="number" min={0} max={60} value={ops.leadDays} onChange={e => setOps(o => ({ ...o, leadDays: e.target.value }))} /></FormField>
          <FormField label="Commande pour (j)"><input className={inputCls} type="number" min={1} max={90} value={ops.coverDays} onChange={e => setOps(o => ({ ...o, coverDays: e.target.value }))} /></FormField>
        </fieldset>
        <div className="flex justify-between items-center gap-3 pt-2">
          <button onClick={async () => { if (await confirmDialog({ title: "Archiver ce comptoir ?", message: "Ses données restent conservées." })) save({ archived: true }); }}
            disabled={saving} className="text-sm text-neg hover:underline disabled:opacity-50">Archiver le comptoir</button>
          <div className="flex gap-3">
            <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
            <button onClick={() => save()} disabled={saving} className={buttonClass("primary", "md")}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeskView({ deskId, deskName, tab, setTab }: { deskId: string; deskName: string; tab: Tab; setTab: (t: Tab) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const reloadSummary = useCallback(() => {
    apiJson(`/api/comptoir/summary?deskId=${deskId}`).then(d => setSummary(d.data)).catch(() => {});
  }, [deskId]);
  useEffect(() => { reloadSummary(); }, [reloadSummary]);


  return (
    <div className="space-y-5">
      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<Wallet size={18} />} tone="blue" label="Solde de caisse" value={MONEY(summary?.cashBalance ?? 0)}
          sub={summary ? `${MONEY(summary.cashIn)} encaissés · ${MONEY(summary.cashOut)} sortis` : "—"} />
        {summary?.stockValue !== null && <MetricCard icon={<Coins size={18} />} tone="green" label="Valeur du stock" value={MONEY(summary?.stockValue ?? 0)} sub="Réserve et comptoir, au coût moyen" />}
        <MetricCard icon={<Package size={18} />} tone="violet" label="Articles" value={String(summary?.itemCount ?? 0)} sub="Suivis en stock matière" />
        <MetricCard icon={<AlertTriangle size={18} />} tone={summary?.lowStock?.length ? "red" : "amber"} label="Sous le seuil" value={String(summary?.lowStock?.length ?? 0)}
          valueCls={summary?.lowStock?.length ? "text-neg" : ""} sub={summary?.lowStock?.length ? "Réassort à prévoir" : "Stock suffisant"} />
      </div>

      {summary?.lowStock && summary.lowStock.length > 0 && (
        <section className="bg-surface rounded-[22px] border border-line shadow-card p-4 space-y-3" aria-label="Réapprovisionnement conseillé">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0" style={{ background: "linear-gradient(135deg,rgb(240 170 60),rgb(214 134 40))" }}><AlertTriangle size={18} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-bold text-ink">Réapprovisionnement conseillé</span>
              <span className="block text-[12.5px] text-ink3">{summary.lowStock.length} article{summary.lowStock.length > 1 ? "s" : ""} sous le seuil d&apos;alerte</span>
            </span>
            <button onClick={() => setTab("stock")} className="h-9 px-3.5 rounded-full border border-line text-[13px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-surface2">
              <Package size={14} /> Voir le stock
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.lowStock.map(l => (
              <span key={l.name} className="inline-flex items-center gap-2 rounded-xl bg-surface2/60 border border-line px-3 py-1.5 text-[13px]">
                <span className="font-semibold text-ink">{l.name}</span>
                <span className="num text-[12px] font-bold px-1.5 py-0.5 rounded-md bg-neg-50 text-neg">{l.quantity} {l.unit}</span>
                {l.threshold !== undefined && <span className="text-[11.5px] text-ink3">seuil {l.threshold}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Onglets en pilule : une ligne qui défile sur téléphone. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs label="Rubriques du comptoir" value={tab} onChange={setTab} tabs={[
          { key: "tickets" as Tab, label: "Tickets", icon: <Receipt size={15} /> },
          ...(summary && summary.stockValue !== null ? [{ key: "rentabilite" as Tab, label: "Marges", icon: <Percent size={15} /> }, { key: "resultat" as Tab, label: "Résultat", icon: <Scale size={15} /> }] : []),
          { key: "semaine" as Tab, label: "Semaine", icon: <CalendarCheck2 size={15} /> },
          { key: "caisse" as Tab, label: "Caisse", icon: <Wallet size={15} /> },
          { key: "stock" as Tab, label: "Stock", icon: <Package size={15} />, count: summary?.lowStock?.length || null },
          { key: "ardoises" as Tab, label: "Ardoises", icon: <BookUser size={15} /> },
          { key: "promos" as Tab, label: "Promotions", icon: <Tag size={15} /> },
          { key: "planning" as Tab, label: "Planning", icon: <GraduationCap size={15} /> },
          ...(summary && summary.stockValue !== null ? [{ key: "easypay" as Tab, label: "EasyPay", icon: <PlugZap size={15} /> }] : []),
        ]} />
        <button onClick={() => setReportOpen(true)} className="h-10 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink inline-flex items-center gap-2 hover:bg-surface2">
          <FileText size={15} /> Rapport PDF
        </button>
      </div>
      {reportOpen && <ReportDialog deskId={deskId} onClose={() => setReportOpen(false)} />}

      {tab === "tickets"
        ? <SalesTab deskId={deskId} deskName={deskName} onChange={reloadSummary} />
        : tab === "semaine"
        ? <SessionTab deskId={deskId} deskName={deskName} onChange={reloadSummary} />
        : tab === "rentabilite"
        ? <ProfitabilityTab deskId={deskId} onChange={reloadSummary} />
        : tab === "resultat"
        ? <ResultTab deskId={deskId} />
        : tab === "ardoises"
        ? <CreditTab deskId={deskId} deskName={deskName} onChange={reloadSummary} />
        : tab === "promos"
        ? <PromosTab deskId={deskId} />
        : tab === "planning"
        ? <PlanningTab deskId={deskId} deskName={deskName} />
        : tab === "easypay"
        ? <EasypayTab deskId={deskId} onChange={reloadSummary} />
        : tab === "caisse"
        ? <CaisseTab deskId={deskId} deskName={deskName} onChange={reloadSummary} />
        : <StockTab deskId={deskId} onChange={reloadSummary} />}
    </div>
  );
}

// Rapport PDF (caisse de la période + état du stock), pour le comptable.
function ReportDialog({ deskId, onClose }: { deskId: string; onClose: () => void }) {
  const now = new Date();
  const [from, setFrom] = useState(localDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(localDay(now));
  const [flow, setFlow] = useState<"" | "in" | "out">("");
  const invalid = !from || !to || from > to;
  function open() {
    const q = new URLSearchParams({ deskId, from, to, ...(flow ? { flow } : {}) });
    window.open(`/api/comptoir/report?${q.toString()}`, "_blank", "noopener");
  }
  return (
    <Modal open onClose={onClose} title="Rapport PDF du comptoir" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Journal de caisse de la période, état du stock et cases de visa — à la charte de votre organisation.</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Du"><input className={inputCls} type="date" value={from} onChange={e => setFrom(e.target.value)} /></FormField>
          <FormField label="Au"><input className={inputCls} type="date" value={to} onChange={e => setTo(e.target.value)} /></FormField>
        </div>
        <FormField label="Journal de caisse" hint="Les totaux du rapport gardent toujours recettes et dépenses.">
          <select className={selectCls} value={flow} onChange={e => setFlow(e.target.value as "" | "in" | "out")}>
            <option value="">Recettes et dépenses</option><option value="in">Recettes seulement</option><option value="out">Dépenses seulement</option>
          </select>
        </FormField>
        {invalid && <p className="text-xs text-neg">La date de début doit précéder la date de fin.</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button>
          <button onClick={open} disabled={invalid} className={buttonClass("primary", "md")}>
            <FileText size={15} /> Ouvrir le PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Caisse (argent) ──────────────────────────────────────────────────────────
function CaisseTab({ deskId, deskName, onChange }: { deskId: string; deskName: string; onChange: () => void }) {
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const canDelete = meCanDo(useMe(), "comptoir", "delete");
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [totals, setTotals] = useState<FlowTotals | null>(null);
  const filter = useFlowFilter({ from: monthStart(), to: today() });
  const [open, setOpen] = useState(false);
  const [arreteOpen, setArreteOpen] = useState(false);
  const [momoOpen, setMomoOpen] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/comptoir/cash?deskId=${deskId}${filter.query ? `&${filter.query}` : ""}`, { credentials: "include" })
      .then(r => r.json()).then(d => { setEntries(d.data?.items || []); setTotals(d.data?.totals ?? null); }).catch(() => {});
  }, [deskId, filter.query]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!(await confirmDialog({ title: "Supprimer cette écriture de caisse ?", danger: true }))) return;
    await post(`/api/comptoir/cash/${id}`, null, "DELETE");
    load(); onChange();
  }

  function exportCsv() {
    const rows: (string | number)[][] = [["Date", "Libellé", "Moyen", "Sens", "Montant (FCFA)"]];
    for (const e of entries) rows.push([
      new Date(e.date).toLocaleDateString("fr-FR"), e.label, METHOD_LABEL[e.method] || e.method,
      e.direction === "in" ? "Recette" : "Dépense", e.direction === "in" ? e.amount : -e.amount,
    ]);
    const suffix = filter.flow === "in" ? "-recettes" : filter.flow === "out" ? "-depenses" : "";
    downloadCsv(`caisse-comptoir${suffix}-${localDay()}.csv`, rows);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <FlowFilterBar state={filter} totals={totals} />
        <div className="flex gap-2">
        <button onClick={() => setArreteOpen(true)} className={buttonClass("secondary", "md")}>
          <FileText size={15} /> Arrêté de caisse
        </button>
        <button onClick={() => setMomoOpen(true)} className={buttonClass("secondary", "md")}>
          <Smartphone size={15} /> Mobile money
        </button>
        {entries.length > 0 && (
          <>
            <button onClick={exportCsv} className={buttonClass("secondary", "md")}>
              <Download size={15} /> Export CSV
            </button>
          </>
        )}
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}>
          <Plus size={15} /> Écriture de caisse
        </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title={filter.flow || filter.from || filter.to ? "Aucune écriture pour ce filtre" : "Caisse vide"}
          hint={filter.flow || filter.from || filter.to ? "Changez le sens ou la période." : "Enregistrez une recette ou une dépense."} />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Date</th><th>Libellé</th><th>Moyen</th><th>Sens</th><th className="text-right">Montant</th><th></th></tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e._id}>
                  <td className="text-ink2 whitespace-nowrap">{new Date(e.date).toLocaleDateString("fr-FR")}</td>
                  <td className="text-ink font-medium">{e.label}{e.direction === "out" && e.category && <span className="block text-[11px] text-ink3 font-normal">{EXPENSE_CATEGORIES[e.category] ?? e.category}</span>}</td>
                  <td className="text-ink2">{METHOD_LABEL[e.method] || e.method}</td>
                  <td>{e.direction === "in"
                    ? <Pill tone="pos"><ArrowDownLeft size={11} className="inline mr-0.5" /> Recette</Pill>
                    : <Pill tone="neg"><ArrowUpRight size={11} className="inline mr-0.5" /> Dépense</Pill>}</td>
                  <td className={`text-right font-mono font-bold ${e.direction === "in" ? "text-pos" : "text-neg"}`}>
                    {e.direction === "in" ? "+" : "−"}{MONEY(e.amount)}
                  </td>
                  <td className="text-right">
                    {e.saleId ? <Pill tone="info">ticket</Pill>
                      : canDelete && <button onClick={() => del(e._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {open && <CashDialog deskId={deskId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); onChange(); }} />}
      {momoOpen && <MomoDialog deskId={deskId} onClose={() => setMomoOpen(false)} />}
      {arreteOpen && <ClosingDialog deskId={deskId} deskName={deskName} onClose={() => setArreteOpen(false)} onClosed={() => { load(); onChange(); }} />}
    </div>
  );
}

function CashDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ direction: "in" as "in" | "out", amount: "", label: "", method: "cash", date: localDay(), category: "supply" });
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
          <FormField label="Montant (FCFA)" required>
            <input className={inputCls} type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </FormField>
          <FormField label="Moyen">
            <select className={selectCls} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
        </div>
        {form.direction === "out" && (
          <FormField label="Nature de la dépense" hint="Elle fixe le compte de charge (eau, électricité, loyer…) et la ligne du résultat du comptoir.">
            <select className={selectCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {Object.entries(EXPENSE_CATEGORIES).filter(([k]) => k !== "utilities").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
        )}
        {form.direction === "out" && (form.category === "supply" || form.category === "ingredients") && (
          <p className="text-xs text-warn">Pour des marchandises qui entrent en stock, préférez Stock → Réception en réserve, « payé depuis la caisse » : le stock et le coût des plats suivent. Une dépense ici est comptée comme consommée dans le mois ; ne saisissez pas aussi l&apos;entrée en stock à la main.</p>
        )}
        {form.direction === "in" && (
          <FormField label="Nature de l'entrée">
            <select className={selectCls} value={form.category === "non_sale" ? "non_sale" : "sale"} onChange={e => setForm(f => ({ ...f, category: e.target.value === "non_sale" ? "non_sale" : "supply" }))}>
              <option value="sale">Vente hors ticket (chiffre d&apos;affaires, TVA du comptoir)</option>
              <option value="non_sale">Hors vente : remboursement, apport, correction (à classer par le comptable)</option>
            </select>
          </FormField>
        )}
        <FormField label="Date">
          <input className={inputCls} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Stock matière ────────────────────────────────────────────────────────────
function StockTab({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const canDelete = meCanDo(useMe(), "comptoir", "delete");
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [moveFor, setMoveFor] = useState<Item | null>(null);
  const [lossFor, setLossFor] = useState<Item | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<Item | null>(null);
  const [view, setView] = useState<"levels" | "desk" | "reserve" | "inventory">("levels");
  const [levels, setLevels] = useState<ReserveData | null>(null);
  const [receive, setReceive] = useState<StockRow[] | null>(null);
  const [levelMove, setLevelMove] = useState<{ dir: "supply" | "return"; rows?: StockRow[] } | null>(null);
  const [editRow, setEditRow] = useState<StockRow | null>(null);
  const [reserveLoss, setReserveLoss] = useState<StockRow[] | null>(null);

  const load = useCallback(() => {
    apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => setItems(d.data || [])).catch(() => {});
    apiJson(`/api/comptoir/stock?deskId=${deskId}`).then(d => setMoves(d.data || [])).catch(() => {});
    apiJson(`/api/comptoir/reserve?deskId=${deskId}`).then(d => setLevels(d.data || null)).catch(() => {});
  }, [deskId]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!(await confirmDialog({ title: "Supprimer cet article ?", message: "Son historique de mouvements reste conservé.", danger: true }))) return;
    await post(`/api/comptoir/items/${id}`, null, "DELETE");
    load(); onChange();
  }

  // Coûts masqués par l'API pour un rôle non financier (caissier, serveur).
  const showCosts = items.some(i => i.unitCost !== null && i.unitCost !== undefined);
  function exportCsv() {
    const rows: (string | number)[][] = [showCosts ? ["Article", "Unité", "Stock", "Coût unitaire", "Valeur", "Seuil"] : ["Article", "Unité", "Stock", "Seuil"]];
    for (const it of items) rows.push(showCosts
      ? [it.name, it.unit, it.quantity, it.unitCost ?? 0, it.quantity * (it.unitCost ?? 0), it.threshold ?? ""]
      : [it.name, it.unit, it.quantity, it.threshold ?? ""]);
    downloadCsv(`stock-comptoir-${localDay()}.csv`, rows);
  }

  const refresh = () => { load(); onChange(); };
  const VIEWS = [["levels", "Réserve et comptoir"], ["desk", "Comptoir : entrées, sorties, pertes"], ["reserve", "Flux de la réserve"], ["inventory", "Inventaires"]] as const;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Vues du stock">
        {VIEWS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`px-3 h-8 rounded-full border text-[13px] font-semibold ${view === k ? "bg-ink text-white border-ink" : "border-line text-ink2 hover:bg-surface2"}`}>{l}</button>
        ))}
      </div>

      {view === "levels" && (levels ? <StockLevels data={levels} costs={showCosts} onReceive={rows => setReceive(rows ?? [])} onMove={(dir, rows) => setLevelMove({ dir, rows })} onEdit={setEditRow} onLoss={rows => setReserveLoss(rows ?? [])} /> : <div className="h-48 surface-card animate-pulse" />)}

      {view === "reserve" && levels && (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Date</th><th>Article</th><th>Mouvement</th><th className="text-right">Quantité</th><th className="text-right">Reste en réserve</th>{showCosts && <th className="text-right">Coût unit.</th>}<th>Motif</th></tr></thead>
            <tbody>
              {levels.moves.map(m => (
                <tr key={m._id} className="border-t border-line">
                  <td className="text-ink2 whitespace-nowrap">{new Date(m.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td>{m.name}</td>
                  <td>{m.type === "entry" ? <Pill tone="pos">Réception</Pill> : m.type === "transfer" ? <Pill tone="info">{m.quantity < 0 ? "Vers le comptoir" : "Retour du comptoir"}</Pill> : m.type === "loss" ? <Pill tone="neg">Perte / manquant</Pill> : m.type === "return" ? <Pill tone="pos">Reprise</Pill> : <Pill tone="mute">{m.type}</Pill>}</td>
                  <td className="text-right font-mono">{m.quantity > 0 ? "+" : ""}{m.quantity.toLocaleString("fr-FR")} <span className="text-ink3 text-xs">{m.unit}</span></td>
                  <td className="text-right font-mono text-ink2">{m.quantityAfter.toLocaleString("fr-FR")}</td>
                  {showCosts && <td className="text-right font-mono text-ink2">{m.unitCost ? MONEY(Math.round(m.unitCost)) : "—"}</td>}
                  <td className="text-ink2 text-sm">{m.reason}</td>
                </tr>
              ))}
              {!levels.moves.length && <tr><td colSpan={7} className="text-ink3 text-sm">Aucun mouvement en réserve : enregistrez une réception pour commencer.</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}

      {view === "inventory" && <InventoryPanel deskId={deskId} costs={showCosts} categories={[...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort()} onChange={refresh} />}

      {receive && levels && <ReceiveDialog deskId={deskId} rows={levels.rows} initial={receive} costs={showCosts} onClose={() => setReceive(null)} onDone={() => { setReceive(null); refresh(); }} />}
      {levelMove && levels && <LevelMoveDialog deskId={deskId} rows={levels.rows} direction={levelMove.dir} initial={levelMove.rows} onClose={() => setLevelMove(null)} onDone={() => { setLevelMove(null); refresh(); }} />}
      {editRow && <StockItemDialog row={editRow} onClose={() => setEditRow(null)} onDone={() => { setEditRow(null); refresh(); }} />}
      {reserveLoss && levels && <ReserveLossDialog deskId={deskId} rows={levels.rows} initial={reserveLoss} onClose={() => setReserveLoss(null)} onDone={() => { setReserveLoss(null); refresh(); }} />}

      {view === "desk" && <>
      <div className="flex justify-end gap-2">
        {items.length > 0 && (
          <button onClick={exportCsv} className={buttonClass("secondary", "md")}>
            <Download size={15} /> Export CSV
          </button>
        )}
        <button onClick={() => setReorderOpen(true)} className={buttonClass("secondary", "md")}>
          <ShoppingCart size={15} /> Réassort conseillé
        </button>
        {items.some(i => i.productId) && (
          <button onClick={() => setSupplyOpen(true)} className={buttonClass("secondary", "md")}>
            <Package size={15} /> Magasin ⇄ comptoir
          </button>
        )}
        <button onClick={() => setItemOpen(true)} className={buttonClass("primary", "md")}>
          <Plus size={15} /> Nouvel article
        </button>
      </div>

      <CycleCountPanel deskId={deskId} onChange={() => { load(); onChange(); }} />
      {items.length === 0 ? (
        <EmptyState icon={<Package size={20} />} title="Aucun article" hint="Ajoutez un article pour suivre son stock (entrées, sorties, ventes)." />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Article</th><th className="text-right">Stock</th>{showCosts && <><th className="text-right">Coût unit.</th><th className="text-right">Valeur</th></>}<th className="text-center">Mouvement</th><th></th></tr></thead>
            <tbody>
              {items.map(it => {
                const low = it.threshold != null && it.quantity <= it.threshold;
                return (
                  <tr key={it._id}>
                    <td className="text-ink font-medium">{it.name}
                      {low && <span className="ml-2"><Pill tone="warn">seuil</Pill></span>}
                      {it.productId
                        ? <span className="block text-[11px] text-section font-normal">Catalogue · {it.productId.code}{it.productId.trackingMode && it.productId.trackingMode !== "none" ? " · lots" : ""}</span>
                        : <button onClick={() => setLinkFor(it)} className="block text-[11px] text-ink3 hover:text-section font-normal">Relier au catalogue</button>}
                    </td>
                    <td className="text-right font-mono">{it.quantity} <span className="text-ink3 text-xs">{it.unit}</span></td>
                    {showCosts && <>
                      <td className="text-right font-mono text-ink2">{MONEY(it.unitCost ?? 0)}</td>
                      <td className="text-right font-mono font-semibold">{MONEY(it.quantity * (it.unitCost ?? 0))}</td>
                    </>}
                    <td className="text-center">
                      <button onClick={() => setMoveFor(it)} className="px-3 h-8 rounded-lg border border-line2 text-xs font-semibold text-ink2 hover:bg-surface2 inline-flex items-center gap-1">
                        <RotateCcw size={13} /> Entrée / Sortie
                      </button>
                      <button onClick={() => setLossFor(it)} className="ml-1 px-2 h-8 rounded-lg border border-neg/25 text-xs text-neg hover:bg-neg-50" title="Perte, casse, offert">Perte</button>
                    </td>
                    <td className="text-right">
                      {canDelete && <button onClick={() => del(it._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {moves.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-ink mb-2">Derniers mouvements</h3>
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Date</th><th>Article</th><th>Type</th><th className="text-right">Qté</th><th className="text-right">Stock après</th><th>Motif</th></tr></thead>
              <tbody>
                {moves.slice(0, 30).map(m => (
                  <tr key={m._id}>
                    <td className="text-ink2 whitespace-nowrap">{new Date(m.date).toLocaleDateString("fr-FR")}</td>
                    <td className="text-ink">{m.itemId?.name || "—"}</td>
                    <td>{m.type === "in" ? <Pill tone="pos">Entrée</Pill> : m.type === "out" ? <Pill tone="neg">Sortie</Pill> : m.type === "supply" ? <Pill tone="pos">Approvisionnement</Pill> : m.type === "return" ? <Pill tone="warn">Retour magasin</Pill> : <Pill tone="info">Ajustement</Pill>}</td>
                    <td className="text-right font-mono">{m.quantity}</td>
                    <td className="text-right font-mono text-ink2">{m.quantityAfter}</td>
                    <td className="text-ink2">{m.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      </>}
      {view === "levels" && (
        <div className="flex justify-end gap-2">
          <button onClick={() => setReorderOpen(true)} className={buttonClass("secondary", "md")}><ShoppingCart size={15} /> Réassort fournisseur</button>
          {items.some(i => i.productId) && <button onClick={() => setSupplyOpen(true)} className={buttonClass("secondary", "md")}><Package size={15} /> Magasin central ⇄ comptoir</button>}
          <button onClick={() => setItemOpen(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouvel article</button>
        </div>
      )}
      {itemOpen && <ItemDialog deskId={deskId} onClose={() => setItemOpen(false)} onSaved={() => { setItemOpen(false); load(); onChange(); }} />}
      {lossFor && <LossDialog deskId={deskId} item={lossFor} onClose={() => setLossFor(null)} onDone={() => { setLossFor(null); load(); onChange(); }} />}
      {reorderOpen && <ReorderDialog deskId={deskId} onClose={() => setReorderOpen(false)} />}
      {moveFor && <MoveDialog deskId={deskId} item={moveFor} onClose={() => setMoveFor(null)} onSaved={() => { setMoveFor(null); load(); onChange(); }} />}
      {supplyOpen && <SupplyDialog deskId={deskId} items={items.filter(i => i.productId)} onClose={() => setSupplyOpen(false)} onSaved={() => { setSupplyOpen(false); load(); onChange(); }} />}
      {linkFor && <LinkDialog item={linkFor} onClose={() => setLinkFor(null)} onSaved={() => { setLinkFor(null); load(); onChange(); }} />}
    </div>
  );
}

function ItemDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", unit: "unité", quantity: "", unitCost: "", salePrice: "", threshold: "", productId: "", category: "", packLabel: "", packSize: "", packCost: "" });
  const pack = Number(form.packSize) > 0 ? { label: form.packLabel || undefined, size: Number(form.packSize), cost: form.productId ? undefined : Number(form.packCost) || undefined } : null;
  const eco = itemEconomics({ unitCost: Number(form.unitCost) || 0, pack, salePrice: Number(form.salePrice) || 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalog = useCatalog();
  async function save() {
    if (!form.productId && !form.name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/items", {
        deskId, name: form.name, unit: form.unit, productId: form.productId || undefined,
        quantity: Number(form.quantity) || 0, unitCost: Number(form.unitCost) || 0,
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
        threshold: form.threshold ? Number(form.threshold) : undefined,
        category: form.category || undefined, pack: pack ?? undefined,
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nouvel article" size="md">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Article du catalogue" hint="Relié : son stock est la réserve du comptoir, approvisionnée par transfert depuis le magasin.">
          <select className={selectCls} value={form.productId} onChange={e => {
            const p = catalog.find(x => x._id === e.target.value);
            // Le prix du catalogue est HT ; le comptoir encaisse TTC (la TVA en
            // est extraite à la comptabilisation). Reprendre le HT tel quel
            // sous-évaluait le chiffre d'affaires de la TVA.
            const ttc = p?.unitPrice ? Math.round(p.unitPrice * (1 + (p.tvaRate ?? 0))) : null;
            setForm(f => ({ ...f, productId: e.target.value, name: p ? p.label : f.name, unit: p?.unit ?? f.unit, salePrice: ttc ? String(ttc) : f.salePrice }));
          }}>
            <option value="">— Article propre au comptoir (plat, boisson préparée…) —</option>
            {catalog.map(p => <option key={p._id} value={p._id}>{p.code} — {p.label}</option>)}
          </select>
        </FormField>
        <FormField label="Nom de l'article" required>
          <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unité"><input className={inputCls} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></FormField>
          {!form.productId && <FormField label="Stock initial"><input className={inputCls} type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></FormField>}
          {!form.productId && <FormField label="Coût unitaire (FCFA)"><input className={inputCls} type="number" min="0" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} /></FormField>}
          <FormField label="Prix de vente TTC (FCFA)" hint="Prix encaissé, TVA comprise"><input className={inputCls} type="number" min="0" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} /></FormField>
          <FormField label="Seuil d'alerte" hint="Facultatif"><input className={inputCls} type="number" min="0" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} /></FormField>
          <FormField label="Famille" hint="Boissons, biscuits, snacks…"><input className={inputCls} maxLength={60} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></FormField>
        </div>
        <fieldset className="rounded-xl border border-line p-3 space-y-2">
          <legend className="px-1 text-xs font-semibold text-ink2">Acheté par paquet ? (facultatif)</legend>
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Nom"><input className={inputCls} maxLength={30} placeholder="paquet, carton…" value={form.packLabel} onChange={e => setForm(f => ({ ...f, packLabel: e.target.value }))} /></FormField>
            <FormField label="Unités"><input className={inputCls} type="number" min="1" placeholder="24" value={form.packSize} onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} /></FormField>
            {!form.productId && <FormField label="Prix du paquet"><input className={inputCls} type="number" min="0" placeholder="5000" value={form.packCost} onChange={e => setForm(f => ({ ...f, packCost: e.target.value }))} /></FormField>}
          </div>
        </fieldset>
        {eco.status !== "unknown" && (
          <p className={`text-sm px-3 py-2 rounded-lg ${eco.marginUnit < 0 ? "bg-neg-50 text-neg" : "bg-pos-50 text-pos"}`}>
            Coût {eco.unitCost.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} FCFA l&apos;unité · {eco.marginUnit < 0 ? "perte" : "marge"} de {Math.abs(eco.marginUnit).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} FCFA par vente ({eco.markupRate} % du prix){eco.packMargin !== null ? ` · ${eco.packMargin.toLocaleString("fr-FR")} FCFA par paquet` : ""}.
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
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
  const tracking = item.productId?.trackingMode && item.productId.trackingMode !== "none" ? item.productId.trackingMode as "lot" | "serial" : null;
  const [lots, setLots] = useState<LotRow[]>([{ lotNumber: "", expiryDate: "", qty: 0 }]);
  const [cashAmount, setCashAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Entrée : par paquets (article acheté par conditionnement) ou à l'unité, avec son coût.
  const hasPack = !!item.pack?.size;
  const [byPack, setByPack] = useState(hasPack && !tracking);
  const [packs, setPacks] = useState("");
  const [packCost, setPackCost] = useState(String(item.pack?.cost ?? ""));
  const [unitCost, setUnitCost] = useState("");

  // Pré-remplit l'encaissement d'une vente à partir du prix de vente indicatif
  // (au choix du type comme à la saisie de la quantité).
  const prefillCash = (t: "in" | "out" | "adjust", q: string) => {
    if (t === "out" && item.salePrice && q) setCashAmount(String(item.salePrice * Number(q)));
  };

  async function save() {
    const packMode = type === "in" && hasPack && byPack;
    const n = packMode ? Number(packs) * (item.pack?.size ?? 1) : Number(quantity);
    if (packMode ? !(Number(packs) > 0) : quantity === "" || (type === "adjust" ? !(n >= 0) : !(n > 0))) { setError("Quantité invalide."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/stock", {
        deskId, itemId: item._id, type, quantity: n, reason,
        ...(packMode ? { packs: Number(packs), packCost: Number(packCost) || undefined } : {}),
        ...(type === "in" && !packMode && !item.productId && Number(unitCost) > 0 ? { unitCost: Number(unitCost) } : {}),
        ...(tracking && type === "in" ? { lots: lotsPayload(lots) } : {}),
        ...(type === "out" && withCash && Number(cashAmount) > 0 ? { cashAmount: Number(cashAmount), cashMethod: "cash" } : {}),
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }

  const typeBtn = (t: "in" | "out" | "adjust", label: string) => (
    <button type="button" onClick={() => { setType(t); prefillCash(t, quantity); }}
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
        {type === "in" && hasPack && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setByPack(true)} className={`h-9 rounded-lg border text-xs font-semibold ${byPack ? "border-section bg-section/10 text-section" : "border-line2 text-ink2"}`}>Par {item.pack?.label || "paquet"} de {item.pack?.size}</button>
            <button type="button" onClick={() => setByPack(false)} className={`h-9 rounded-lg border text-xs font-semibold ${!byPack ? "border-section bg-section/10 text-section" : "border-line2 text-ink2"}`}>À l&apos;unité</button>
          </div>
        )}
        {type === "in" && hasPack && byPack ? (
          <div className="grid grid-cols-2 gap-3">
            <FormField label={`Nombre de ${item.pack?.label || "paquet"}s`} required><input className={inputCls} type="number" min="0" step="any" value={packs} onChange={e => setPacks(e.target.value)} /></FormField>
            {!item.productId && <FormField label={`Prix d'un ${item.pack?.label || "paquet"}`} hint="Coût unitaire recalculé"><input className={inputCls} type="number" min="0" value={packCost} onChange={e => setPackCost(e.target.value)} /></FormField>}
            {Number(packs) > 0 && <p className="col-span-2 text-xs text-ink2">= {Number(packs) * (item.pack?.size ?? 1)} {item.unit}{!item.productId && Number(packCost) > 0 ? ` à ${(Number(packCost) / (item.pack?.size ?? 1)).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} FCFA l'unité` : ""}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <FormField label={type === "adjust" ? "Nouveau stock" : "Quantité"} required>
              <input className={inputCls} type="number" min="0" value={quantity} onChange={e => { setQuantity(e.target.value); prefillCash(type, e.target.value); }} />
            </FormField>
            {type === "in" && !item.productId && <FormField label="Coût d'achat à l'unité" hint="Facultatif : met à jour le coût"><input className={inputCls} type="number" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></FormField>}
          </div>
        )}
        {tracking && type === "in" && Number(quantity) > 0 && <LotsEditor mode={tracking} quantity={Number(quantity)} value={lots} onChange={setLots} />}
        {tracking && type !== "in" && <p className="text-[11px] text-ink3">Article suivi par lot : la sortie prend d&apos;office le lot qui périme le plus tôt.</p>}
        {type === "out" && (
          <div className="rounded-xl border border-section/25 bg-section/5 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={withCash} onChange={e => setWithCash(e.target.checked)} />
              Encaisser la vente en caisse
            </label>
            {withCash && (
              <FormField label="Montant encaissé (FCFA)">
                <input className={inputCls} type="number" min="0" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <FormField label="Motif" hint="Facultatif">
          <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="Réapprovisionnement, vente, casse…" />
        </FormField>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
            {saving ? "Enregistrement…" : "Valider le mouvement"}
          </button>
        </div>
      </div>
    </Modal>
  );
}


interface CatalogProduct { _id: string; code: string; label: string; unit?: string; unitPrice?: number; tvaRate?: number; trackingMode?: string }
/** Articles stockés du catalogue (pour relier un article de comptoir). */
function useCatalog() {
  const [list, setList] = useState<CatalogProduct[]>([]);
  useEffect(() => {
    fetch("/api/comptoir/catalog", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => setList(d?.data?.products ?? [])).catch(() => {});
  }, []);
  return list;
}

function LinkDialog({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const catalog = useCatalog();
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!productId) { setError("Choisissez l'article du catalogue."); return; }
    try { await post(`/api/comptoir/items/${item._id}`, { productId }, "PATCH"); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Rattachement impossible"); }
  }
  return (
    <Modal open onClose={onClose} title={`Relier « ${item.name} » au catalogue`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Le stock actuel du comptoir ({item.quantity} {item.unit}) entre dans la réserve du comptoir, puis tout mouvement passe par la gestion de stock (entrepôts, lots, coût moyen).</p>
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <select className={selectCls} value={productId} onChange={e => setProductId(e.target.value)} aria-label="Article du catalogue">
          <option value="">— Choisir —</option>{catalog.map(p => <option key={p._id} value={p._id}>{p.code} — {p.label}</option>)}
        </select>
        <button onClick={save} className={buttonClass("primary", "md", "w-full")}>Relier</button>
      </div>
    </Modal>
  );
}

function SupplyDialog({ deskId, items, onClose, onSaved }: { deskId: string; items: Item[]; onClose: () => void; onSaved: () => void }) {
  const [warehouses, setWarehouses] = useState<Array<{ _id: string; name: string; kind: string; isDefault?: boolean }>>([]);
  const [from, setFrom] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [back, setBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/comptoir/catalog", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => {
      const list = d?.data?.warehouses ?? [];
      if (!d?.data?.canSupply) setError("L'approvisionnement depuis le magasin est fait par le magasin ou le chef The Spot.");
      setWarehouses(list);
      const def = list.find((w: { isDefault?: boolean }) => w.isDefault) ?? list[0];
      if (def) setFrom(def._id);
    }).catch(() => setError("Liste des entrepôts inaccessible."));
  }, []);
  async function save() {
    const lines = items.map(i => ({ itemId: i._id, quantity: Number(qty[i._id]) || 0 })).filter(l => l.quantity > 0);
    if (!from || !lines.length) { setError("Choisissez l'entrepôt et au moins une quantité."); return; }
    setSaving(true); setError(null);
    if (back) {
      const over = items.find(i => (Number(qty[i._id]) || 0) > i.quantity);
      if (over) { setError(`« ${over.name} » : seulement ${over.quantity} ${over.unit} en réserve.`); return; }
    }
    try { await post("/api/comptoir/supply", { deskId, fromWarehouseId: from, lines, direction: back ? "return" : "supply" }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : back ? "Retour impossible" : "Approvisionnement impossible"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={back ? "Renvoyer au magasin" : "Approvisionner le comptoir"} size="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          {[[false, "Approvisionner"], [true, "Renvoyer les invendus"]].map(([v, l]) => (
            <button key={String(v)} type="button" onClick={() => setBack(v as boolean)}
              className={`flex-1 h-9 rounded-lg border text-sm font-semibold ${back === v ? "bg-section text-onink border-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>{l as string}</button>
          ))}
        </div>
        <p className="text-sm text-ink2">{back
          ? "Transfert de la réserve du comptoir vers un entrepôt (lots et péremptions suivent)."
          : "Transfert depuis un entrepôt vers la réserve du comptoir ; les lots qui périment le plus tôt partent en premier."}</p>
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label={back ? "Vers l'entrepôt" : "Depuis l'entrepôt"}>
          <select className={selectCls} value={from} onChange={e => setFrom(e.target.value)}>{warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}</select>
        </FormField>
        <div className="space-y-2">
          {items.map(i => (
            <div key={i._id} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{i.name} <span className="text-ink3 text-xs">({i.quantity} {i.unit} au comptoir)</span></span>
              <input className={`${inputCls} w-28`} type="number" min="0" placeholder="Qté" value={qty[i._id] ?? ""} onChange={e => setQty(q => ({ ...q, [i._id]: e.target.value }))} aria-label={`Quantité — ${i.name}`} />
            </div>
          ))}
        </div>
        <button onClick={save} disabled={saving} className={buttonClass("primary", "md", "w-full")}>{saving ? "Transfert…" : back ? "Renvoyer au magasin" : "Approvisionner"}</button>
      </div>
    </Modal>
  );
}
