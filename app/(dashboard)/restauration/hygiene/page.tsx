"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, Thermometer, SprayCan, Soup, Search, Settings2, Plus, Trash2, Save } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dmy = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const KINDS = { fridge: "Réfrigérateur / chambre froide", freezer: "Congélateur", hot: "Maintien au chaud" } as const;
const FREQ = { service: "À chaque service", daily: "Chaque jour", weekly: "Chaque semaine", monthly: "Chaque mois" } as const;
const CHAIN = { ambient: "ambiant", chilled: "réfrigéré", frozen: "surgelé" } as Record<string, string>;
const lim = (u: { min?: number; max?: number }) => `${u.min !== undefined && u.min !== null ? `${u.min} °C` : "—"} à ${u.max !== undefined && u.max !== null ? `${u.max} °C` : "—"}`;

interface Unit { _id: string; name: string; kind: keyof typeof KINDS; min?: number; max?: number; readings: Array<{ _id: string; value: number; ok: boolean; action?: string; at: string }> }
interface Task { _id: string; zone: string; task: string; frequency: keyof typeof FREQ; done: number; lastAt: string | null }
interface Data {
  day: string; name: string; units: Unit[]; tasks: Task[];
  samples: Array<{ _id: string; itemName: string; day: string; service?: string; keepUntil: string; toDiscard: boolean }>;
  receptions: Array<{ _id: string; at: string; supplierName?: string; reference?: string; chain?: string; value?: number; packagingOk?: boolean; datesOk?: boolean; ok: boolean; lines?: Array<{ name: string; quantity: number; refused: boolean; reason?: string }> }>;
  issues: Array<{ _id: string; kind: string; at: string; unitName?: string; value?: number; action?: string; supplierName?: string; reference?: string }>;
}
interface Trace { item: string; unit: string; lotNumber: string; expiryDate: string | null; movements: Array<{ date: string; type: string; quantity: number; reason: string; document: string | null }>; tickets: Array<{ number: string; date: string; cancelled: boolean }>; dishes: Array<{ label: string; quantity: number; tickets: number; first: string; last: string }> }

/**
 * Hygiène (HACCP) d'un restaurant : relevés de température avec alerte,
 * contrôles à réception, plats témoins, plan de nettoyage, traçabilité d'un
 * lot jusqu'aux plats vendus. Un registre : on ajoute, on ne réécrit pas.
 */
export default function HygienePage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [day, setDay] = useState(() => dayOf(new Date()));
  const [setup, setSetup] = useState(false);
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const { data, loading, error, reload } = useApi<Data | null>(deskId ? `/api/restauration/hygiene?deskId=${deskId}&day=${day}` : null, d => (d?.data as Data) ?? null, null, { quiet: true });
  const today = day === dayOf(new Date());

  async function post(body: Record<string, unknown>, done: string) {
    const r = await apiSend<{ data?: { ok?: boolean }; error?: string }>("POST", "/api/restauration/hygiene", { deskId, ...body });
    if (!r.ok) { showToast(r.data.error || "Enregistrement refusé", "error"); return null; }
    showToast(done, "success"); reload(); return r.data.data ?? {};
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><ShieldCheck size={22} /> Hygiène (HACCP)</h1>
          <p className="text-sm text-ink2">Températures, réceptions, plats témoins, nettoyage et traçabilité des lots : le registre du restaurant.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          <FormField label="Jour"><input type="date" className={inputCls} value={day} max={dayOf(new Date())} onChange={e => e.target.value && setDay(e.target.value)} /></FormField>
          <button onClick={() => setSetup(x => !x)} className={buttonClass("ghost", "md")}><Settings2 size={15} /> Réglages</button>
        </div>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-64 surface-card animate-pulse" /> : !data ? null : <>
        {setup && <Setup key={JSON.stringify([data.units.map(u => [u._id, u.name, u.kind, u.min, u.max]), data.tasks.map(t => [t._id, t.zone, t.task, t.frequency])])} data={data} post={post} onDone={() => setSetup(false)} />}
        {(!data.units.length || !data.tasks.length) && !setup && <p className="text-sm text-ink3">Déclarez les enceintes à relever et le plan de nettoyage dans les réglages.</p>}

        <section className="surface-card p-4 space-y-3">
          <p className="font-semibold text-ink inline-flex items-center gap-2"><Thermometer size={16} /> Températures du {dmy(`${day}T12:00:00`)}</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.units.map(u => <UnitCard key={u._id} u={u} today={today} post={post} />)}
          </div>
        </section>

        <section className="surface-card p-4 space-y-3">
          <p className="font-semibold text-ink inline-flex items-center gap-2"><SprayCan size={16} /> Plan de nettoyage</p>
          {!data.tasks.length ? <p className="text-sm text-ink3">Aucune tâche.</p> : (
            <table className="table-dense w-full">
              <thead><tr><th>Zone</th><th>Tâche</th><th>Fréquence</th><th>État</th><th /></tr></thead>
              <tbody>{data.tasks.map(t => (
                <tr key={t._id} className="border-t border-line">
                  <td>{t.zone}</td><td>{t.task}</td><td>{FREQ[t.frequency]}</td>
                  <td>{t.done ? <Pill tone="pos">fait{t.frequency === "service" && t.done > 1 ? ` × ${t.done}` : ""}{t.lastAt ? ` à ${hhmm(t.lastAt)}` : ""}</Pill> : <Pill tone="warn">à faire</Pill>}</td>
                  <td className="text-right">{today && <button onClick={() => post({ action: "cleaning", taskId: t._id }, "Nettoyage noté")} className={buttonClass("secondary", "sm")}>Fait</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <Samples data={data} deskId={deskId} day={day} post={post} />

        <section className="surface-card p-4 space-y-3">
          <p className="font-semibold text-ink">Réceptions contrôlées (30 jours)</p>
          {!data.receptions.length ? <p className="text-sm text-ink3">Aucun contrôle : il se fait à la réception en réserve (Comptoirs → Stock).</p> : (
            <table className="table-dense w-full">
              <thead><tr><th>Date</th><th>Fournisseur</th><th>Conservation</th><th>Contrôle</th><th>Lignes refusées</th></tr></thead>
              <tbody>{data.receptions.map(r => (
                <tr key={r._id} className="border-t border-line align-top">
                  <td>{dmy(r.at)} {hhmm(r.at)}{r.reference ? <span className="block text-[11px] text-ink3">{r.reference}</span> : null}</td>
                  <td>{r.supplierName ?? "—"}</td>
                  <td>{CHAIN[r.chain ?? "ambient"]}{r.value !== undefined && r.value !== null ? ` · ${r.value} °C` : ""}</td>
                  <td>{r.ok ? <Pill tone="pos">conforme</Pill> : <Pill tone="neg">non conforme</Pill>}{r.packagingOk === false && <span className="block text-[11px] text-neg">emballages</span>}{r.datesOk === false && <span className="block text-[11px] text-neg">dates</span>}</td>
                  <td>{(r.lines ?? []).filter(l => l.refused).map((l, i) => <span key={i} className="block text-[12px]">{l.name} — {l.reason}</span>)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {data.issues.length > 0 && <p className="text-sm text-warn">{data.issues.length} non-conformité(s) sur 30 jours (températures et réceptions).</p>}
        </section>

        <Traceability deskId={deskId} />
      </>}
    </div>
  );
}

type Post = (body: Record<string, unknown>, done: string) => Promise<{ ok?: boolean } | null>;

function UnitCard({ u, today, post }: { u: Unit; today: boolean; post: Post }) {
  const [value, setValue] = useState("");
  const [action, setAction] = useState("");
  const v = Number(value.replace(",", "."));
  const out = value.trim() !== "" && Number.isFinite(v) && ((u.min !== undefined && u.min !== null && v < u.min) || (u.max !== undefined && u.max !== null && v > u.max));
  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <div className="flex justify-between gap-2"><p className="font-semibold">{u.name}</p><span className="text-[11px] text-ink3">{KINDS[u.kind]} · {lim(u)}</span></div>
      {u.readings.length ? u.readings.map(r => (
        <p key={r._id} className={`text-sm ${r.ok ? "text-ink2" : "text-neg"}`}>{hhmm(r.at)} — {r.value} °C {r.ok ? "" : "hors limites"}{r.action ? ` · ${r.action}` : ""}</p>
      )) : <p className="text-sm text-warn">Pas encore de relevé.</p>}
      {today && (
        <div className="space-y-1">
          <div className="flex gap-2"><input className={`${inputCls} w-24`} inputMode="decimal" placeholder="°C" value={value} onChange={e => setValue(e.target.value)} aria-label={`Température de ${u.name}`} />
            <button disabled={!value.trim() || (out && !action.trim())} onClick={async () => { if (await post({ action: "temperature", unitId: u._id, value: v, correctiveAction: action || undefined }, out ? "Relevé hors limites noté : les responsables sont prévenus" : "Relevé noté")) { setValue(""); setAction(""); } }} className={buttonClass("primary", "sm")}>Noter</button></div>
          {out && <input className={inputCls} placeholder="Action corrective (obligatoire hors limites)" value={action} onChange={e => setAction(e.target.value)} />}
        </div>
      )}
    </div>
  );
}

function Samples({ data, deskId, day, post }: { data: Data; deskId: string; day: string; post: Post }) {
  const [items, setItems] = useState<Array<{ _id: string; name: string; recipe?: unknown[] }>>([]);
  const [pick, setPick] = useState({ itemId: "", service: "midi" });
  useEffect(() => { if (deskId) apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => setItems(((d.data ?? []) as Array<{ _id: string; name: string; recipe?: unknown[] }>).filter(i => i.recipe?.length))).catch(() => {}); }, [deskId]);
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Soup size={16} /> Plats témoins</p>
      <div className="flex gap-2 items-end flex-wrap">
        <FormField label="Plat prélevé"><select className={selectCls} value={pick.itemId} onChange={e => setPick(p => ({ ...p, itemId: e.target.value }))}><option value="">Choisir…</option>{items.map(i => <option key={i._id} value={i._id}>{i.name}</option>)}</select></FormField>
        <FormField label="Service"><select className={selectCls} value={pick.service} onChange={e => setPick(p => ({ ...p, service: e.target.value }))}><option value="midi">Midi</option><option value="soir">Soir</option><option value="jour">Journée</option></select></FormField>
        <button disabled={!pick.itemId} onClick={() => post({ action: "sample", itemId: pick.itemId, service: pick.service, day }, "Plat témoin noté")} className={buttonClass("secondary", "sm")}><Plus size={14} /> Prélever</button>
      </div>
      {!data.samples.length ? <p className="text-sm text-ink3">Aucun plat témoin en garde.</p> : (
        <table className="table-dense w-full">
          <thead><tr><th>Plat</th><th>Prélevé le</th><th>À garder jusqu&apos;au</th><th /></tr></thead>
          <tbody>{data.samples.map(s => (
            <tr key={s._id} className="border-t border-line">
              <td>{s.itemName}</td><td>{dmy(`${s.day}T12:00:00`)}{s.service ? ` (${s.service})` : ""}</td>
              <td>{dmy(s.keepUntil)} {s.toDiscard && <Pill tone="warn">à jeter</Pill>}</td>
              <td className="text-right"><button onClick={() => post({ action: "discard", id: s._id }, "Plat témoin jeté")} className={buttonClass("ghost", "sm")}>Jeté</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="text-[11px] text-ink3">Une portion de chaque plat servi, gardée au froid 5 jours (repère usuel, à confirmer selon la réglementation applicable), à remettre aux services d&apos;hygiène en cas d&apos;intoxication.</p>
    </section>
  );
}

function Traceability({ deskId }: { deskId: string }) {
  const [items, setItems] = useState<Array<{ _id: string; name: string; recipe?: unknown[]; productId?: string }>>([]);
  const [itemId, setItemId] = useState("");
  const [lots, setLots] = useState<Array<{ lotNumber: string; expiryDate: string | null; inStock: number }>>([]);
  const [lot, setLot] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  useEffect(() => { if (deskId) apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => setItems(((d.data ?? []) as Array<{ _id: string; name: string; recipe?: unknown[]; productId?: string }>).filter(i => !i.recipe?.length && i.productId))).catch(() => {}); }, [deskId]);
  async function chooseItem(id: string) {
    setItemId(id); setLot(""); setTrace(null); setLots([]);
    if (id) apiJson(`/api/restauration/hygiene?deskId=${deskId}&lots=${id}`).then(d => setLots((d.data ?? []) as typeof lots)).catch(() => {});
  }
  async function run() {
    const d = await apiJson(`/api/restauration/hygiene?deskId=${deskId}&trace=${itemId}&lot=${encodeURIComponent(lot)}`).catch(() => null);
    if (!d?.data) return showToast("Traçabilité indisponible pour ce lot.", "error");
    setTrace(d.data as Trace);
  }
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Search size={16} /> Traçabilité d&apos;un lot</p>
      <div className="flex gap-2 items-end flex-wrap">
        <FormField label="Ingrédient"><select className={selectCls} value={itemId} onChange={e => chooseItem(e.target.value)}><option value="">Choisir…</option>{items.map(i => <option key={i._id} value={i._id}>{i.name}</option>)}</select></FormField>
        <FormField label="Lot"><select className={selectCls} value={lot} onChange={e => setLot(e.target.value)} disabled={!lots.length}><option value="">{lots.length ? "Choisir…" : "Aucun lot"}</option>{lots.map(l => <option key={l.lotNumber} value={l.lotNumber}>{l.lotNumber}{l.expiryDate ? ` — DLC ${dmy(l.expiryDate)}` : ""}{l.inStock ? ` — ${l.inStock} en stock` : ""}</option>)}</select></FormField>
        <button disabled={!lot} onClick={run} className={buttonClass("secondary", "sm")}>Tracer</button>
      </div>
      {trace && (
        <div className="space-y-3">
          <p className="text-sm text-ink2">{trace.item}, lot {trace.lotNumber}{trace.expiryDate ? `, DLC ${dmy(trace.expiryDate)}` : ""}.</p>
          <table className="table-dense w-full">
            <thead><tr><th>Date</th><th>Mouvement</th><th className="text-right">Quantité</th><th>Motif</th></tr></thead>
            <tbody>{trace.movements.map((m, i) => <tr key={i} className="border-t border-line"><td>{dmy(m.date)} {hhmm(m.date)}</td><td>{m.type}</td><td className="text-right font-mono">{m.quantity} {trace.unit}</td><td>{m.reason}</td></tr>)}</tbody>
          </table>
          <p className="font-semibold text-sm">Vendu dans</p>
          {!trace.dishes.length ? <p className="text-sm text-ink3">Aucune vente rattachée à ce lot.</p> : (
            <table className="table-dense w-full">
              <thead><tr><th>Plat ou article</th><th className="text-right">Quantité</th><th className="text-right">Tickets</th><th>Du</th><th>Au</th></tr></thead>
              <tbody>{trace.dishes.map(d => <tr key={d.label} className="border-t border-line"><td>{d.label}</td><td className="text-right font-mono">{d.quantity}</td><td className="text-right font-mono">{d.tickets}</td><td>{dmy(d.first)}</td><td>{dmy(d.last)}</td></tr>)}</tbody>
            </table>
          )}
          {trace.tickets.length > 0 && <p className="text-[11px] text-ink3">Tickets : {trace.tickets.map(t => t.number + (t.cancelled ? " (annulé)" : "")).join(", ")}</p>}
        </div>
      )}
    </section>
  );
}

function Setup({ data, post, onDone }: { data: Data; post: Post; onDone: () => void }) {
  const [units, setUnits] = useState(() => data.units.map(u => ({ _id: u._id, name: u.name, kind: u.kind as string, min: u.min === undefined || u.min === null ? "" : String(u.min), max: u.max === undefined || u.max === null ? "" : String(u.max) })));
  const [tasks, setTasks] = useState(() => data.tasks.map(t => ({ _id: t._id, zone: t.zone, task: t.task, frequency: t.frequency as string })));
  async function save() {
    const ok = await post({ action: "setup", coldUnits: units.map(u => ({ ...u, min: u.min === "" ? null : Number(u.min), max: u.max === "" ? null : Number(u.max) })), cleaningTasks: tasks }, "Réglages d'hygiène enregistrés");
    if (ok) onDone();
  }
  return (
    <section className="surface-card p-4 space-y-4">
      <p className="font-semibold text-ink">Enceintes à relever</p>
      {units.map((u, i) => (
        <div key={i} className="flex gap-2 flex-wrap items-end">
          <input className={`${inputCls} w-48`} placeholder="Nom (frigo cuisine…)" value={u.name} onChange={e => setUnits(x => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} />
          <select className={selectCls} value={u.kind} onChange={e => setUnits(x => x.map((y, j) => j === i ? { ...y, kind: e.target.value } : y))}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input className={`${inputCls} w-24`} placeholder="min °C" value={u.min} onChange={e => setUnits(x => x.map((y, j) => j === i ? { ...y, min: e.target.value } : y))} aria-label="Limite basse" />
          <input className={`${inputCls} w-24`} placeholder="max °C" value={u.max} onChange={e => setUnits(x => x.map((y, j) => j === i ? { ...y, max: e.target.value } : y))} aria-label="Limite haute" />
          <button onClick={() => setUnits(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={() => setUnits(x => [...x, { _id: "", name: "", kind: "fridge", min: "", max: "" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Enceinte</button>
      <p className="text-[11px] text-ink3">Limites vides : repères usuels (réfrigérateur 0 à +4 °C, congélateur −18 °C au plus, maintien au chaud +63 °C au moins), à adapter au plan HACCP.</p>
      <p className="font-semibold text-ink">Plan de nettoyage</p>
      {tasks.map((t, i) => (
        <div key={i} className="flex gap-2 flex-wrap items-end">
          <input className={`${inputCls} w-40`} placeholder="Zone (cuisine, salle…)" value={t.zone} onChange={e => setTasks(x => x.map((y, j) => j === i ? { ...y, zone: e.target.value } : y))} />
          <input className={`${inputCls} w-64`} placeholder="Tâche (plans de travail, sols…)" value={t.task} onChange={e => setTasks(x => x.map((y, j) => j === i ? { ...y, task: e.target.value } : y))} />
          <select className={selectCls} value={t.frequency} onChange={e => setTasks(x => x.map((y, j) => j === i ? { ...y, frequency: e.target.value } : y))}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button onClick={() => setTasks(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={() => setTasks(x => [...x, { _id: "", zone: "", task: "", frequency: "daily" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Tâche</button>
      <div><button onClick={save} className={buttonClass("primary", "md")}><Save size={15} /> Enregistrer les réglages</button></div>
    </section>
  );
}
