"use client";
import { useState } from "react";
import Link from "next/link";
import { Users, Plus, Trash2, FileSpreadsheet } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const fmtDay = (d: string) => d.split("-").reverse().join("/");
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

interface Member { employeeId: string; name: string; position?: string; active: boolean; share: number; from?: string; to?: string; payslip?: boolean; payslipId?: string; paid?: boolean; allocated?: number }
interface Data { month: string; payroll: boolean; desks: Array<{ deskId: string; name: string; staff: Member[] }>; unassigned: Array<{ employeeId: string; name: string; position?: string }> }

/**
 * Équipe et paie des restaurants : qui travaille où et pour quelle part de son
 * temps ; pour qui gère la paie, le coût employeur du mois imputé à chaque
 * restaurant et l'état des bulletins. L'affectation fait entrer ce coût dans
 * le résultat du restaurant.
 */
export default function EquipePage() {
  const [month, setMonth] = useState(monthOf());
  const { data, loading, error, reload } = useApi<Data | null>(`/api/restauration/team?month=${month}`, d => (d?.data as Data) ?? null, null, { quiet: true });
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<Array<{ employeeId: string; share: string; from: string; to: string }>>([]);
  const [busy, setBusy] = useState(false);

  function startEdit(deskId: string) {
    const d = data?.desks.find(x => x.deskId === deskId);
    setDraft((d?.staff ?? []).map(s => ({ employeeId: s.employeeId, share: String(Math.round(s.share * 100)), from: s.from ?? "", to: s.to ?? "" })));
    setEdit(deskId);
  }
  async function save(deskId: string) {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("PATCH", "/api/restauration/team", { deskId, staff: draft.filter(s => s.employeeId && Number(s.share) > 0).map(s => ({ employeeId: s.employeeId, share: Number(s.share) / 100, from: s.from || undefined, to: s.to || undefined })) });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Affectation refusée", "error");
    showToast("Équipe enregistrée", "success"); setEdit(null); reload();
  }
  const everyone = data ? [...data.desks.flatMap(d => d.staff.map(s => ({ employeeId: s.employeeId, name: s.name, position: s.position }))), ...data.unassigned]
    .filter((e, i, a) => a.findIndex(x => x.employeeId === e.employeeId) === i) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Users size={22} /> Équipe et paie</h1>
          <p className="text-sm text-ink2">Le personnel de chaque restaurant, sa part de temps et ce qu&apos;il coûte au restaurant chaque mois.</p>
        </div>
        <FormField label="Mois"><input type="month" className={inputCls} value={month} max={monthOf()} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {loading && !data ? <div className="h-48 surface-card animate-pulse" /> : !data?.desks.length ? (
        <EmptyState icon={<Users size={20} />} title="Aucun restaurant" hint="Créez d'abord un comptoir par restaurant." />
      ) : <>
        {!data.payroll && <p className="text-sm text-ink3">Les coûts et l&apos;affectation sont réservés à qui gère la paie (gérant, chef comptable).</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.desks.map(d => {
            const total = d.staff.reduce((t, s) => t + (s.allocated ?? 0), 0);
            return (
              <section key={d.deskId} className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{d.name}</p>
                  {data.payroll && edit !== d.deskId && <button onClick={() => startEdit(d.deskId)} className={buttonClass("secondary", "sm")}>Modifier l&apos;équipe</button>}
                </div>
                {edit === d.deskId ? (
                  <div className="space-y-2">
                    {draft.map((s, i) => (
                      <div key={i} className="flex gap-2 flex-wrap">
                        <select className={selectCls} value={s.employeeId} onChange={e => setDraft(x => x.map((y, j) => j === i ? { ...y, employeeId: e.target.value } : y))}>
                          <option value="">Collaborateur…</option>
                          {everyone.map(e => <option key={e.employeeId} value={e.employeeId}>{e.name}{e.position ? ` — ${e.position}` : ""}</option>)}
                        </select>
                        <input className={`${inputCls} w-20`} inputMode="numeric" value={s.share} onChange={e => setDraft(x => x.map((y, j) => j === i ? { ...y, share: e.target.value } : y))} aria-label="Part de temps en %" />
                        <span className="self-center text-sm text-ink3">%</span>
                        <input type="date" className={`${inputCls} w-36`} value={s.from} onChange={e => setDraft(x => x.map((y, j) => j === i ? { ...y, from: e.target.value } : y))} aria-label="Début d'affectation" title="Début (vide : depuis toujours)" />
                        <input type="date" className={`${inputCls} w-36`} value={s.to} onChange={e => setDraft(x => x.map((y, j) => j === i ? { ...y, to: e.target.value } : y))} aria-label="Fin d'affectation" title="Fin (vide : sans fin)" />
                        <button onClick={() => setDraft(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <button onClick={() => setDraft(x => [...x, { employeeId: "", share: "100", from: "", to: "" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter</button>
                      <span className="flex-1" />
                      <button onClick={() => setEdit(null)} className={buttonClass("ghost", "sm")}>Annuler</button>
                      <button disabled={busy} onClick={() => save(d.deskId)} className={buttonClass("primary", "sm")}>Enregistrer</button>
                    </div>
                    <p className="text-[11px] text-ink3">Une personne ne peut pas dépasser 100 % de son temps sur l&apos;ensemble des restaurants. Dates facultatives : une affectation qui commence ou finit dans le mois n&apos;en compte que les jours couverts ; une même personne peut revenir sur une autre période.</p>
                  </div>
                ) : d.staff.length === 0 ? <p className="text-sm text-ink3">Personne n&apos;est affecté : le résultat du restaurant ne compte pas encore de personnel.</p> : (
                  <table className="table-dense w-full">
                    <thead><tr><th>Collaborateur</th><th className="text-right">Temps</th>{data.payroll && <><th>Paie</th><th className="text-right">Coût imputé</th></>}</tr></thead>
                    <tbody>
                      {d.staff.map(s => (
                        <tr key={s.employeeId} className="border-t border-line">
                          <td><Link href={`/employees/${s.employeeId}`} className="hover:text-section">{s.name}</Link>{s.position ? <span className="block text-[11px] text-ink3">{s.position}</span> : null}{(s.from || s.to) && <span className="block text-[11px] text-ink3">{s.from && s.to ? `du ${fmtDay(s.from)} au ${fmtDay(s.to)}` : s.from ? `depuis le ${fmtDay(s.from)}` : `jusqu'au ${fmtDay(s.to!)}`}</span>}{!s.active && <span className="block"><Pill tone="mute">parti</Pill></span>}</td>
                          <td className="text-right font-mono">{Math.round(s.share * 100)} %</td>
                          {data.payroll && <>
                            <td>{s.payslip ? <Link href={`/payslips/${s.payslipId}`}><Pill tone={s.paid ? "pos" : "info"}>{s.paid ? "payé" : "bulletin fait"}</Pill></Link> : <Pill tone="warn">bulletin à faire</Pill>}</td>
                            <td className="text-right font-mono">{MONEY(s.allocated)}</td>
                          </>}
                        </tr>
                      ))}
                      {data.payroll && <tr className="border-t-2 border-ink font-semibold"><td colSpan={3}>Coût du personnel du mois</td><td className="text-right font-mono">{MONEY(total)}</td></tr>}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
        {data.payroll && (
          <div className="flex flex-wrap gap-2">
            <Link href="/payslips" className={buttonClass("secondary", "md")}><FileSpreadsheet size={15} /> Bulletins de paie</Link>
            <Link href="/employees" className={buttonClass("secondary", "md")}><Users size={15} /> Collaborateurs</Link>
          </div>
        )}
      </>}
    </div>
  );
}
