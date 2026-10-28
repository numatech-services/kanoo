"use client";
import { useEffect, useState } from "react";
import { CalendarClock, ChefHat, Printer, Plus, Trash2, Upload, Save, AlertTriangle, GraduationCap, FileText } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { DAYS_FR, PERIOD_KINDS, parseTimetableCsv, type Course, type Period, type Service } from "@/lib/campus";
import { planningToSchedule, type Planning } from "@/lib/timetable-pdf";

const MONEY = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} FCFA`;
const NUM = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const h = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const frDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

interface PlanService { key: string; label: string; from: string; to: string; presence: number; groups: number; factor: number; periods: string[]; items: Array<{ itemId: string; name: string; unit: string; quantity: number; prepared: boolean }> }
interface Plan {
  configured: boolean; day: string; safetyMargin?: number; learnedItems?: number;
  services?: PlanService[];
  ingredients?: Array<{ itemId: string; name: string; unit: string; needed: number; stock: number; missing: number }>;
  shortfall?: Array<{ itemId: string; name: string; unit: string; needed: number; stock: number; missing: number }>;
  week?: Array<{ day: string; services: Array<{ key: string; presence: number }>; periods: string[]; expectedRevenue: number }>;
}
interface ScheduleData { services: Service[]; courses: Course[]; periods: Period[]; safetyMargin: number; updatedAt: string | null }

/**
 * Planning du restaurant de campus : les quantités suivent l'emploi du temps.
 * En haut, le plan de production d'un jour (présence attendue à chaque repas,
 * quantités à préparer, ingrédients et manques) ; en bas, l'emploi du temps
 * qui le règle (services, cours, vacances et examens).
 */
export function PlanningTab({ deskId, deskName }: { deskId: string; deskName: string }) {
  const [day, setDay] = useState(tomorrow);
  const { data: plan, reload } = useApi<Plan | null>(`/api/comptoir/production?deskId=${deskId}&day=${day}`, d => d?.data ?? null, null);
  return (
    <div className="space-y-6">
      <ProductionView plan={plan} day={day} setDay={setDay} deskName={deskName} />
      <ScheduleEditor deskId={deskId} onSaved={reload} />
    </div>
  );
}

function ProductionView({ plan, day, setDay, deskName }: { plan: Plan | null; day: string; setDay: (d: string) => void; deskName: string }) {
  if (!plan) return <div className="h-40 surface-card animate-pulse" />;
  if (!plan.configured) return <EmptyState icon={<GraduationCap size={20} />} title="Emploi du temps à renseigner" hint="Saisissez (ou importez) l'emploi du temps du campus ci-dessous : les quantités à préparer et à commander suivront les cours, les vacances et les examens." />;

  function print() {
    if (!plan) return;
    const blocks = (plan.services ?? []).filter(s => s.items.length).map(s => `<h2>${h(s.label)} (${h(s.from)}–${h(s.to)}) — ${s.presence} personne(s) attendue(s)</h2><table>${s.items.map(i => `<tr><td>☐ ${h(i.name)}</td><td class="r">${h(NUM(i.quantity))} ${h(i.unit)}</td></tr>`).join("")}</table>`).join("");
    const ing = (plan.ingredients ?? []).map(i => `<tr><td>${h(i.name)}</td><td class="r">${h(NUM(i.needed))} ${h(i.unit)}</td><td class="r">${i.missing > 0 ? `<b>manque ${h(NUM(i.missing))}</b>` : "ok"}</td></tr>`).join("");
    const w = window.open("", "_blank");
    if (w) { w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Production ${h(plan.day)}</title><style>body{font-family:system-ui,Arial;padding:24px;font-size:13px}h1{font-size:18px}h2{font-size:14px;margin-top:16px}table{width:100%;border-collapse:collapse}td{padding:5px;border-bottom:1px solid #ddd}.r{text-align:right}</style></head><body><h1>${h(deskName)} — fiche de production du ${h(frDay(plan.day))}</h1>${blocks || "<p>Rien à préparer.</p>"}<h2>Ingrédients et articles à sortir</h2><table>${ing}</table></body></html>`); w.document.close(); w.print(); }
  }

  const services = plan.services ?? [];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink inline-flex items-center gap-2"><ChefHat size={16} /> Production du {frDay(plan.day)}</h3>
          <p className="text-xs text-ink2">Présence d&apos;après l&apos;emploi du temps × consommation par personne apprise sur les 28 derniers jours, + {Math.round((plan.safetyMargin ?? 0.1) * 100)} % de marge.{plan.learnedItems === 0 ? " Pas encore d'historique de ventes : les quantités apparaîtront après quelques jours de tickets." : ""}</p>
        </div>
        <div className="flex gap-2 items-end">
          <FormField label="Jour"><input type="date" className={inputCls} value={day} onChange={e => setDay(e.target.value)} /></FormField>
          <button onClick={print} className={buttonClass("secondary", "md")}><Printer size={15} /> Fiche de production</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map(s => (
          <div key={s.key} className="surface-card p-4 space-y-2">
            <div className="flex justify-between items-start gap-2">
              <div><p className="font-semibold text-ink">{s.label}</p><p className="text-xs text-ink3">{s.from}–{s.to}</p></div>
              <div className="text-right"><p className="text-xl font-bold text-ink">{s.presence}</p><p className="text-[11px] text-ink3">présent(s){s.groups ? ` · ${s.groups} groupe(s)` : ""}</p></div>
            </div>
            {s.periods.length > 0 && <div className="flex flex-wrap gap-1">{s.periods.map(p => <Pill key={p} tone="warn">{p}</Pill>)}</div>}
            {s.items.length === 0 ? <p className="text-xs text-ink3">Rien à prévoir.</p> : (
              <ul className="text-sm divide-y divide-line">
                {s.items.slice(0, 8).map(i => <li key={i.itemId} className="py-1 flex justify-between gap-2"><span className="text-ink truncate">{i.name}{i.prepared && <span className="text-[11px] text-section"> · à préparer</span>}</span><span className="font-mono">{NUM(i.quantity)}</span></li>)}
                {s.items.length > 8 && <li className="py-1 text-xs text-ink3">… et {s.items.length - 8} autre(s)</li>}
              </ul>
            )}
          </div>
        ))}
      </div>

      {(plan.shortfall?.length ?? 0) > 0 && (
        <div className="px-4 py-3 rounded-xl bg-neg-50 border border-neg/25 text-sm text-neg">
          <p className="font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={15} /> Stock insuffisant pour ce jour :</p>
          <p>{plan.shortfall!.map(i => `${i.name} : manque ${NUM(i.missing)} ${i.unit} (besoin ${NUM(i.needed)}, stock ${NUM(i.stock)})`).join(" · ")}</p>
        </div>
      )}

      {plan.week && (
        <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Semaine</th>{services.map(s => <th key={s.key} className="text-right">{s.label}</th>)}<th className="text-right">CA attendu</th></tr></thead>
            <tbody>
              {plan.week.map(w => (
                <tr key={w.day} className={w.day === plan.day ? "bg-section/5" : ""}>
                  <td className="text-ink whitespace-nowrap">{frDay(w.day)}{w.periods.length > 0 && <span className="block text-[11px] text-warn">{w.periods.join(", ")}</span>}</td>
                  {services.map(s => <td key={s.key} className="text-right font-mono">{w.services.find(x => x.key === s.key)?.presence ?? 0}</td>)}
                  <td className="text-right font-mono">{MONEY(w.expectedRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
    </section>
  );
}

function ScheduleEditor({ deskId, onSaved }: { deskId: string; onSaved: () => void }) {
  const { data, reload } = useApi<ScheduleData | null>(`/api/comptoir/schedule?deskId=${deskId}`, d => d?.data ?? null, null);
  const [s, setS] = useState<ScheduleData | null>(null);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  // Copie éditable de l'emploi du temps lu (rechargée après enregistrement).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- copie locale des données lues
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return <div className="h-40 surface-card animate-pulse" />;

  const setService = (i: number, p: Partial<Service>) => setS(x => x && ({ ...x, services: x.services.map((v, j) => (j === i ? { ...v, ...p } : v)) }));
  const setCourse = (i: number, p: Partial<Course>) => setS(x => x && ({ ...x, courses: x.courses.map((v, j) => (j === i ? { ...v, ...p } : v)) }));
  const setPeriod = (i: number, p: Partial<Period>) => setS(x => x && ({ ...x, periods: x.periods.map((v, j) => (j === i ? { ...v, ...p } : v)) }));
  const groups = [...s.courses.reduce((m, c) => m.set(c.group, { group: c.group, headcount: Math.max(m.get(c.group)?.headcount ?? 0, c.headcount), n: (m.get(c.group)?.n ?? 0) + 1 }), new Map<string, { group: string; headcount: number; n: number }>()).values()];
  const students = (d: number) => s.courses.filter(c => c.day === d).reduce((m, c) => m.set(c.group, Math.max(m.get(c.group) ?? 0, c.headcount)), new Map<string, number>());

  function importCsv(replace: boolean) {
    const r = parseTimetableCsv(csv);
    if (!r.courses.length) { showToast(r.errors[0] ?? "Aucun cours lisible.", "error"); return; }
    setS(x => x && ({ ...x, courses: replace ? r.courses : [...x.courses, ...r.courses] }));
    showToast(`${r.courses.length} cours importé(s)${r.errors.length ? `, ${r.errors.length} ligne(s) ignorée(s)` : ""}. Pensez à enregistrer.`, r.errors.length ? "warning" : "success");
    setCsv("");
  }
  async function save() {
    if (!s) return;
    setBusy(true);
    const res = await apiSend("PUT", "/api/comptoir/schedule", { deskId, services: s.services, courses: s.courses, periods: s.periods, safetyMargin: s.safetyMargin });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
    showToast("Emploi du temps enregistré.", "success"); reload(); onSaved();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2"><CalendarClock size={16} /> Emploi du temps du campus</h3>
        <button disabled={busy} onClick={save} className={buttonClass("primary", "md")}><Save size={15} /> Enregistrer</button>
      </div>

      <div className="surface-card p-4 space-y-2">
        <p className="text-sm font-semibold text-ink">Services (repas)</p>
        <p className="text-xs text-ink3">« Public de base » : personnes présentes même sans cours (résidents, personnel). Un groupe compte pour un repas s&apos;il a cours dans l&apos;heure qui précède ou suit.</p>
        {s.services.map((v, i) => (
          <div key={v.key} className="grid grid-cols-12 gap-2 items-center">
            <input className={`${inputCls} col-span-4`} value={v.label} maxLength={40} onChange={e => setService(i, { label: e.target.value })} aria-label="Service" />
            <input type="time" className={`${inputCls} col-span-3`} value={v.from} onChange={e => setService(i, { from: e.target.value })} aria-label="Début" />
            <input type="time" className={`${inputCls} col-span-3`} value={v.to} onChange={e => setService(i, { to: e.target.value })} aria-label="Fin" />
            <input type="number" min={0} className={`${inputCls} col-span-2`} value={v.base ?? 0} onChange={e => setService(i, { base: Number(e.target.value) || 0 })} aria-label="Public de base" title="Public de base" />
          </div>
        ))}
        <FormField label="Marge de sécurité (%)"><input type="number" min={0} max={100} className={`${inputCls} max-w-32`} value={Math.round(s.safetyMargin * 100)} onChange={e => setS(x => x && ({ ...x, safetyMargin: (Number(e.target.value) || 0) / 100 }))} /></FormField>
      </div>

      <div className="surface-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink">Cours ({s.courses.length})</p>
          <button onClick={() => setS(x => x && ({ ...x, courses: [...x.courses, { day: 1, from: "08:00", to: "12:00", group: "", headcount: 30 }] }))} className={buttonClass("ghost", "sm")}><Plus size={14} /> Ajouter un cours</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
          {[1, 2, 3, 4, 5, 6, 0].map(d => { const m = students(d); return <div key={d} className="rounded-lg border border-line p-1.5"><p className="font-semibold text-ink">{DAYS_FR[d].slice(0, 3)}</p><p className="text-ink2">{m.size} gr. · {[...m.values()].reduce((t, n) => t + n, 0)} ét.</p></div>; })}
        </div>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groups.map(g => (
              <span key={g.group} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line text-sm">
                <b className="text-ink">{g.group}</b><span className="text-ink2">{g.headcount} ét. · {g.n} créneau(x)</span>
                <input type="number" min={1} className="w-20 h-7 px-1 rounded border border-line2 text-right font-mono text-xs" value={g.headcount} title="Effectif de la classe" aria-label={`Effectif — ${g.group}`}
                  onChange={e => setS(x => x && ({ ...x, courses: x.courses.map(c => (c.group === g.group ? { ...c, headcount: Number(e.target.value) || 0 } : c)) }))} />
                <button onClick={() => setS(x => x && ({ ...x, courses: x.courses.filter(c => c.group !== g.group) }))} className="text-ink3 hover:text-neg" title="Retirer la classe"><Trash2 size={13} /></button>
              </span>
            ))}
          </div>
        )}
        {s.courses.length > 0 && (
          <details>
          <summary className="cursor-pointer text-sm text-section">Détail des créneaux ({s.courses.length})</summary>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="table-dense">
              <thead><tr><th>Jour</th><th>Début</th><th>Fin</th><th>Groupe / classe</th><th className="text-right">Effectif</th><th></th></tr></thead>
              <tbody>
                {s.courses.map((c, i) => (
                  <tr key={i}>
                    <td><select className={`${selectCls} h-8`} value={c.day} onChange={e => setCourse(i, { day: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 0].map(d => <option key={d} value={d}>{DAYS_FR[d]}</option>)}</select></td>
                    <td><input type="time" className={`${inputCls} h-8`} value={c.from} onChange={e => setCourse(i, { from: e.target.value })} /></td>
                    <td><input type="time" className={`${inputCls} h-8`} value={c.to} onChange={e => setCourse(i, { to: e.target.value })} /></td>
                    <td><input className={`${inputCls} h-8`} maxLength={60} value={c.group} placeholder="L1 Informatique" onChange={e => setCourse(i, { group: e.target.value })} />{(c.label || c.start) && <span className="block text-[11px] text-ink3">{c.label}{c.start ? ` · ${c.start.split("-").reverse().join(".")} → ${(c.end ?? "").split("-").reverse().join(".")}` : ""}</span>}</td>
                    <td><input type="number" min={1} className={`${inputCls} h-8 w-24 text-right`} value={c.headcount} onChange={e => setCourse(i, { headcount: Number(e.target.value) || 0 })} /></td>
                    <td><button onClick={() => setS(x => x && ({ ...x, courses: x.courses.filter((_, j) => j !== i) }))} className="p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        )}
        <PdfImport deskId={deskId} onApply={(courses, periods, services) => setS(x => x && ({
          ...x,
          courses: [...x.courses.filter(c => !courses.some(n => n.group === c.group)), ...courses],
          periods: [...x.periods, ...periods.filter(p => !x.periods.some(q => q.from === p.from && q.to === p.to && q.label === p.label))],
          services: services ?? x.services,
        }))} services={s.services} />
        <details className="text-sm">
          <summary className="cursor-pointer text-section">Importer l&apos;emploi du temps (CSV ou copier-coller depuis Excel)</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-ink3">Une ligne par cours : <code>jour ; début ; fin ; groupe ; effectif</code> — ex. <code>Lundi;08:00;12:00;L1 Info;120</code>.</p>
            <input type="file" accept=".csv,.txt" className="text-sm" onChange={async e => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
            <textarea className={`${inputCls} h-24 font-mono text-xs`} value={csv} onChange={e => setCsv(e.target.value.replace(/\t/g, ";"))} placeholder={"Lundi;08:00;12:00;L1 Info;120"} />
            <div className="flex gap-2">
              <button disabled={!csv.trim()} onClick={() => importCsv(false)} className={buttonClass("secondary", "sm")}><Upload size={14} /> Ajouter aux cours</button>
              <button disabled={!csv.trim()} onClick={() => importCsv(true)} className={buttonClass("secondary", "sm")}>Remplacer tous les cours</button>
            </div>
          </div>
        </details>
      </div>

      <div className="surface-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink">Périodes (vacances, examens, fériés, événements)</p>
          <button onClick={() => { const y = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1; setS(x => x && ({ ...x, periods: [...x.periods, { from: `${y}-12-25`, to: `${y + 1}-01-03`, label: "Vacances de fin d'année", kind: "holiday", factor: 0 }] })); }} className={buttonClass("ghost", "sm")}>+ Vacances de fin d&apos;année</button>
          <button onClick={() => setS(x => x && ({ ...x, periods: [...x.periods, { from: tomorrow(), to: tomorrow(), label: "", kind: "holiday", factor: PERIOD_KINDS.holiday.factor }] }))} className={buttonClass("ghost", "sm")}><Plus size={14} /> Ajouter une période</button>
        </div>
        <p className="text-xs text-ink3">Coefficient appliqué à la présence : 0,1 = 10 % des étudiants (vacances), 0 = fermé, 1,5 = affluence (journée portes ouvertes).</p>
        {s.periods.map((p, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <input className={`${inputCls} col-span-12 sm:col-span-3`} maxLength={80} placeholder="Vacances de Noël" value={p.label} onChange={e => setPeriod(i, { label: e.target.value })} />
            <select className={`${selectCls} col-span-4 sm:col-span-2`} value={p.kind} onChange={e => { const k = e.target.value as Period["kind"]; setPeriod(i, { kind: k, factor: PERIOD_KINDS[k].factor }); }}>
              {Object.entries(PERIOD_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="date" className={`${inputCls} col-span-4 sm:col-span-2`} value={p.from} onChange={e => setPeriod(i, { from: e.target.value })} />
            <input type="date" className={`${inputCls} col-span-4 sm:col-span-2`} value={p.to} onChange={e => setPeriod(i, { to: e.target.value })} />
            <input type="number" min={0} max={5} step={0.05} className={`${inputCls} col-span-8 sm:col-span-2`} value={p.factor} onChange={e => setPeriod(i, { factor: Number(e.target.value) })} title="Coefficient" />
            <button onClick={() => setS(x => x && ({ ...x, periods: x.periods.filter((_, j) => j !== i) }))} className="col-span-4 sm:col-span-1 p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Imported extends Planning { file: string; error?: string }

/** Pause → service de vente (clé stable). */
function breakService(b: { from: string; to: string }): Service {
  const morning = b.from < "12:00";
  return { key: morning ? "morning_break" : "break", label: morning ? "Pause du matin" : "Pause de l'après-midi", from: b.from, to: b.to, base: 0 };
}

/**
 * Import de plannings de semestre en PDF : Kanoo lit la classe, les cours
 * (dates, jours, heures), la révision et les examens ; on saisit l'effectif
 * de chaque promotion (les premières années font l'essentiel du campus),
 * puis on ajoute à l'emploi du temps.
 */
function PdfImport({ deskId, services, onApply }: { deskId: string; services: Service[]; onApply: (courses: Course[], periods: Period[], services?: Service[]) => void }) {
  const [list, setList] = useState<Imported[]>([]);
  const [heads, setHeads] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [align, setAlign] = useState(true);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.append("deskId", deskId);
    for (const f of Array.from(files)) fd.append("files", f);
    setBusy(true);
    const res = await apiSend("POST", "/api/comptoir/schedule/import", fd);
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Lecture refusée.", "error"); return; }
    const pl = res.data.data.plannings as Imported[];
    setList(pl);
    setNames(Object.fromEntries(pl.map(p => [p.file, p.className || p.file.replace(/\.pdf$/i, "")])));
  }

  const ready = list.filter(p => !p.error && Number(heads[p.file]) > 0);
  const breaks = [...new Map(list.flatMap(p => p.breaks ?? []).map(b => [`${b.from}-${b.to}`, b])).values()];
  // Déjeuner : entre la fin des cours du matin et la reprise de l'après-midi.
  const slots = list.flatMap(p => (p.entries ?? []).flatMap(e => e.slots));
  const amEnd = slots.filter(x => x.to <= "13:30").map(x => x.to).sort().pop();
  const pmStart = slots.filter(x => x.from >= "12:30").map(x => x.from).sort()[0];

  function apply() {
    const courses: Course[] = [], periods: Period[] = [];
    for (const p of ready) { const r = planningToSchedule(p, (names[p.file] || p.className).slice(0, 60), Math.round(Number(heads[p.file]))); courses.push(...r.courses); periods.push(...r.periods); }
    const uniq = periods.filter((p, i) => periods.findIndex(q => q.from === p.from && q.to === p.to && q.label === p.label) === i);
    let next: Service[] | undefined;
    if (align) {
      next = services.filter(v => v.key !== "break" && v.key !== "morning_break").map(v => (v.key === "lunch" && amEnd && pmStart && amEnd < pmStart ? { ...v, from: amEnd, to: pmStart } : v));
      for (const b of breaks) next.push(breakService(b));
      next.sort((a, b) => a.from.localeCompare(b.from));
    }
    onApply(courses, uniq, next);
    showToast(`${ready.length} classe(s) ajoutée(s) (${courses.length} créneaux). Pensez à enregistrer.`, "success");
    setList([]); setHeads({});
  }

  return (
    <div className="rounded-xl border border-section/30 bg-section/5 p-3 space-y-3">
      <p className="text-sm font-semibold text-ink inline-flex items-center gap-2"><FileText size={15} /> Importer des plannings de cours (PDF)</p>
      <p className="text-xs text-ink2">Plannings de semestre de l&apos;école (une classe par fichier) : Kanoo lit les cours, leurs dates, jours et heures, la révision et les examens.</p>
      <input type="file" accept="application/pdf,.pdf" multiple disabled={busy} className="text-sm" onChange={e => upload(e.target.files)} />
      {busy && <p className="text-xs text-ink3">Lecture des plannings…</p>}
      {list.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-warn">Saisissez l&apos;effectif réel de chaque promotion : les premières années forment le gros des étudiants et pèsent le plus dans les quantités.</p>
          {list.map(p => (
            <div key={p.file} className="surface-card p-3 text-sm space-y-1">
              {p.error ? <p className="text-neg">{p.file} : {p.error}</p> : (
                <>
                  <div className="grid sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-6">
                      <FormField label="Classe"><input className={inputCls} maxLength={60} value={names[p.file] ?? ""} onChange={e => setNames(n => ({ ...n, [p.file]: e.target.value }))} /></FormField>
                      <p className="text-[11px] text-ink3">{[p.program, p.year].filter(Boolean).join(" · ")}{p.validFrom ? ` · du ${p.validFrom.split("-").reverse().join(".")} au ${(p.validTo ?? "").split("-").reverse().join(".")}` : ""}</p>
                    </div>
                    <div className="sm:col-span-3"><FormField label="Effectif" required><input type="number" min={1} className={inputCls} value={heads[p.file] ?? ""} onChange={e => setHeads(h => ({ ...h, [p.file]: e.target.value }))} placeholder="ex. 180" /></FormField></div>
                    <div className="sm:col-span-3 text-xs text-ink2 pb-2">{p.firstYear && <Pill tone="info">1re année</Pill>} {p.entries.filter(e => e.kind !== "exams" && e.kind !== "revision").length} cours{p.entries.some(e => e.kind === "exams") ? " · examens" : ""}</div>
                  </div>
                  {p.warnings.length > 0 && <p className="text-xs text-warn">{p.warnings.join(" ")}</p>}
                </>
              )}
            </div>
          ))}
          {breaks.length > 0 && (
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="accent-section mt-0.5" checked={align} onChange={e => setAlign(e.target.checked)} />
              <span>Caler les repas sur le planning : {amEnd && pmStart ? `déjeuner ${amEnd}–${pmStart}, ` : ""}{breaks.map(b => `pause ${b.from}–${b.to}`).join(", ")}.</span>
            </label>
          )}
          <button disabled={!ready.length} onClick={apply} className={buttonClass("primary", "sm")}><Upload size={14} /> Ajouter {ready.length} classe(s) à l&apos;emploi du temps</button>
        </div>
      )}
    </div>
  );
}
