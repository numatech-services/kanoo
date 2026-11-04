"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Rocket, Archive, Plus, Trash2, Store, Banknote, Boxes, Scale, Landmark, Check, ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";
import { RestoNav } from "@/components/restauration/RestoNav";
import { OpeningStockEditor, MONEY, num, emptyLine, linesToItems, lineValue, type StockLine } from "@/components/restauration/OpeningStockEditor";
import { CHARGE_CATEGORIES } from "@/lib/restaurant";

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const API = "/api/restauration/ouverture";
interface Site { deskId: string; name: string; openingDate: string | null; items: number; openInventories: number; stockLines: number; stockValue: number; negatives: number; deskStockLines: number; noPrice: number; hasCash: boolean; cashBalance: number | null; funded: number; staff: number; planned: number; sessionOpen: boolean; pendingTransfers: number; openDebts: number; advancesLeft: number; easypayKeys: number; credits: number; validated: boolean; vatRate: number; todo: string[] }
interface Account { _id: string; label: string; type: string; balance: number }
interface Data {
  sites: Site[]; archived: Array<{ _id: string; name: string }>; accounts: Account[];
  employees: Array<{ _id: string; firstName: string; lastName: string; position?: string }>;
  users: Array<{ _id: string; firstName?: string; lastName?: string; email: string }> | null;
  natures: Array<{ key: string; label: string }>; kinds: Array<{ key: string; label: string }>;
}
type Panel = { kind: "money" | "stock" | "position" | "deposit"; site: Site } | null;

/**
 * Ouverture des sites : la liste dit ce qu'il reste à faire sur chaque site ;
 * un assistant ouvre un site en six étapes ; l'argent et le stock de départ
 * s'ajoutent aussi après coup. Archiver l'existant reste à part, replié.
 */
export default function OuverturePage() {
  const { data, error, reload } = useApi<Data | null>(API, d => (d?.data as Data) ?? null, null, { quiet: true });
  const [wizard, setWizard] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const sources = data ? [...data.sites.map(s => ({ _id: s.deskId, name: s.name })), ...data.archived] : [];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Rocket size={22} /> Ouverture des sites</h1>
          <p className="text-sm text-ink2">Créez un site, donnez-lui son argent de départ et son stock, puis lancez la caisse.</p>
        </div>
        <button onClick={() => setWizard(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Ouvrir un site</button>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {!data ? <div className="h-40 surface-card animate-pulse" /> : <>
        {!data.sites.length ? (
          <section className="surface-card p-6 text-center space-y-2">
            <p className="font-semibold text-ink">Aucun site ouvert</p>
            <p className="text-sm text-ink2">Commencez par ouvrir votre premier site : il faut cinq minutes, et seul le nom est obligatoire.</p>
          </section>
        ) : <div className="grid gap-3 lg:grid-cols-2">{data.sites.map(s => <SiteCard key={s.deskId} s={s} open={k => setPanel({ kind: k, site: s })} />)}</div>}
        <ArchivePanel data={data} onDone={reload} />
        {wizard && <Wizard data={data} sources={sources} onClose={() => setWizard(false)} onDone={reload} />}
        {panel?.kind === "money" && <MoneyDialog data={data} site={panel.site} onClose={() => setPanel(null)} onDone={reload} />}
        {panel?.kind === "stock" && <StockDialog site={panel.site} sources={sources.filter(x => x._id !== panel.site.deskId)} onClose={() => setPanel(null)} onDone={reload} />}
        {panel?.kind === "position" && <PositionDialog data={data} site={panel.site} onClose={() => setPanel(null)} onDone={reload} />}
        {panel?.kind === "deposit" && <DepositDialog data={data} site={panel.site} onClose={() => setPanel(null)} onDone={reload} />}
      </>}
    </div>
  );
}

function SiteCard({ s, open }: { s: Site; open: (k: NonNullable<Panel>["kind"]) => void }) {
  const row = (done: boolean, label: string) => <li className={`flex items-center gap-2 text-sm ${done ? "text-ink" : "text-ink3"}`}><Check size={14} className={done ? "text-pos" : "opacity-30"} /> {label}</li>;
  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{s.name}</p>
          <p className="text-[12px] text-ink3">{s.openingDate ? `Ouvert le ${new Date(s.openingDate).toLocaleDateString("fr-FR")}` : "Ouvert avant l'assistant"} · caisse {s.sessionOpen ? "ouverte" : "fermée"}</p>
        </div>
        {s.todo.length ? <Pill tone="warn">{s.todo.length} à faire</Pill> : <Pill tone="pos">prêt</Pill>}
      </div>
      <ul className="space-y-1">
        {row(s.funded > 0 || (s.cashBalance ?? 0) > 0, s.cashBalance !== null ? `Caisse : ${MONEY(s.cashBalance)}${s.funded ? ` (${MONEY(s.funded)} alloués)` : ""}` : "Pas de caisse reliée")}
        {row(s.stockLines > 0, s.stockLines ? `Stock : ${s.stockLines} article(s), ${MONEY(s.stockValue)} au coût` : "Stock de départ à saisir")}
        {row(s.staff > 0, s.staff ? `${s.staff} agent(s)` : "Agents à affecter")}
        {row(s.planned > 0, s.planned ? `${s.planned} charge(s) prévue(s)` : "Charges prévues à saisir")}
        {row(s.validated, s.validated ? "Situation validée par la comptable" : `À valider par la comptable (TVA ${Math.round(s.vatRate * 1000) / 10} %)`)}
      </ul>
      {s.todo.length > 0 && <p className="text-[12px] text-ink2">Reste à faire : {s.todo.join(", ")}.</p>}
      {s.negatives > 0 && <Pill tone="warn">{s.negatives} stock(s) négatif(s)</Pill>}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => open("money")} className={buttonClass("secondary", "sm")}><Banknote size={14} /> Argent</button>
        <button onClick={() => open("stock")} className={buttonClass("secondary", "sm")}><Boxes size={14} /> Stock</button>
        <button onClick={() => open("position")} className={buttonClass("secondary", "sm")}><Scale size={14} /> Situation de départ</button>
        {s.sessionOpen && <button onClick={() => open("deposit")} className={buttonClass("ghost", "sm")}><Landmark size={14} /> Remise en banque</button>}
        <Link href="/restauration/equipe" className={buttonClass("ghost", "sm")}>Équipe</Link>
        <Link href={`/comptoir?desk=${s.deskId}&tab=resultat`} className={buttonClass("ghost", "sm")}>Charges</Link>
        <Link href={`/comptoir?desk=${s.deskId}&tab=semaine`} className={buttonClass("ghost", "sm")}>Caisse</Link>
      </div>
    </section>
  );
}

/** Origine et montant de l'argent : le même champ à l'ouverture et après. */
function MoneyFields({ data, amount, nature, from, label, set }: { data: Data; amount: string; nature: string; from: string; label: string; set: (p: { amount?: string; nature?: string; from?: string; label?: string }) => void }) {
  const money = data.accounts.filter(a => a.balance > 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Montant alloué (FCFA)"><input className={inputCls} inputMode="numeric" value={amount} onChange={e => set({ amount: e.target.value })} placeholder="200000" /></FormField>
      <FormField label="D'où vient cet argent ?" hint="Jamais une recette : ni chiffre d'affaires, ni résultat."><select className={selectCls} value={nature} onChange={e => set({ nature: e.target.value })}>{data.natures.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}</select></FormField>
      {nature === "transfer" && (money.length
        ? <FormField label="Compte qui verse"><select className={selectCls} value={from} onChange={e => set({ from: e.target.value })}><option value="">Choisir…</option>{money.map(a => <option key={a._id} value={a._id}>{a.label} ({MONEY(a.balance)})</option>)}</select></FormField>
        : <p className="text-sm text-warn sm:col-span-2">Aucun compte de l&apos;entreprise n&apos;a de solde à virer. Choisissez une autre origine, par exemple une avance.</p>)}
      <FormField label="Précision (facultatif)"><input className={inputCls} value={label} onChange={e => set({ label: e.target.value })} placeholder="Avance du gérant, fonds de caisse…" /></FormField>
    </div>
  );
}

const STEPS = ["Le site", "L'argent", "Le stock", "L'équipe", "Les charges", "Vérifier"];
const DRAFT = "kanoo-ouverture-brouillon";
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) ?? "null") as { f?: Record<string, string>; lines?: StockLine[] } | null; } catch { return null; } };
const startNature = (d: Data) => (d.accounts.some(a => a.balance > 0) ? "transfer" : "advance");

function Wizard({ data, sources, onClose, onDone }: { data: Data; sources: Array<{ _id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [step, setStep] = useState(0);
  // Le comptage se fait sur place, réseau ou pas : la saisie survit à une fermeture de page.
  const [f, setF] = useState(() => ({ name: "", date: today(), vat: "", target: "20", share: "", cashLabel: "", copyFrom: "", ...(readDraft()?.f ?? {}) }));
  const [m, setM] = useState({ amount: "", nature: startNature(data), from: "", label: "" });
  const [lines, setLines] = useState<StockLine[]>(() => readDraft()?.lines?.length ? readDraft()!.lines! : [emptyLine()]);
  const [paidBy, setPaidBy] = useState("taken_over");
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ f, lines })); } catch { /* navigation privée */ } }, [f, lines]);
  const dirty = !!f.name.trim() || lines.some(l => l.name.trim());
  async function askClose() {
    if (!dirty || await confirmDialog({ title: "Fermer l'assistant ?", message: "Votre saisie est gardée sur cet appareil : vous la retrouverez en rouvrant l'assistant." })) onClose();
  }
  const [staff, setStaff] = useState<Array<{ employeeId: string; share: string }>>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ deskId: string; name: string; stockValue: number; funded: number; stockError: string | null; copied: { recipes: number } | null; deskLines: number; reserveLines: number } | null>(null);
  const stockTotal = lines.reduce((t, l) => t + lineValue(l).value, 0), chargeTotal = Object.values(charges).reduce((t, v) => t + (num(v) || 0), 0);
  const amount = num(m.amount) || 0;
  function next() {
    if (step === 0 && !f.name.trim()) return showToast("Donnez un nom au site.", "error");
    if (step === 0 && f.vat === "") return showToast("Choisissez le taux de TVA.", "error");
    if (step === 0 && data.sites.some(x => x.name.toLowerCase() === f.name.trim().toLowerCase())) return showToast("Un site porte déjà ce nom.", "error");
    if (step === 2) {
      const bad = lines.find(l => l.name.trim() && lineValue(l).units > 0 && !(lineValue(l).unitCost > 0));
      if (bad) return showToast(`${bad.name} : indiquez le coût.`, "error");
    }
    if (step === 1 && amount > 0 && m.nature === "transfer" && !m.from) return showToast("Choisissez le compte qui verse l'argent.", "error");
    setStep(s => s + 1);
  }
  async function submit() {
    setBusy(true);
    const r = await apiSend<{ data: NonNullable<typeof done>; error?: string }>("POST", API, { action: "open", site: {
      name: f.name.trim(), openingDate: f.date, vatRate: (num(f.vat) || 0) / 100, targetNetMargin: (Number.isNaN(num(f.target)) ? 20 : num(f.target)) / 100,
      cash: { label: f.cashLabel || undefined }, ...(f.share !== "" ? { commonCostShare: (num(f.share) || 0) / 100 } : {}),
      ...(amount > 0 ? { funding: { amount, nature: m.nature, fromAccountId: m.from || undefined, label: m.label || undefined } } : {}),
      plannedCosts: Object.entries(charges).map(([category, v]) => ({ category, amount: num(v) || 0 })).filter(c => c.amount > 0),
      staff: staff.filter(s => s.employeeId && num(s.share) > 0).map(s => ({ employeeId: s.employeeId, share: num(s.share) / 100 })),
      userIds: users, items: linesToItems(lines), ...(stockTotal > 0 ? { stockFundedBy: paidBy } : {}), ...(f.copyFrom ? { copyFromDeskId: f.copyFrom } : {}),
    } }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Ouverture refusée", "error");
    op.done(); setDone(r.data.data); onDone();
    try { localStorage.removeItem(DRAFT); } catch { /* navigation privée */ }
  }
  if (done) return (
    <Modal open onClose={onClose} title={`${done.name} est ouvert`} size="md">
      <div className="space-y-3">
        <p className="text-sm text-ink2 inline-flex items-center gap-2"><Store size={16} /> Argent alloué : {MONEY(done.funded)} · stock de départ : {MONEY(done.stockValue)}{done.copied ? ` · ${done.copied.recipes} fiche(s) technique(s) reprise(s)` : ""}.</p>
        {done.stockError && <p className="text-sm text-neg">Le stock n&apos;a pas pu être enregistré : {done.stockError} Ajoutez-le avec le bouton Stock du site.</p>}
        {done.funded > 0 && <p className="text-sm text-ink2">À l&apos;ouverture de la caisse, ce montant est proposé comme fonds de caisse : rien à ressaisir.</p>}
        {done.reserveLines > 0 && <p className="text-sm text-warn">{done.reserveLines} article(s) en réserve, {done.deskLines} au comptoir : seul le comptoir se vend. Montez le stock depuis l&apos;écran du magasin avant la première vente.</p>}
        <div className="flex gap-2 flex-wrap">
          <Link href={`/comptoir?desk=${done.deskId}&tab=semaine`} className={buttonClass("primary", "md")}>Ouvrir la caisse</Link>
          <Link href="/restauration/magasin" className={buttonClass("secondary", "md")}>Écran du magasin</Link>
          <button onClick={onClose} className={buttonClass("ghost", "md")}>Fermer</button>
        </div>
      </div>
    </Modal>
  );
  return (
    <Modal open onClose={askClose} title="Ouvrir un site" description={`Étape ${step + 1} sur ${STEPS.length} : ${STEPS[step]}`} size="lg" footer={
      <div className="flex justify-between gap-2 w-full">
        <button disabled={step === 0 || busy} onClick={() => setStep(s => s - 1)} className={buttonClass("ghost", "md")}><ChevronLeft size={15} /> Retour</button>
        {step < STEPS.length - 1 ? <button onClick={next} className={buttonClass("primary", "md")}>Continuer <ChevronRight size={15} /></button> : <button disabled={busy} onClick={submit} className={buttonClass("primary", "md")}><Rocket size={15} /> Ouvrir le site</button>}
      </div>
    }>
      <div className="space-y-4">
        <ol className="flex gap-1" aria-hidden="true">{STEPS.map((s, i) => <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-ink" : "bg-line"}`} />)}</ol>
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nom du site" required><input autoFocus className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="The Spot — campus" /></FormField>
            <FormField label="Date d'ouverture"><input type="date" className={inputCls} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></FormField>
            <FormField label="TVA sur les ventes" required hint="À confirmer avec la comptable : le taux dépend du régime fiscal de l'entreprise."><select className={selectCls} value={f.vat} onChange={e => setF({ ...f, vat: e.target.value })}><option value="">Choisir…</option><option value="10">10 % (restauration, régime réel)</option><option value="0">0 % (non assujetti)</option><option value="19">19 %</option></select></FormField>
            <FormField label="Marge nette visée (%)"><input className={inputCls} inputMode="decimal" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} /></FormField>
            {sources.length > 0 && <FormField label="Reprendre les fiches techniques de" hint="Plats, recettes et prix, sans stock."><select className={selectCls} value={f.copyFrom} onChange={e => setF({ ...f, copyFrom: e.target.value })}><option value="">Aucun site</option>{sources.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}</select></FormField>}
          </div>
        )}
        {step === 1 && <div className="space-y-2">
          <p className="text-sm text-ink2">L&apos;argent remis à la caisse du site. Laissez vide pour l&apos;ajouter plus tard.</p>
          <MoneyFields data={data} amount={m.amount} nature={m.nature} from={m.from} label={m.label} set={p => setM(x => ({ ...x, ...p }))} />
        </div>}
        {step === 2 && <div className="space-y-2">
          <p className="text-sm text-ink2">Comptez ce qui est réellement là le jour de l&apos;ouverture. Ce n&apos;est ni un achat, ni une dette : le résultat n&apos;en est pas touché.</p>
          <OpeningStockEditor lines={lines} setLines={setLines} sources={sources} />
          {stockTotal > 0 && <FormField label="Qui a payé ce stock ?" hint="Pour que la situation de départ tombe juste. Aucun argent ne bouge ici."><select className={selectCls} value={paidBy} onChange={e => setPaidBy(e.target.value)}><option value="taken_over">L&apos;entreprise (stock repris ou déjà payé)</option><option value="owner_paid">Le dirigeant (à lui rembourser)</option><option value="debt">Pas encore payé (dette fournisseur)</option></select></FormField>}
        </div>}
        {step === 3 && <div className="space-y-3">
          {staff.map((s, i) => (
            <div key={i} className="flex gap-2 items-center flex-wrap">
              <select className={`${selectCls} flex-1 min-w-48`} value={s.employeeId} aria-label="Agent" onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, employeeId: e.target.value } : y))}><option value="">Agent…</option>{data.employees.map(e => <option key={e._id} value={e._id}>{e.lastName} {e.firstName}{e.position ? ` — ${e.position}` : ""}</option>)}</select>
              <input className={`${inputCls} w-20`} inputMode="numeric" value={s.share} onChange={e => setStaff(x => x.map((y, j) => j === i ? { ...y, share: e.target.value } : y))} aria-label="Part de temps en %" /><span className="text-sm text-ink3">% du temps</span>
              <button onClick={() => setStaff(x => x.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")} aria-label="Retirer l'agent"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setStaff(x => [...x, { employeeId: "", share: "100" }])} className={buttonClass("secondary", "sm")}><Plus size={14} /> Agent</button>
          {!data.employees.length && <p className="text-[12px] text-ink3">Aucun collaborateur enregistré : créez-les dans <Link href="/employees" className="underline">Collaborateurs</Link>, puis affectez-les depuis Restauration → Équipe.</p>}
          {data.users && data.users.length > 0 && <div>
            <p className="text-sm text-ink2">Comptes qui accèdent au site (caissiers, gestionnaire) :</p>
            <div className="flex flex-wrap gap-1.5 mt-1">{data.users.map(u => { const on = users.includes(u._id); return <button key={u._id} onClick={() => setUsers(x => on ? x.filter(y => y !== u._id) : [...x, u._id])} aria-pressed={on} className={`h-8 px-3 rounded-full border text-[12px] ${on ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{u.lastName ?? ""} {u.firstName ?? u.email}</button>; })}</div>
          </div>}
        </div>}
        {step === 4 && <div className="space-y-2">
          <p className="text-sm text-ink2">Ce que le site devrait coûter chaque mois, rubrique par rubrique. Le réel viendra des dépenses et de la comptabilité.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(CHARGE_CATEGORIES).filter(([k]) => k !== "amortissements").map(([k, label]) => <FormField key={k} label={label}><input className={inputCls} inputMode="numeric" value={charges[k] ?? ""} onChange={e => setCharges(c => ({ ...c, [k]: e.target.value }))} placeholder="0" /></FormField>)}
          </div>
          <FormField label="Quote-part des charges communes (%)" hint="Part des charges sans site (siège, compteur commun) portée par ce site."><input className={inputCls} inputMode="decimal" value={f.share} onChange={e => setF({ ...f, share: e.target.value })} placeholder="0" /></FormField>
        </div>}
        {step === 5 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink3">Site</dt><dd className="font-semibold">{f.name} · ouverture le {new Date(`${f.date}T12:00:00`).toLocaleDateString("fr-FR")}</dd>
            <dt className="text-ink3">Argent</dt><dd>{amount > 0 ? `${MONEY(amount)} — ${data.natures.find(n => n.key === m.nature)?.label}` : "Plus tard"}</dd>
            <dt className="text-ink3">Stock</dt><dd>{linesToItems(lines).length} article(s), {MONEY(stockTotal)} au coût</dd>
            <dt className="text-ink3">Équipe</dt><dd>{staff.filter(s => s.employeeId).length} agent(s), {users.length} compte(s)</dd>
            <dt className="text-ink3">Charges</dt><dd>{MONEY(chargeTotal)} par mois</dd>
            <dt className="text-ink3">TVA</dt><dd>{num(f.vat) || 0} %</dd>
          </dl>
        )}
      </div>
    </Modal>
  );
}

function MoneyDialog({ data, site, onClose, onDone }: { data: Data; site: Site; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [m, setM] = useState({ amount: "", nature: startNature(data), from: "", label: "" });
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", API, { action: "fund", deskId: site.deskId, amount: num(m.amount), nature: m.nature, fromAccountId: m.from || undefined, label: m.label || undefined }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast("Argent alloué au site", "success"); onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Allouer de l'argent à ${site.name}`} size="md" footer={<button disabled={busy} onClick={send} className={buttonClass("primary", "md")}><Banknote size={15} /> Allouer</button>}>
      <MoneyFields data={{ ...data, accounts: data.accounts }} amount={m.amount} nature={m.nature} from={m.from} label={m.label} set={p => setM(x => ({ ...x, ...p }))} />
    </Modal>
  );
}

function StockDialog({ site, sources, onClose, onDone }: { site: Site; sources: Array<{ _id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [lines, setLines] = useState<StockLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  async function send() {
    const items = linesToItems(lines);
    if (!items.length) return showToast("Ajoutez au moins un article.", "error");
    if (site.stockValue > 0 && !(await confirmDialog({ title: "Ajouter à ce stock ?", message: `Ce site a déjà ${MONEY(site.stockValue)} de stock. Ces lignes s'y ajoutent : ne ressaisissez pas ce qui est déjà entré. Pour corriger une quantité, passez par un inventaire.` }))) return;
    setBusy(true);
    const r = await apiSend<{ error?: string; data?: { stockValue: number } }>("POST", API, { action: "stock", deskId: site.deskId, items }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast(`Stock de départ enregistré : ${MONEY(r.data.data?.stockValue)}`, "success"); onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Stock de départ — ${site.name}`} description="Pour une marchandise achetée après l'ouverture, utilisez plutôt la réception." size="lg" footer={<button disabled={busy} onClick={send} className={buttonClass("primary", "md")}><Boxes size={15} /> Enregistrer le stock</button>}>
      <OpeningStockEditor lines={lines} setLines={setLines} sources={sources} />
    </Modal>
  );
}

function DepositDialog({ data, site, onClose, onDone }: { data: Data; site: Site; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [amount, setAmount] = useState(""), [to, setTo] = useState("");
  async function send() {
    const r = await apiSend<{ error?: string }>("POST", API, { action: "deposit", deskId: site.deskId, amount: num(amount), toAccountId: to }, op.headers());
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast("Remise enregistrée", "success"); onDone(); onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Remise d'espèces — ${site.name}`} description="L'argent change de place : ce n'est ni une recette ni une dépense." size="sm" footer={<button onClick={send} className={buttonClass("primary", "md")}><Landmark size={15} /> Enregistrer</button>}>
      <div className="space-y-3">
        <FormField label="Montant (FCFA)"><input className={inputCls} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Compte qui reçoit"><select className={selectCls} value={to} onChange={e => setTo(e.target.value)}><option value="">Choisir…</option>{data.accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

interface Position { lines: Array<{ _id: string; kind: string; nature: string | null; amount: number; date: string; label: string; repayable: boolean; repaid: number; left: number; toQualify: boolean; cancellable: boolean }>; cancelled: Array<{ _id: string; amount: number; label: string; reason: string }>; money: number; owner: number; debts: number; takenOver: number; receivables: number; equipment: number; stockValue: number; resources: number; uses: number; gap: number; repayableLeft: number; validatedAt: string | null }

/** Ressources et emplois du site : d'où vient l'argent, où il est allé. La comptable y qualifie et y rembourse. */
function PositionDialog({ data, site, onClose, onDone }: { data: Data; site: Site; onClose: () => void; onDone: () => void }) {
  const { data: p, reload } = useApi<Position | null>(`${API}?position=${site.deskId}`, d => (d?.data as Position) ?? null, null, { quiet: true });
  const [line, setLine] = useState({ kind: "owner_paid", amount: "", label: "" });
  const [repay, setRepay] = useState<{ id: string; left: number; amount: string; from: string } | null>(null);
  const op = useOpKey();
  const after = () => { reload(); onDone(); };
  async function post(body: Record<string, unknown>, msg: string) {
    const r = await apiSend<{ error?: string }>("POST", API, body, op.headers());
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast(msg, "success"); after();
  }
  async function cancel(id: string, label: string) {
    const reason = await promptDialog({ title: `Annuler « ${label} » ?`, message: "L'écriture est extournée. La ligne reste visible, barrée.", label: "Motif", required: true });
    if (reason) post({ action: "cancel", id, reason }, "Ligne annulée");
  }
  async function qualify(id: string, kind: string) {
    const code = await promptDialog({ title: "Compte de financement", message: "Le compte traduit un acte (décision, convention) : il ne le remplace pas. Exemples : 462000 compte courant d'associé, 162000 emprunt, 401100 fournisseur.", label: "Compte", required: true, defaultValue: kind === "owner_paid" ? "462000" : kind === "debt" ? "401100" : "" });
    if (code) post({ action: "qualify", id, accountCode: code.trim() }, "Ligne qualifiée");
  }
  return (
    <Modal open onClose={onClose} title={`Situation de départ — ${site.name}`} size="lg">
      {!p ? <div className="h-32 animate-pulse" /> : <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3 text-sm space-y-1">
            <p className="font-semibold">D&apos;où vient l&apos;argent</p>
            <p className="flex justify-between"><span>Argent reçu en caisse</span><b className="font-mono">{MONEY(p.money)}</b></p>
            <p className="flex justify-between"><span>Payé par le dirigeant</span><b className="font-mono">{MONEY(p.owner)}</b></p>
            <p className="flex justify-between"><span>Dettes de départ</span><b className="font-mono">{MONEY(p.debts)}</b></p>
            <p className="flex justify-between"><span>Stock repris ou déjà payé</span><b className="font-mono">{MONEY(p.takenOver)}</b></p>
            <p className="flex justify-between border-t border-line pt-1"><span>Total</span><b className="font-mono">{MONEY(p.resources)}</b></p>
          </div>
          <div className="rounded-lg border border-line p-3 text-sm space-y-1">
            <p className="font-semibold">Où il est allé</p>
            <p className="flex justify-between"><span>Caisse de départ</span><b className="font-mono">{MONEY(p.money)}</b></p>
            <p className="flex justify-between"><span>Stock de départ</span><b className="font-mono">{MONEY(p.stockValue)}</b></p>
            <p className="flex justify-between"><span>Équipements, créances</span><b className="font-mono">{MONEY(p.equipment + p.receivables)}</b></p>
            <p className="flex justify-between border-t border-line pt-1"><span>Total</span><b className="font-mono">{MONEY(p.uses)}</b></p>
          </div>
        </div>
        {p.gap !== 0 && <p className="text-sm text-neg">Écart de {MONEY(Math.abs(p.gap))} : {p.gap < 0 ? "des biens de départ n'ont pas d'origine déclarée : ajoutez une ligne « stock repris », « payé par le dirigeant » ou « dette »." : "de l'argent déclaré n'a pas d'emploi connu."}</p>}
        {p.repayableLeft > 0 && <p className="text-sm text-ink2">Reste à rembourser : <b className="font-mono">{MONEY(p.repayableLeft)}</b>. Ce n&apos;est ni une charge ni le seuil de rentabilité.</p>}
        <ul className="divide-y divide-line">{p.lines.map(l => (
          <li key={l._id} className="py-2 flex items-center justify-between gap-2 flex-wrap text-sm">
            <span>{l.label} <span className="text-ink3">· {new Date(l.date).toLocaleDateString("fr-FR")}</span> {l.toQualify ? <Pill tone="warn">à qualifier</Pill> : null}</span>
            <span className="flex items-center gap-2"><b className="font-mono">{MONEY(l.amount)}</b>
              {l.toQualify && <button onClick={() => qualify(l._id, l.kind)} className={buttonClass("ghost", "sm")}>Qualifier</button>}
              {l.left > 0 && !l.toQualify && <button onClick={() => setRepay({ id: l._id, left: l.left, amount: String(l.left), from: "" })} className={buttonClass("ghost", "sm")}>Rembourser</button>}
              {l.cancellable && <button onClick={() => cancel(l._id, l.label)} className={buttonClass("ghost", "sm")} aria-label={`Annuler ${l.label}`}><Trash2 size={14} /></button>}
            </span>
          </li>
        ))}</ul>
        {p.cancelled.length > 0 && <ul className="text-[12px] text-ink3">{p.cancelled.map(c => <li key={c._id}><s>{c.label} · {MONEY(c.amount)}</s> — annulé : {c.reason}</li>)}</ul>}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {p.validatedAt ? <Pill tone="pos">validée le {new Date(p.validatedAt).toLocaleDateString("fr-FR")}</Pill> : <button onClick={() => post({ action: "validate", deskId: site.deskId }, "Situation validée")} className={buttonClass("primary", "sm")}>Valider la situation (comptable)</button>}
        </div>
        {repay && <div className="rounded-lg border border-line p-3 space-y-2">
          <p className="text-sm font-semibold">Rembourser (reste dû : {MONEY(repay.left)})</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} inputMode="numeric" value={repay.amount} onChange={e => setRepay({ ...repay, amount: e.target.value })} aria-label="Montant remboursé" />
            <select className={selectCls} value={repay.from} aria-label="Compte qui rembourse" onChange={e => setRepay({ ...repay, from: e.target.value })}><option value="">Compte qui rembourse…</option>{data.accounts.filter(a => a.balance > 0).map(a => <option key={a._id} value={a._id}>{a.label} ({MONEY(a.balance)})</option>)}</select>
          </div>
          <button onClick={async () => { if (await confirmDialog(`Rembourser ${MONEY(num(repay.amount))} ?`)) { await post({ action: "repay", id: repay.id, amount: num(repay.amount), fromAccountId: repay.from }, "Remboursement enregistré"); setRepay(null); } }} className={buttonClass("primary", "sm")}>Rembourser</button>
        </div>}
        <div className="rounded-lg border border-line p-3 space-y-2">
          <p className="text-sm font-semibold">Ajouter une ligne</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={selectCls} value={line.kind} aria-label="Nature" onChange={e => setLine({ ...line, kind: e.target.value })}>{data.kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
            <input className={inputCls} inputMode="numeric" value={line.amount} onChange={e => setLine({ ...line, amount: e.target.value })} placeholder="Montant" aria-label="Montant" />
            <input className={inputCls} value={line.label} onChange={e => setLine({ ...line, label: e.target.value })} placeholder="Précision" aria-label="Précision" />
          </div>
          <button onClick={() => { post({ action: "line", deskId: site.deskId, kind: line.kind, amount: num(line.amount), label: line.label || undefined }, "Ligne ajoutée"); setLine({ kind: line.kind, amount: "", label: "" }); }} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter</button>
          <p className="text-[12px] text-ink3">Ces lignes ne font aucun mouvement d&apos;argent. Une dette ou un paiement du dirigeant ne se rembourse qu&apos;après sa qualification par la comptable.</p>
        </div>
      </div>}
    </Modal>
  );
}

function ArchivePanel({ data, onDone }: { data: Data; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [solder, setSolder] = useState(true);
  const [cashTo, setCashTo] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = data.sites.filter(s => picked.includes(s.deskId));
  const cash = chosen.reduce((t, s) => t + Math.max(0, s.cashBalance ?? 0), 0);
  async function archive() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", API, { action: "archive", deskIds: picked, solderStock: solder, cashTo: cashTo || undefined, confirm });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Archivage refusé", "error");
    showToast(`${picked.length} site(s) archivé(s)`, "success"); setPicked([]); setConfirm(""); onDone();
  }
  return (
    <section className="surface-card p-4 space-y-3">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-2 font-semibold text-ink"><span className="inline-flex items-center gap-2"><Archive size={16} /> Repartir de zéro : archiver des sites</span><ChevronDown size={16} className={open ? "rotate-180" : ""} /></button>
      {open && <>
        <p className="text-[12px] text-ink3">Rien n&apos;est supprimé : ventes, caisses, écritures et mouvements restent consultables dans l&apos;espace comptable. Le nom du site est libéré. Avant d&apos;archiver : sauvegarde complète, inventaire physique, caisses fermées, accord de la comptable. Les dettes et les avances restent dues et visibles.</p>
        {!data.sites.length ? <p className="text-sm text-ink3">Aucun site actif.</p> : <ul className="divide-y divide-line">{data.sites.map(s => (
          <li key={s.deskId} className="py-2 flex items-center gap-3 flex-wrap text-sm">
            <label className="inline-flex items-center gap-2 flex-1 min-w-48"><input type="checkbox" checked={picked.includes(s.deskId)} onChange={e => setPicked(p => e.target.checked ? [...p, s.deskId] : p.filter(x => x !== s.deskId))} /> {s.name}</label>
            <span className="text-ink2">{s.items} article(s) · stock {MONEY(s.stockValue)} · caisse {MONEY(s.cashBalance)}</span>
            {s.sessionOpen && <Pill tone="warn">caisse ouverte</Pill>}{s.pendingTransfers > 0 && <Pill tone="warn">transfert en attente</Pill>}{s.easypayKeys > 0 && <Pill tone="warn">clé EasyPay active</Pill>}{s.negatives > 0 && <Pill tone="warn">{s.negatives} négatif(s)</Pill>}{s.openDebts > 0 && <Pill tone="info">dettes {MONEY(s.openDebts)}</Pill>}{s.advancesLeft > 0 && <Pill tone="info">avances {MONEY(s.advancesLeft)}</Pill>}{s.credits > 0 && <Pill tone="info">ardoises {MONEY(s.credits)}</Pill>}
          </li>
        ))}</ul>}
        {picked.length > 0 && <div className="space-y-2 border-t border-line pt-3">
          <label className="flex items-start gap-2 text-sm text-ink2"><input type="checkbox" className="mt-1" checked={solder} onChange={e => setSolder(e.target.checked)} /> Solder le stock restant à zéro (ajustement tracé) : le stock réel sera ressaisi comme stock de départ des nouveaux sites, sans double compte.</label>
          {cash > 0 && <FormField label={`Virer le solde des caisses (${MONEY(cash)}) vers`}><select className={selectCls} value={cashTo} onChange={e => setCashTo(e.target.value)}><option value="">Laisser sur la caisse archivée</option>{data.accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select></FormField>}
          <div className="flex gap-2 items-end flex-wrap">
            <FormField label="Tapez ARCHIVER pour confirmer"><input className={`${inputCls} w-40`} value={confirm} onChange={e => setConfirm(e.target.value)} /></FormField>
            <button disabled={busy || confirm !== "ARCHIVER"} onClick={archive} className={buttonClass("primary", "md")}><Archive size={15} /> Archiver {picked.length} site(s)</button>
          </div>
        </div>}
      </>}
    </section>
  );
}
