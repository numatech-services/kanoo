"use client";
import { useEffect, useState } from "react";
import { Gauge, Save, Link2, Unlink } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const PCT = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

interface Row { month: string; budget: { revenueHT: number; materialMargin: number; charges: number; result: number } | null; actual: { revenueHT: number; materialMargin: number; charges: number; result: number; closed: boolean } | null }
interface Data {
  month: string; desk: { _id: string; name: string }; payrollHidden: boolean; finance: boolean;
  simulation: { revenueHT: number; variable: number; variableCharges: number; fixed: number; contribution: number; contributionPct: number | null; breakEvenRevenue: number | null; safetyMarginPct: number | null; scenarios: Array<{ dropPct: number; revenueHT: number; result: number; resultPct: number | null }>; variableCategories: string[]; result: number; resultPct: number | null; provisional: boolean };
  categories: Array<{ key: string; label: string }>;
  budget: { revenue: number[]; materialPct: number; charges: Array<{ category: string; annual: number }>; note?: string } | null;
  months: Row[]; ytd: { budgetRevenue: number; actualRevenue: number; budgetResult: number; actualResult: number } | null;
  assets: Array<{ _id: string; code: string; name: string; acquisitionCost: number; depreciationMethod: string; usefulLifeYears: number; monthly: number }>;
  linkable: Array<{ _id: string; code: string; name: string; acquisitionCost: number }>;
  allocation: { commonCostShare: number; sector: Array<{ deskId: string; name: string; sectorShare: number | null }> };
}

/**
 * Pilotage d'un restaurant : ce qui est fixe et ce qui suit le volume, le
 * point mort et l'effet d'une baisse d'activité ; le budget de l'année contre
 * le réel ; les équipements et leur amortissement ; la clé de répartition
 * des charges partagées entre restaurants.
 */
export default function PilotagePage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [month, setMonth] = useState(monthOf());
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const { data, loading, error, reload } = useApi<Data | null>(deskId ? `/api/restauration/pilotage?deskId=${deskId}&month=${month}` : null, d => (d?.data as Data) ?? null, null, { quiet: true });

  async function post(body: Record<string, unknown>, done: string) {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/pilotage", { deskId, ...body });
    if (!r.ok) { showToast(r.data.error || "Enregistrement refusé", "error"); return false; }
    showToast(done, "success"); reload(); return true;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Gauge size={22} /> Pilotage</h1>
          <p className="text-sm text-ink2">Point mort, budget de l&apos;année contre le réel, amortissement des équipements et répartition des charges partagées.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          <FormField label="Mois"><input type="month" className={inputCls} value={month} max={monthOf()} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
        </div>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-64 surface-card animate-pulse" /> : !data ? null : <>
        {data.payrollHidden && <p className="text-sm text-warn">Moins de trois personnes affectées : chiffres présentés avant personnel (confidentialité de la paie).</p>}
        <Simulation key={`${data.desk._id}:${data.month}:${data.simulation.variableCategories.join(",")}`} data={data} post={post} />
        <Budget key={`b:${data.desk._id}:${data.month}:${JSON.stringify(data.budget)}`} data={data} post={post} />
        <Assets data={data} post={post} />
        {data.finance && data.allocation.sector.length > 1 && <Allocation key={`a:${JSON.stringify(data.allocation)}`} data={data} post={post} />}
      </>}
    </div>
  );
}

type Post = (body: Record<string, unknown>, done: string) => Promise<boolean>;

function Simulation({ data, post }: { data: Data; post: Post }) {
  const s = data.simulation;
  const [cats, setCats] = useState<string[]>(s.variableCategories);
  const [edit, setEdit] = useState(false);
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold text-ink">Charges fixes et variables — {data.month}{s.provisional && <span className="ml-2"><Pill tone="info">mois en cours</Pill></span>}</p>
        <button onClick={() => setEdit(x => !x)} className={buttonClass("ghost", "sm")}>{edit ? "Fermer" : "Charges variables…"}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="CA HT" value={MONEY(s.revenueHT)} />
        <Kpi label="Coûts variables" value={MONEY(s.variable)} hint={`dont charges variables ${MONEY(s.variableCharges)}`} />
        <Kpi label="Charges fixes" value={MONEY(s.fixed)} />
        <Kpi label="Marge sur coûts variables" value={PCT(s.contributionPct)} hint={MONEY(s.contribution)} />
        <Kpi label="Point mort (CA HT)" value={MONEY(s.breakEvenRevenue)} hint={s.breakEvenRevenue === null ? "les coûts variables absorbent tout le CA" : undefined} />
        <Kpi label="Marge de sécurité" value={PCT(s.safetyMarginPct)} hint="baisse de CA supportable avant perte" tone={s.safetyMarginPct !== null && s.safetyMarginPct < 0 ? "neg" : undefined} />
        <Kpi label="Résultat du mois" value={MONEY(s.result)} hint={PCT(s.resultPct)} tone={s.result < 0 ? "neg" : undefined} />
      </div>
      <table className="table-dense w-full">
        <thead><tr><th>Si le volume vendu baisse de</th><th className="text-right">CA HT</th><th className="text-right">Résultat</th><th className="text-right">Marge nette</th></tr></thead>
        <tbody>{s.scenarios.map(x => (
          <tr key={x.dropPct} className="border-t border-line"><td>{x.dropPct} %</td><td className="text-right font-mono">{MONEY(x.revenueHT)}</td><td className={`text-right font-mono ${x.result < 0 ? "text-neg" : ""}`}>{MONEY(x.result)}</td><td className="text-right font-mono">{PCT(x.resultPct)}</td></tr>
        ))}</tbody>
      </table>
      <p className="text-[11px] text-ink3">Prix et coûts unitaires supposés inchangés : la matière et les charges variables baissent avec le volume, les charges fixes restent.</p>
      {edit && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink2">Rubriques qui suivent le volume vendu dans ce restaurant :</p>
          <div className="flex flex-wrap gap-1.5">
            {data.categories.map(c => {
              const on = cats.includes(c.key);
              return <button key={c.key} onClick={() => setCats(x => on ? x.filter(y => y !== c.key) : [...x, c.key])} className={`h-8 px-3 rounded-full border text-[12px] ${on ? "bg-ink text-white border-ink" : "border-line text-ink2"}`} aria-pressed={on}>{c.label}</button>;
            })}
          </div>
          <button onClick={() => post({ action: "allocation", variableCategories: cats }, "Charges variables enregistrées")} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer</button>
        </div>
      )}
    </section>
  );
}

function Budget({ data, post }: { data: Data; post: Post }) {
  const year = Number(data.month.slice(0, 4));
  const [edit, setEdit] = useState(false);
  const [rev, setRev] = useState<string[]>(() => (data.budget?.revenue ?? Array(12).fill(0)).map(n => String(n || "")));
  const [pct, setPct] = useState(() => String(Math.round((data.budget?.materialPct ?? 0.35) * 1000) / 10));
  const [charges, setCharges] = useState<Record<string, string>>(() => Object.fromEntries((data.budget?.charges ?? []).map(c => [c.category, String(c.annual)])));
  const gap = (b?: number, a?: number) => (b === undefined || a === undefined ? null : a - b);
  async function save() {
    const ok = await post({ action: "budget", year, revenue: rev.map(v => Number(v) || 0), materialPct: (Number(pct) || 0) / 100, charges: Object.entries(charges).map(([category, v]) => ({ category, annual: Number(v) || 0 })) }, `Budget ${year} enregistré`);
    if (ok) setEdit(false);
  }
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-semibold text-ink">Budget {year} et réel</p>
        <button onClick={() => setEdit(x => !x)} className={buttonClass("secondary", "sm")}>{edit ? "Fermer" : data.budget ? "Modifier le budget" : "Établir le budget"}</button>
      </div>
      {edit && (
        <div className="space-y-3 border border-line rounded-lg p-3">
          <p className="text-sm text-ink2">Chiffre d&apos;affaires HT prévu, mois par mois (vacances, examens, rentrée).</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {MONTHS.map((l, k) => <FormField key={k} label={l}><input className={inputCls} inputMode="numeric" value={rev[k]} onChange={e => setRev(x => x.map((y, j) => j === k ? e.target.value : y))} /></FormField>)}
          </div>
          <FormField label="Coût matière visé (% du CA HT)"><input className={`${inputCls} w-28`} inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></FormField>
          <p className="text-sm text-ink2">Charges annuelles par rubrique (réparties en douzièmes).</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.categories.filter(c => !(data.payrollHidden && c.key === "personnel")).map(c => (
              <FormField key={c.key} label={c.label}><input className={inputCls} inputMode="numeric" value={charges[c.key] ?? ""} onChange={e => setCharges(x => ({ ...x, [c.key]: e.target.value }))} /></FormField>
            ))}
          </div>
          <button onClick={save} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer le budget</button>
        </div>
      )}
      {!data.budget ? <p className="text-sm text-ink3">Pas de budget pour {year}.</p> : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full min-w-[640px]">
            <thead><tr><th>Mois</th><th className="text-right">CA budget</th><th className="text-right">CA réel</th><th className="text-right">Écart</th><th className="text-right">Résultat budget</th><th className="text-right">Résultat réel</th><th className="text-right">Écart</th></tr></thead>
            <tbody>
              {data.months.map((r, k) => {
                const g1 = gap(r.budget?.revenueHT, r.actual?.revenueHT), g2 = gap(r.budget?.result, r.actual?.result);
                return (
                  <tr key={r.month} className="border-t border-line">
                    <td>{MONTHS[k]}{r.actual?.closed && <span className="ml-1"><Pill tone="mute">clos</Pill></span>}</td>
                    <td className="text-right font-mono">{MONEY(r.budget?.revenueHT)}</td>
                    <td className="text-right font-mono">{r.actual ? MONEY(r.actual.revenueHT) : ""}</td>
                    <td className={`text-right font-mono ${g1 !== null && g1 < 0 ? "text-neg" : ""}`}>{g1 === null ? "" : MONEY(g1)}</td>
                    <td className="text-right font-mono">{MONEY(r.budget?.result)}</td>
                    <td className="text-right font-mono">{r.actual ? MONEY(r.actual.result) : ""}</td>
                    <td className={`text-right font-mono ${g2 !== null && g2 < 0 ? "text-neg" : ""}`}>{g2 === null ? "" : MONEY(g2)}</td>
                  </tr>
                );
              })}
              {data.ytd && (
                <tr className="border-t-2 border-ink font-semibold">
                  <td>Cumul à fin {MONTHS[Number(data.month.slice(5)) - 1]}</td>
                  <td className="text-right font-mono">{MONEY(data.ytd.budgetRevenue)}</td><td className="text-right font-mono">{MONEY(data.ytd.actualRevenue)}</td>
                  <td className="text-right font-mono">{MONEY(data.ytd.actualRevenue - data.ytd.budgetRevenue)}</td>
                  <td className="text-right font-mono">{MONEY(data.ytd.budgetResult)}</td><td className="text-right font-mono">{MONEY(data.ytd.actualResult)}</td>
                  <td className={`text-right font-mono ${data.ytd.actualResult < data.ytd.budgetResult ? "text-neg" : ""}`}>{MONEY(data.ytd.actualResult - data.ytd.budgetResult)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Assets({ data, post }: { data: Data; post: Post }) {
  const [pick, setPick] = useState("");
  const total = data.assets.reduce((t, a) => t + a.monthly, 0);
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink">Équipements et amortissements</p>
      <p className="text-[12px] text-ink3">Équipements du registre des immobilisations rattachés au restaurant : leur dotation est comptée chaque mois, au prorata des jours. Elle remplace les dotations annuelles imputées au secteur.</p>
      {!data.assets.length ? <p className="text-sm text-ink3">Aucun équipement rattaché.</p> : (
        <table className="table-dense w-full">
          <thead><tr><th>Équipement</th><th className="text-right">Coût d&apos;acquisition</th><th>Amortissement</th><th className="text-right">Dotation du mois</th>{data.finance && <th />}</tr></thead>
          <tbody>
            {data.assets.map(a => (
              <tr key={a._id} className="border-t border-line">
                <td>{a.name}<span className="block text-[11px] text-ink3">{a.code}</span></td>
                <td className="text-right font-mono">{MONEY(a.acquisitionCost)}</td>
                <td>{a.depreciationMethod === "degressive" ? "dégressif" : a.depreciationMethod === "none" ? "aucun" : "linéaire"}, {a.usefulLifeYears} ans</td>
                <td className="text-right font-mono">{MONEY(a.monthly)}</td>
                {data.finance && <td className="text-right"><button onClick={() => post({ action: "unlink", assetId: a._id }, "Équipement détaché")} className={buttonClass("ghost", "sm")} title="Détacher du restaurant"><Unlink size={13} /></button></td>}
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold"><td colSpan={3}>Dotation du mois</td><td className="text-right font-mono">{MONEY(total)}</td>{data.finance && <td />}</tr>
          </tbody>
        </table>
      )}
      {data.linkable.length > 0 && (
        <div className="flex gap-2 items-end flex-wrap">
          <FormField label="Rattacher un équipement"><select className={selectCls} value={pick} onChange={e => setPick(e.target.value)}><option value="">Choisir…</option>{data.linkable.map(a => <option key={a._id} value={a._id}>{a.name} ({a.code}) — {MONEY(a.acquisitionCost)}</option>)}</select></FormField>
          <button disabled={!pick} onClick={async () => { if (await post({ action: "link", assetId: pick }, "Équipement rattaché")) setPick(""); }} className={buttonClass("secondary", "sm")}><Link2 size={14} /> Rattacher</button>
        </div>
      )}
    </section>
  );
}

function Allocation({ data, post }: { data: Data; post: Post }) {
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(data.allocation.sector.map(s => [s.deskId, s.sectorShare === null ? "" : String(Math.round(s.sectorShare * 1000) / 10)])));
  const total = Object.values(shares).reduce((t, v) => t + (Number(v) || 0), 0);
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink">Répartition des charges du secteur partagé</p>
      <p className="text-[12px] text-ink3">Ces restaurants partagent le même secteur analytique : ses charges (eau, électricité, loyer…) sont réparties selon la part de chacun — surface, couverts servis, heures d&apos;ouverture. Laissez tout vide pour des parts égales.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.allocation.sector.map(s => (
          <FormField key={s.deskId} label={`${s.name} (%)`}><input className={inputCls} inputMode="decimal" value={shares[s.deskId]} onChange={e => setShares(x => ({ ...x, [s.deskId]: e.target.value }))} /></FormField>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm ${Math.abs(total - 100) > 0.05 && total > 0 ? "text-warn" : "text-ink2"}`}>Total : {total.toLocaleString("fr-FR")} %</span>
        <button onClick={() => post({ action: "allocation", shares: data.allocation.sector.map(s => ({ deskId: s.deskId, share: shares[s.deskId] === "" ? null : Number(shares[s.deskId]) / 100 })) }, "Clé de répartition enregistrée")} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer</button>
      </div>
    </section>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "neg" }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-[12px] text-ink3">{label}</p>
      <p className={`font-mono font-semibold ${tone === "neg" ? "text-neg" : "text-ink"}`}>{value}</p>
      {hint && <p className="text-[11px] text-ink3">{hint}</p>}
    </div>
  );
}
