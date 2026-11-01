"use client";
import { useState } from "react";
import Link from "next/link";
import { Rocket, Archive, Plus, Trash2, Store } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const CHARGES: Array<[string, string]> = [["personnel", "Personnel (hors bulletins affectés)"], ["loyer", "Loyer"], ["electricite", "Électricité"], ["eau", "Eau"], ["energie", "Gaz, charbon"], ["consommables", "Consommables, emballages"], ["transport", "Transport, livraisons"], ["entretien", "Entretien, réparations"], ["telecom", "Téléphone, internet"], ["banque", "Frais bancaires, mobile money"], ["impots", "Impôts et taxes"], ["autres", "Autres"]];

interface Report { deskId: string; name: string; items: number; openInventories: number; stockLines: number; stockValue: number; negatives: number }
interface Data { sites: Report[]; employees: Array<{ _id: string; firstName: string; lastName: string; position?: string }>; users: Array<{ _id: string; firstName?: string; lastName?: string; email: string; role: string }> | null }
type Line = { name: string; unit: string; category: string; level: "reserve" | "desk"; packSize: string; packs: string; quantity: string; cost: string; costPer: "unit" | "pack"; salePrice: string; rhythm: string };
const emptyLine = (): Line => ({ name: "", unit: "unité", category: "", level: "reserve", packSize: "", packs: "", quantity: "", cost: "", costPer: "unit", salePrice: "", rhythm: "" });

/**
 * Nouveau départ et ouverture des sites : archiver l'existant (rien n'est
 * supprimé), puis créer chaque site avec sa caisse et son montant de départ,
 * son personnel, ses charges prévues par rubrique et son stock d'ouverture.
 */
export default function OuverturePage() {
  const { data, error, reload } = useApi<Data | null>("/api/restauration/ouverture", d => (d?.data as Data) ?? null, null, { quiet: true });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Rocket size={22} /> Ouverture des sites</h1>
        <p className="text-sm text-ink2">Repartir de zéro : archiver les sites actuels, puis ouvrir chaque site avec sa caisse, son équipe, ses charges et son stock de départ.</p>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {data && <ArchivePanel sites={data.sites} onDone={reload} />}
      {data && <OpenForm key={data.sites.map(s => s.deskId).join()} data={data} onDone={reload} />}
    </div>
  );
}

function ArchivePanel({ sites, onDone }: { sites: Report[]; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [solder, setSolder] = useState(true);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/ouverture", { action: "archive", deskIds: picked, solderStock: solder, confirm });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Archivage refusé", "error");
    showToast(`${picked.length} site(s) archivé(s)`, "success"); setPicked([]); setConfirm(""); onDone();
  }
  return (
    <section className="surface-card p-4 space-y-3">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Archive size={16} /> 1. Archiver les sites actuels</p>
      <p className="text-[12px] text-ink3">Rien n&apos;est supprimé : ventes, caisses, écritures comptables et mouvements restent consultables, les mois passés ne changent pas. Le site archivé libère son nom. Faites d&apos;abord une sauvegarde complète de la base, et faites valider l&apos;écriture de clôture du stock par la comptable.</p>
      {!sites.length ? <p className="text-sm text-ink3">Aucun site actif.</p> : (
        <table className="table-dense w-full">
          <thead><tr><th /><th>Site</th><th className="text-right">Articles</th><th className="text-right">Stock restant</th><th>À noter</th></tr></thead>
          <tbody>{sites.map(s => (
            <tr key={s.deskId} className="border-t border-line">
              <td><input type="checkbox" checked={picked.includes(s.deskId)} onChange={e => setPicked(p => e.target.checked ? [...p, s.deskId] : p.filter(x => x !== s.deskId))} aria-label={`Archiver ${s.name}`} /></td>
              <td>{s.name}</td><td className="text-right font-mono">{s.items}</td>
              <td className="text-right font-mono">{s.stockLines} ligne(s) · {MONEY(s.stockValue)}</td>
              <td>{s.negatives ? <Pill tone="warn">{s.negatives} stock(s) négatif(s)</Pill> : null} {s.openInventories ? <Pill tone="info">{s.openInventories} inventaire(s) ouvert(s)</Pill> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {picked.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={solder} onChange={e => setSolder(e.target.checked)} /> Solder le stock restant à zéro (ajustement tracé « Clôture avant nouveau départ ») : le stock réel sera ressaisi comme stock d&apos;ouverture des nouveaux sites, sans double compte.</label>
          <div className="flex gap-2 items-end flex-wrap">
            <FormField label="Tapez ARCHIVER pour confirmer"><input className={`${inputCls} w-40`} value={confirm} onChange={e => setConfirm(e.target.value)} /></FormField>
            <button disabled={busy || confirm !== "ARCHIVER"} onClick={archive} className={buttonClass("primary", "md")}><Archive size={15} /> Archiver {picked.length} site(s)</button>
          </div>
        </div>
      )}
    </section>
  );
}

function OpenForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [f, setF] = useState({ name: "", date: today(), amount: "", cashLabel: "", vat: "0", target: "20", share: "" });
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<Array<{ employeeId: string; share: string }>>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ deskId: string; name: string; stockValue: number } | null>(null);
  const setLine = (i: number, p: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...p } : l));
  const lineValue = (l: Line) => {
    const size = num(l.packSize) || 0, units = (num(l.packs) > 0 && size ? num(l.packs) * size : 0) + (num(l.quantity) || 0);
    const unitCost = l.costPer === "pack" && size ? (num(l.cost) || 0) / size : num(l.cost) || 0;
    return { units, unitCost, value: units * unitCost };
  };
  const total = lines.reduce((t, l) => t + lineValue(l).value, 0);

  async function open() {
    if (!f.name.trim()) return showToast("Nom du site obligatoire.", "error");
    const items = lines.filter(l => l.name.trim()).map(l => {
      const v = lineValue(l), size = num(l.packSize) > 0 ? Math.round(num(l.packSize)) : undefined;
      return { name: l.name.trim(), unit: l.unit || "unité", category: l.category || undefined, level: l.level, unitCost: Math.round(v.unitCost * 100) / 100, quantity: v.units,
        ...(size ? { pack: { label: "carton", size } } : {}), ...(num(l.salePrice) > 0 ? { salePrice: num(l.salePrice) } : {}), ...(l.rhythm ? { rhythm: l.rhythm } : {}) };
    });
    if (items.some(i => !(i.unitCost >= 0))) return showToast("Coût manquant sur un article.", "error");
    setBusy(true);
    const r = await apiSend<{ data: { deskId: string; name: string; stockValue: number }; error?: string }>("POST", "/api/restauration/ouverture", { action: "open", site: {
      name: f.name.trim(), openingDate: f.date, vatRate: (num(f.vat) || 0) / 100, targetNetMargin: (num(f.target) || 20) / 100,
      cash: { label: f.cashLabel || undefined, openingBalance: num(f.amount) || 0 }, ...(f.share !== "" ? { commonCostShare: (num(f.share) || 0) / 100 } : {}),
      plannedCosts: Object.entries(charges).map(([category, v]) => ({ category, amount: num(v) || 0 })).filter(c => c.amount > 0),
      staff: staff.filter(s => s.employeeId && num(s.share) > 0).map(s => ({ employeeId: s.employeeId, share: num(s.share) / 100 })),
      userIds: users, items,
    } });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Ouverture refusée", "error");
    setDone(r.data.data); showToast(`Site ${r.data.data.name} ouvert`, "success"); onDone();
  }

  if (done) return (
    <section className="surface-card p-5 space-y-3">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Store size={16} /> {done.name} est ouvert</p>
      <p className="text-sm text-ink2">Stock d&apos;ouverture : {MONEY(done.stockValue)} au coût. La caisse, l&apos;équipe et les charges prévues sont en place.</p>
      <div className="flex gap-2 flex-wrap">
        <Link href={`/comptoir?desk=${done.deskId}`} className={buttonClass("primary", "md")}>Ouvrir la caisse du site</Link>
        <Link href="/restauration/magasin" className={buttonClass("secondary", "md")}>Écran du magasin</Link>
        <button onClick={() => { setDone(null); setF(x => ({ ...x, name: "", amount: "", cashLabel: "" })); setLines([emptyLine()]); setStaff([]); setUsers([]); }} className={buttonClass("ghost", "md")}>Ouvrir un autre site</button>
      </div>
    </section>
  );

  return (
    <section className="surface-card p-4 space-y-5">
      <p className="font-semibold text-ink inline-flex items-center gap-2"><Rocket size={16} /> 2. Ouvrir un site</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Nom du site" required><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="The Spot — campus" /></FormField>
        <FormField label="Date d'ouverture"><input type="date" className={inputCls} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="Montant de départ en caisse (FCFA)" hint="Fonds de caisse remis au site. Sa nature (apport, avance) est enregistrée par la comptable."><input className={inputCls} inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></FormField>
        <FormField label="Nom de la caisse"><input className={inputCls} value={f.cashLabel} onChange={e => setF({ ...f, cashLabel: e.target.value })} placeholder={`Caisse ${f.name || "du site"}`} /></FormField>
        <FormField label="TVA sur les ventes (%)" hint="0 si l'entreprise n'est pas assujettie : à confirmer par la comptable."><input className={inputCls} inputMode="decimal" value={f.vat} onChange={e => setF({ ...f, vat: e.target.value })} /></FormField>
        <FormField label="Marge nette visée (%)"><input className={inputCls} inputMode="decimal" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} /></FormField>
        <FormField label="Quote-part des charges communes (%)" hint="Part du loyer global, compteur commun… portée par ce site."><input className={inputCls} inputMode="decimal" value={f.share} onChange={e => setF({ ...f, share: e.target.value })} placeholder="0" /></FormField>
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-sm">Charges prévues par mois</p>
        <p className="text-[12px] text-ink3">Chaque rubrique est suivie à part : le réel vient des dépenses de caisse et de la comptabilité, comparé à ce prévu ; il sert au point mort et au prix minimum.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CHARGES.map(([k, label]) => <FormField key={k} label={label}><input className={inputCls} inputMode="numeric" value={charges[k] ?? ""} onChange={e => setCharges(c => ({ ...c, [k]: e.target.value }))} placeholder="0" /></FormField>)}
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-sm">Agents du site</p>
        {staff.map((s, i) => (
          <div key={i} className="flex gap-2 items-end flex-wrap">
            <select className={selectCls} value={s.employeeId} onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, employeeId: e.target.value } : y))}><option value="">Collaborateur…</option>{data.employees.map(e => <option key={e._id} value={e._id}>{e.lastName} {e.firstName}{e.position ? ` — ${e.position}` : ""}</option>)}</select>
            <input className={`${inputCls} w-20`} inputMode="numeric" value={s.share} onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, share: e.target.value } : y))} aria-label="Part de temps en %" /><span className="text-sm text-ink3 self-center">% du temps</span>
            <button onClick={() => setStaff(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={() => setStaff(x => [...x, { employeeId: "", share: "100" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Agent</button>
        {data.employees.length === 0 && <p className="text-[12px] text-ink3">Aucun collaborateur : créez-les d&apos;abord dans <Link href="/employees" className="underline">Collaborateurs</Link> (leur bulletin fera le coût du personnel du site).</p>}
        {data.users && (
          <div className="pt-2">
            <p className="text-sm text-ink2">Comptes qui accèdent au site (caissiers, gestionnaire) :</p>
            <div className="flex flex-wrap gap-1.5 mt-1">{data.users.map(u => { const on = users.includes(u._id); return <button key={u._id} onClick={() => setUsers(x => on ? x.filter(y => y !== u._id) : [...x, u._id])} aria-pressed={on} className={`h-8 px-3 rounded-full border text-[12px] ${on ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{u.lastName ?? ""} {u.firstName ?? u.email}</button>; })}</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-sm">Stock de départ</p>
        <p className="text-[12px] text-ink3">Comptez ce qui est réellement en stock le jour de l&apos;ouverture : en cartons et en unités. Il entre au coût indiqué, sans être un achat ni toucher au résultat. Le carton reste un conditionnement : le stock est tenu à l&apos;unité.</p>
        <div className="overflow-x-auto">
          <table className="table-dense w-full min-w-[980px]">
            <thead><tr><th>Article</th><th>Unité</th><th>Famille</th><th>Où</th><th>Carton de</th><th>Cartons</th><th>+ unités</th><th>Coût</th><th>Prix de vente</th><th>Rythme</th><th className="text-right">Valeur</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => { const v = lineValue(l); return (
              <tr key={i} className="border-t border-line">
                <td><input className={`${inputCls} w-40`} value={l.name} onChange={e => setLine(i, { name: e.target.value })} placeholder="Jus IRA" /></td>
                <td><input className={`${inputCls} w-24`} value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} /></td>
                <td><input className={`${inputCls} w-28`} value={l.category} onChange={e => setLine(i, { category: e.target.value })} placeholder="Boissons" /></td>
                <td><select className={selectCls} value={l.level} onChange={e => setLine(i, { level: e.target.value as Line["level"] })}><option value="reserve">Réserve</option><option value="desk">Comptoir</option></select></td>
                <td><input className={`${inputCls} w-16`} inputMode="numeric" value={l.packSize} onChange={e => setLine(i, { packSize: e.target.value })} placeholder="24" /></td>
                <td><input className={`${inputCls} w-16`} inputMode="decimal" value={l.packs} disabled={!(num(l.packSize) > 0)} onChange={e => setLine(i, { packs: e.target.value })} /></td>
                <td><input className={`${inputCls} w-20`} inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                <td className="whitespace-nowrap"><input className={`${inputCls} w-24`} inputMode="decimal" value={l.cost} onChange={e => setLine(i, { cost: e.target.value })} />
                  {num(l.packSize) > 0 && <select className={`${selectCls} mt-1`} value={l.costPer} onChange={e => setLine(i, { costPer: e.target.value as Line["costPer"] })}><option value="unit">par unité</option><option value="pack">par carton</option></select>}</td>
                <td><input className={`${inputCls} w-24`} inputMode="numeric" value={l.salePrice} onChange={e => setLine(i, { salePrice: e.target.value })} /></td>
                <td><select className={selectCls} value={l.rhythm} onChange={e => setLine(i, { rhythm: e.target.value })}><option value="">Semaine</option><option value="fortnight">2 semaines</option><option value="month">Mois</option></select></td>
                <td className="text-right font-mono text-sm">{v.units ? `${v.units} · ${MONEY(v.value)}` : "—"}</td>
                <td><button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer"><Trash2 size={14} /></button></td>
              </tr>); })}</tbody>
          </table>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setLines(ls => [...ls, emptyLine()])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Article</button>
          <span className="text-sm text-ink2">Stock de départ : <b className="font-mono">{MONEY(total)}</b></span>
        </div>
      </div>

      <div className="flex justify-end"><button disabled={busy} onClick={open} className={buttonClass("primary", "md")}><Rocket size={15} /> Ouvrir le site</button></div>
    </section>
  );
}
