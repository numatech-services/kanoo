"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Wallet, Package, AlertTriangle, ArrowDownLeft, ArrowUpRight, Trash2, RotateCcw, Coins, Download, FileText, Settings2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { FlowFilterBar, useFlowFilter, monthStart, today, type FlowTotals } from "@/components/ui/FlowFilterBar";
import { useMe, meCanDo } from "@/lib/useMe";
import { LotsEditor, lotsPayload, type LotRow } from "@/components/stock/LotsEditor";

interface Desk { _id: string; name: string; description?: string; activityId?: string }
interface Item { _id: string; name: string; unit: string; quantity: number; unitCost: number; salePrice?: number; threshold?: number; productId?: { _id: string; code: string; label: string; trackingMode?: string } | null }
interface CashEntry { _id: string; direction: "in" | "out"; amount: number; label: string; method: string; date: string }
interface Move { _id: string; type: "in" | "out" | "adjust" | "supply" | "return"; quantity: number; quantityAfter: number; reason?: string; date: string; itemId?: { name?: string; unit?: string } }
interface Summary { itemCount: number; stockValue: number; lowStock: { name: string; unit: string; quantity: number; threshold?: number }[]; cashIn: number; cashOut: number; cashBalance: number }

// Jour civil LOCAL (AAAA-MM-JJ) : toISOString() donnerait le jour UTC, et une
// vente passée juste après minuit tomberait sur la veille.
function localDay(d: Date | string = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

const MONEY = (n: number) => `${Number(n || 0).toLocaleString("fr-FR")} XOF`;
const METHOD_LABEL: Record<string, string> = {
  cash: "Espèces", bank_transfer: "Virement", orange_money: "OM / Moov", card: "Carte", check: "Chèque", other: "Autre",
};

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

// Export CSV côté client (séparateur « ; », compatible Excel FR ; BOM UTF-8).
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
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

export default function ComptoirPage() {
  const [desks, setDesks] = useState<Desk[]>([]);
  const [deskId, setDeskId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"caisse" | "stock">("caisse");
  const [newDeskOpen, setNewDeskOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadDesks = useCallback(() => {
    fetch("/api/comptoir/desks", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const list: Desk[] = d.data || [];
        setDesks(list);
        // Garde le comptoir courant s'il existe encore (il a pu être archivé).
        setDeskId(prev => (prev && list.some(d => d._id === prev)) ? prev : (list[0]?._id || ""));
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
            <button onClick={() => setSettingsOpen(true)} title="Paramètres du comptoir"
              className="self-end px-3 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
              <Settings2 size={15} /> Paramètres
            </button>
          </div>

          {deskId && <DeskView key={deskId} deskId={deskId} tab={tab} setTab={setTab} />}
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
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra: Record<string, unknown> = {}) {
    if (!name.trim()) { setError("Le nom est requis."); return; }
    setSaving(true); setError(null);
    try {
      // Le secteur n'est envoyé que si l'utilisateur voit la liste des secteurs :
      // sinon on laisserait croire qu'il a été détaché.
      const payload: Record<string, unknown> = { name, description, ...extra };
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
        <div className="flex justify-between items-center gap-3 pt-2">
          <button onClick={() => { if (confirm("Archiver ce comptoir ? Ses données restent conservées.")) save({ archived: true }); }}
            disabled={saving} className="text-sm text-neg hover:underline disabled:opacity-50">Archiver le comptoir</button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
            <button onClick={() => save()} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeskView({ deskId, tab, setTab }: { deskId: string; tab: "caisse" | "stock"; setTab: (t: "caisse" | "stock") => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
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

      <div className="flex flex-wrap items-center gap-2">
        <button className={tabCls(tab === "caisse")} onClick={() => setTab("caisse")}><Wallet size={16} /> Caisse</button>
        <button className={tabCls(tab === "stock")} onClick={() => setTab("stock")}><Package size={16} /> Stock matière</button>
        <button onClick={() => setReportOpen(true)}
          className="ml-auto px-3 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
          <FileText size={15} /> Rapport PDF
        </button>
      </div>
      {reportOpen && <ReportDialog deskId={deskId} onClose={() => setReportOpen(false)} />}

      {tab === "caisse"
        ? <CaisseTab deskId={deskId} onChange={reloadSummary} />
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
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Fermer</button>
          <button onClick={open} disabled={invalid} className="px-5 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
            <FileText size={15} /> Ouvrir le PDF
          </button>
        </div>
      </div>
    </Modal>
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
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const canDelete = meCanDo(useMe(), "comptoir", "delete");
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [totals, setTotals] = useState<FlowTotals | null>(null);
  const filter = useFlowFilter({ from: monthStart(), to: today() });
  const [open, setOpen] = useState(false);
  const [arreteOpen, setArreteOpen] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/comptoir/cash?deskId=${deskId}${filter.query ? `&${filter.query}` : ""}`, { credentials: "include" })
      .then(r => r.json()).then(d => { setEntries(d.data?.items || []); setTotals(d.data?.totals ?? null); }).catch(() => {});
  }, [deskId, filter.query]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!confirm("Supprimer cette écriture de caisse ?")) return;
    await post(`/api/comptoir/cash/${id}`, null, "DELETE");
    load(); onChange();
  }

  function exportCsv() {
    const rows: (string | number)[][] = [["Date", "Libellé", "Moyen", "Sens", "Montant (XOF)"]];
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
        <button onClick={() => setArreteOpen(true)} className="px-3 h-9 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
          <FileText size={15} /> Arrêté de caisse
        </button>
        {entries.length > 0 && (
          <>
            <button onClick={exportCsv} className="px-3 h-9 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
              <Download size={15} /> Export CSV
            </button>
          </>
        )}
        <button onClick={() => setOpen(true)} className="px-4 h-9 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={15} /> Écriture de caisse
        </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title={filter.flow || filter.from || filter.to ? "Aucune écriture pour ce filtre" : "Caisse vide"}
          hint={filter.flow || filter.from || filter.to ? "Changez le sens ou la période." : "Enregistrez une recette ou une dépense."} />
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
                    {canDelete && <button onClick={() => del(e._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <CashDialog deskId={deskId} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); onChange(); }} />}
      {arreteOpen && <ArreteDialog deskId={deskId} onClose={() => setArreteOpen(false)} />}
    </div>
  );
}

// Arrêté de caisse : totaux du jour, solde théorique et rapprochement des
// espèces comptées, imprimable pour confier/contrôler la gestion du comptoir.
function ArreteDialog({ deskId, onClose }: { deskId: string; onClose: () => void }) {
  const [day, setDay] = useState(localDay());
  const [counted, setCounted] = useState("");
  // Toutes les écritures de la journée, indépendamment du filtre de la liste.
  const [dayEntries, setDayEntries] = useState<CashEntry[]>([]);
  useEffect(() => {
    if (!day) return;
    fetch(`/api/comptoir/cash?deskId=${deskId}&from=${day}&to=${day}`, { credentials: "include" })
      .then(r => r.json()).then(d => setDayEntries(d.data?.items || [])).catch(() => setDayEntries([]));
  }, [deskId, day]);

  const sum = (pred: (e: CashEntry) => boolean) => dayEntries.filter(pred).reduce((s, e) => s + e.amount, 0);
  const recettes = sum(e => e.direction === "in");
  const depenses = sum(e => e.direction === "out");
  const cashIn = sum(e => e.direction === "in" && e.method === "cash");
  const cashOut = sum(e => e.direction === "out" && e.method === "cash");
  const soldeEspeces = cashIn - cashOut;
  const ecart = counted ? Number(counted) - soldeEspeces : null;

  function print() {
    const rows = dayEntries.map(e =>
      `<tr><td>${e.label}</td><td>${METHOD_LABEL[e.method] || e.method}</td><td style="text-align:right">${e.direction === "in" ? "+" : "−"}${MONEY(e.amount)}</td></tr>`
    ).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Arrêté de caisse ${day}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:32px;color:#111}h1{font-size:18px}
      table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px}
      .tot{margin-top:16px;font-size:14px}.tot div{display:flex;justify-content:space-between;padding:4px 0}</style></head>
      <body><h1>Arrêté de caisse — ${new Date(day).toLocaleDateString("fr-FR")}</h1>
      <table><thead><tr><th>Libellé</th><th>Moyen</th><th style="text-align:right">Montant</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Recettes du jour</span><strong>${MONEY(recettes)}</strong></div>
        <div><span>Dépenses du jour</span><strong>${MONEY(depenses)}</strong></div>
        <div><span>Solde du jour</span><strong>${MONEY(recettes - depenses)}</strong></div>
        <div><span>Solde théorique espèces</span><strong>${MONEY(soldeEspeces)}</strong></div>
        ${counted ? `<div><span>Espèces comptées</span><strong>${MONEY(Number(counted))}</strong></div>
        <div><span>Écart</span><strong>${MONEY(ecart ?? 0)}</strong></div>` : ""}
      </div>
      <p style="margin-top:32px;font-size:12px">Visa du gestionnaire : ____________________  Visa du comptable : ____________________</p>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  const Line = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-ink2">{label}</span>
      <span className={strong ? "font-bold text-ink" : "font-mono text-ink"}>{value}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Arrêté de caisse" size="md">
      <div className="space-y-4">
        <FormField label="Journée">
          <input className={inputCls} type="date" value={day} onChange={e => setDay(e.target.value)} />
        </FormField>
        <div className="surface-card p-4 divide-y divide-line">
          <Line label="Recettes du jour" value={MONEY(recettes)} />
          <Line label="Dépenses du jour" value={MONEY(depenses)} />
          <Line label="Solde du jour" value={MONEY(recettes - depenses)} strong />
          <Line label="Solde théorique espèces" value={MONEY(soldeEspeces)} />
        </div>
        <FormField label="Espèces comptées (XOF)" hint="Pour contrôler la caisse physique.">
          <input className={inputCls} type="number" min="0" value={counted} onChange={e => setCounted(e.target.value)} />
        </FormField>
        {ecart !== null && (
          <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${ecart === 0 ? "bg-pos-50 text-pos border border-pos/25" : "bg-warn-50 text-warn border border-warn/25"}`}>
            {ecart === 0 ? "Caisse juste — aucun écart." : `Écart : ${ecart > 0 ? "+" : ""}${MONEY(ecart)} (${ecart > 0 ? "excédent" : "manquant"}).`}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Fermer</button>
          <button onClick={print} className="px-5 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
            <FileText size={15} /> Imprimer l&apos;arrêté
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CashDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ direction: "in" as "in" | "out", amount: "", label: "", method: "cash", date: localDay() });
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
  const canDelete = meCanDo(useMe(), "comptoir", "delete");
  const [items, setItems] = useState<Item[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [itemOpen, setItemOpen] = useState(false);
  const [moveFor, setMoveFor] = useState<Item | null>(null);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<Item | null>(null);

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

  function exportCsv() {
    const rows: (string | number)[][] = [["Article", "Unité", "Stock", "Coût unitaire", "Valeur", "Seuil"]];
    for (const it of items) rows.push([it.name, it.unit, it.quantity, it.unitCost, it.quantity * it.unitCost, it.threshold ?? ""]);
    downloadCsv(`stock-comptoir-${localDay()}.csv`, rows);
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2">
        {items.length > 0 && (
          <button onClick={exportCsv} className="px-3 h-9 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
            <Download size={15} /> Export CSV
          </button>
        )}
        {items.some(i => i.productId) && (
          <button onClick={() => setSupplyOpen(true)} className="px-3 h-9 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold text-ink2 hover:bg-surface2">
            <Package size={15} /> Magasin ⇄ comptoir
          </button>
        )}
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
                      {it.productId
                        ? <span className="block text-[11px] text-section font-normal">Catalogue · {it.productId.code}{it.productId.trackingMode && it.productId.trackingMode !== "none" ? " · lots" : ""}</span>
                        : <button onClick={() => setLinkFor(it)} className="block text-[11px] text-ink3 hover:text-section font-normal">Relier au catalogue</button>}
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
                      {canDelete && <button onClick={() => del(it._id)} className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50" title="Supprimer"><Trash2 size={15} /></button>}
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
                    <td>{m.type === "in" ? <Pill tone="pos">Entrée</Pill> : m.type === "out" ? <Pill tone="neg">Sortie</Pill> : m.type === "supply" ? <Pill tone="pos">Approvisionnement</Pill> : m.type === "return" ? <Pill tone="warn">Retour magasin</Pill> : <Pill tone="info">Ajustement</Pill>}</td>
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
      {supplyOpen && <SupplyDialog deskId={deskId} items={items.filter(i => i.productId)} onClose={() => setSupplyOpen(false)} onSaved={() => { setSupplyOpen(false); load(); onChange(); }} />}
      {linkFor && <LinkDialog item={linkFor} onClose={() => setLinkFor(null)} onSaved={() => { setLinkFor(null); load(); onChange(); }} />}
    </div>
  );
}

function ItemDialog({ deskId, onClose, onSaved }: { deskId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", unit: "unité", quantity: "", unitCost: "", salePrice: "", threshold: "", productId: "" });
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
            setForm(f => ({ ...f, productId: e.target.value, name: p ? p.label : f.name, unit: p?.unit ?? f.unit, salePrice: p?.unitPrice ? String(p.unitPrice) : f.salePrice }));
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
          {!form.productId && <FormField label="Coût unitaire (XOF)"><input className={inputCls} type="number" min="0" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} /></FormField>}
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
  const tracking = item.productId?.trackingMode && item.productId.trackingMode !== "none" ? item.productId.trackingMode as "lot" | "serial" : null;
  const [lots, setLots] = useState<LotRow[]>([{ lotNumber: "", expiryDate: "", qty: 0 }]);
  const [cashAmount, setCashAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pré-remplit l'encaissement d'une vente à partir du prix de vente indicatif.
  useEffect(() => {
    if (type === "out" && item.salePrice && quantity) setCashAmount(String(item.salePrice * Number(quantity)));
  }, [type, quantity, item.salePrice]);

  async function save() {
    const n = Number(quantity);
    if (quantity === "" || (type === "adjust" ? !(n >= 0) : !(n > 0))) { setError("Quantité invalide."); return; }
    setSaving(true); setError(null);
    try {
      await post("/api/comptoir/stock", {
        deskId, itemId: item._id, type, quantity: Number(quantity), reason,
        ...(tracking && type === "in" ? { lots: lotsPayload(lots) } : {}),
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
        {tracking && type === "in" && Number(quantity) > 0 && <LotsEditor mode={tracking} quantity={Number(quantity)} value={lots} onChange={setLots} />}
        {tracking && type !== "in" && <p className="text-[11px] text-ink3">Article suivi par lot : la sortie prend d&apos;office le lot qui périme le plus tôt.</p>}
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


interface CatalogProduct { _id: string; code: string; label: string; unit?: string; unitPrice?: number; trackingMode?: string }
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
        <button onClick={save} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold">Relier</button>
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
              className={`flex-1 h-9 rounded-lg border text-sm font-semibold ${back === v ? "bg-section text-white border-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>{l as string}</button>
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
        <button onClick={save} disabled={saving} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-60">{saving ? "Transfert…" : back ? "Renvoyer au magasin" : "Approvisionner"}</button>
      </div>
    </Modal>
  );
}
