"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, AlertTriangle, Ban, Check, Pencil, Plus, RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { PageLoading } from "@/components/ui/PageState";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { ALERT_CATEGORIES, ALERT_REPEATS, DEFAULT_REMIND_DAYS, dueWording } from "@/lib/alerts";

type Person = { _id: string; firstName?: string; lastName?: string; isActive?: boolean };
interface Alert {
  _id: string; title: string; description?: string; consequence?: string; category: string; dueDate: string;
  remindDays: number[]; repeat: string; status: "open" | "done" | "cancelled"; left: number; tone: "neg" | "warn" | "info";
  assigneeIds?: Person[]; contractId?: { _id: string; reference?: string; title?: string } | null;
  createdBy?: Person | null; doneBy?: Person | null; doneAt?: string; doneNote?: string;
  /** Modifier / annuler : l'auteur, la direction ou un chef (calculé par l'API). */
  canEdit?: boolean;
}
interface AutoItem { id: string; title: string; dueDate: string; left: number; consequence?: string; href: string }
interface ListData { items: Alert[]; automatic: AutoItem[]; canManage: boolean }
const EMPTY: ListData = { items: [], automatic: [], canManage: false };

const TABS = [["open", "À traiter"], ["done", "Traitées"], ["cancelled", "Annulées"]] as const;
const name = (p?: Person | null) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "—" : "—");
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR");
const toneText = (left: number) => (left <= 0 ? "text-neg" : left <= 7 ? "text-warn" : "text-ink2");

function AlertsScreen() {
  const sp = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"open" | "done" | "cancelled">("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useApi<ListData>(`/api/alerts?status=${status}`, d => d?.data ?? EMPTY, EMPTY);
  const { items, automatic, canManage } = list.data;
  const highlight = sp.get("alerte");

  // Ouverture du formulaire depuis le tableau de bord ou une fiche contrat.
  const prefill = useMemo(() => sp.get("nouvelle") ? {
    title: sp.get("titre") ?? "", dueDate: sp.get("echeance") ?? "", contractId: sp.get("contractId") ?? "",
    contractLabel: sp.get("contrat") ?? "", consequence: sp.get("consequence") ?? "", category: sp.get("categorie") ?? "",
  } : null, [sp]);
  const [editing, setEditing] = useState<Alert | "new" | null>(null);
  const [prefillClosed, setPrefillClosed] = useState(false);
  // Formulaire ouvert d'office quand l'adresse le demande (?nouvelle=1).
  const shown = editing ?? (prefill && canManage && !prefillClosed ? "new" : null);
  useEffect(() => {
    if (!highlight || !items.length) return;
    document.getElementById(`alerte-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight, items.length]);

  function closeForm() {
    setEditing(null);
    if (sp.get("nouvelle")) { setPrefillClosed(true); router.replace("/alertes"); }
  }

  async function act(a: Alert, action: "done" | "reopen" | "cancel") {
    let note: string | null | undefined;
    if (action === "done") {
      note = await promptDialog({ title: `Marquer « ${a.title} » comme traitée`, label: "Ce qui a été fait (facultatif)", placeholder: "Ex. : enregistré le 12/12, quittance n° …", multiline: true, confirmLabel: "Marquer traitée" });
      if (note === null) return;
    } else if (action === "cancel" && !(await confirmDialog({ title: `Annuler l'alerte « ${a.title} » ?`, message: "Plus aucun rappel ne sera envoyé. Vous pourrez la rouvrir.", confirmLabel: "Annuler l'alerte", cancelLabel: "Garder l'alerte", danger: true }))) return;
    const res = await apiSend("PATCH", `/api/alerts/${a._id}`, { action, ...(note ? { note } : {}) });
    const next = res.data?.data?.next as { dueDate?: string } | null | undefined;
    setMsg({ ok: res.ok, text: res.ok
      ? action === "done" ? `Alerte traitée.${next?.dueDate ? ` Prochaine occurrence le ${day(next.dueDate)}.` : ""}` : action === "cancel" ? "Alerte annulée." : "Alerte rouverte."
      : res.data?.error || "Action refusée." });
    if (res.ok) list.reload();
  }

  const late = status === "open" ? items.filter(a => a.left < 0).length + automatic.filter(a => a.left < 0).length : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Alertes et échéances</h1>
          <p className="text-sm text-ink2">Délais à ne pas manquer : rappel par notification aux dates choisies, le jour même, puis chaque semaine de retard tant que l&apos;alerte n&apos;est pas traitée.</p>
        </div>
        {canManage && <button onClick={() => setEditing("new")} className={buttonClass("primary", "md")}><Plus size={16} /> Nouvelle alerte</button>}
      </div>
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtrer les alertes">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}
            className={`px-3 py-1.5 rounded-full text-sm ${status === k ? "bg-section text-white" : "bg-surface2 text-ink2"}`}>{l}</button>
        ))}
      </div>
      {msg && <p role="status" className={`p-3 rounded-lg text-sm ${msg.ok ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>{msg.text}</p>}
      {late > 0 && <p className="p-3 rounded-lg text-sm bg-neg-50 text-neg flex items-center gap-2"><AlertTriangle size={15} /> {late} échéance{late > 1 ? "s" : ""} dépassée{late > 1 ? "s" : ""}.</p>}

      {highlight && list.loaded && status === "open" && !items.some(a => a._id === highlight) && (
        <p className="p-3 rounded-lg text-sm bg-surface2 text-ink2">L&apos;alerte demandée n&apos;est plus à traiter : consultez les onglets « Traitées » ou « Annulées ».</p>
      )}
      {list.loading && !list.loaded ? <PageLoading /> : (
        <div className="bg-surface rounded-xl border border-line divide-y divide-line">
          {items.length === 0 && <p className="text-center text-ink3 py-8 text-sm">{status === "open" ? "Aucune alerte à traiter." : status === "done" ? "Aucune alerte traitée." : "Aucune alerte annulée."}</p>}
          {items.map(a => (
            <div key={a._id} id={`alerte-${a._id}`} className={`p-4 flex gap-3 items-start flex-wrap ${highlight === a._id ? "bg-accent-50/60" : ""}`}>
              <div className="min-w-[7.5rem]">
                <p className="text-sm font-semibold font-mono">{day(a.dueDate)}</p>
                {a.status === "open" && <p className={`text-xs font-semibold ${toneText(a.left)}`}>{dueWording(a.left)}</p>}
              </div>
              <div className="flex-1 min-w-[14rem] space-y-0.5">
                <p className="text-sm font-semibold text-ink">{a.title}</p>
                {a.consequence && <p className="text-xs text-neg">{a.consequence}</p>}
                {a.description && <p className="text-xs text-ink2 whitespace-pre-line">{a.description}</p>}
                <p className="text-[11px] text-ink3">
                  {ALERT_CATEGORIES[a.category as keyof typeof ALERT_CATEGORIES] ?? a.category}
                  {a.contractId && <> · contrat <Link href={`/contracts/${a.contractId._id}`} className="text-section hover:underline font-mono">{a.contractId.reference ?? a.contractId.title}</Link></>}
                  {" · "}{a.assigneeIds?.length ? `pour ${a.assigneeIds.map(p => `${name(p)}${p.isActive === false ? " (inactif)" : ""}`).join(", ")} ; la direction est aussi prévenue le jour J et en cas de retard` : "pour la direction et la comptabilité"}
                  {a.status === "open" && <> · rappels {a.remindDays.length ? a.remindDays.map(d => `J-${d}`).join(", ") : "—"}</>}
                  {a.repeat !== "none" && <> · {ALERT_REPEATS[a.repeat as keyof typeof ALERT_REPEATS]?.toLowerCase()}</>}
                </p>
                {a.status === "done" && <p className="text-[11px] text-pos">Traitée le {a.doneAt ? day(a.doneAt) : "—"} par {name(a.doneBy)}{a.doneNote ? ` — ${a.doneNote}` : ""}</p>}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {a.status === "open" && <button onClick={() => act(a, "done")} className={buttonClass("secondary", "sm")}><Check size={14} /> Marquer traitée</button>}
                {a.canEdit && a.status === "open" && <button onClick={() => setEditing(a)} className={buttonClass("ghost", "sm")} aria-label={`Modifier l'alerte ${a.title}`} title="Modifier"><Pencil size={14} /></button>}
                {a.canEdit && a.status === "open" && <button onClick={() => act(a, "cancel")} className={buttonClass("ghost", "sm")} aria-label={`Annuler l'alerte ${a.title}`} title="Annuler l'alerte"><Ban size={14} /></button>}
                {a.canEdit && a.status !== "open" && <button onClick={() => act(a, "reopen")} className={buttonClass("ghost", "sm")}><RotateCcw size={14} /> Rouvrir</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "open" && automatic.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Échéances calculées par Kanoo</h2>
          <p className="text-xs text-ink3">Droits d&apos;enregistrement des marchés clients non encore payés : un mois après l&apos;approbation (marché public) ou la signature. Ces échéances disparaissent une fois les droits payés ou le numéro de quittance saisi sur la fiche du marché. Les autres contrats (bail, cession…) ne sont suivis que si vous créez une alerte.</p>
          <div className="bg-surface rounded-xl border border-line divide-y divide-line">
            {automatic.map(a => (
              <Link key={a.id} href={a.href} className="p-4 flex gap-3 items-start hover:bg-surface2/40">
                <div className="min-w-[7.5rem]"><p className="text-sm font-semibold font-mono">{day(a.dueDate)}</p><p className={`text-xs font-semibold ${toneText(a.left)}`}>{dueWording(a.left)}</p></div>
                <div className="flex-1"><p className="text-sm font-semibold text-ink flex items-center gap-1.5"><AlarmClock size={14} /> {a.title}</p>{a.consequence && <p className="text-xs text-ink3">{a.consequence}</p>}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {shown && <AlertForm alert={shown === "new" ? null : shown} prefill={shown === "new" ? prefill : null}
        onClose={closeForm} onDone={text => { closeForm(); setStatus("open"); setMsg({ ok: true, text }); list.reload(); }} />}
    </div>
  );
}

type Prefill = { title: string; dueDate: string; contractId: string; contractLabel: string; consequence: string; category: string } | null;

function AlertForm({ alert, prefill, onClose, onDone }: { alert: Alert | null; prefill: Prefill; onClose: () => void; onDone: (text: string) => void }) {
  const people = useApi<Person[]>("/api/agenda/directory", d => d?.data ?? [], []);
  const [f, setF] = useState(() => ({
    title: alert?.title ?? prefill?.title ?? "",
    dueDate: alert ? alert.dueDate.slice(0, 10) : prefill?.dueDate ?? "",
    category: alert?.category ?? (prefill?.category || (prefill?.contractId ? "contrat" : "autre")),
    consequence: alert?.consequence ?? prefill?.consequence ?? "",
    description: alert?.description ?? "",
    remindDays: (alert?.remindDays ?? DEFAULT_REMIND_DAYS).join(", "),
    repeat: alert?.repeat ?? "none",
    assigneeIds: (alert?.assigneeIds ?? []).map(p => p._id),
  }));
  const contractId = alert ? alert.contractId?._id ?? "" : prefill?.contractId ?? "";
  const inactive = (alert?.assigneeIds ?? []).filter(p => p.isActive === false);
  const contractLabel = alert ? alert.contractId?.reference ?? "" : prefill?.contractLabel ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF(x => ({ ...x, ...patch }));
  const toggle = (id: string) => set({ assigneeIds: f.assigneeIds.includes(id) ? f.assigneeIds.filter(x => x !== id) : [...f.assigneeIds, id] });

  async function submit() {
    setBusy(true); setError("");
    const body = { ...f, remindDays: f.remindDays, ...(alert ? {} : contractId ? { contractId } : {}) };
    const res = alert ? await apiSend("PATCH", `/api/alerts/${alert._id}`, body) : await apiSend("POST", "/api/alerts", body);
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement refusé."); return; }
    onDone(alert ? "Alerte modifiée." : "Alerte créée : les rappels partiront aux dates choisies.");
  }

  return (
    <Modal open onClose={onClose} title={alert ? "Modifier l'alerte" : "Nouvelle alerte"} size="lg"
      description="Une notification part à chaque délai de prévenance, le jour même, puis chaque semaine de retard."
      footer={<>
        <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
        <button onClick={submit} disabled={busy || !f.title.trim() || !f.dueDate} className={buttonClass("primary", "md")}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
      </>}>
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        {contractLabel && <p className="text-xs text-ink2">Rattachée au contrat <span className="font-mono">{contractLabel}</span>.</p>}
        <FormField label="Intitulé" required><input className={inputCls} value={f.title} maxLength={200} onChange={e => set({ title: e.target.value })} placeholder="Ex. : enregistrer le contrat de bail aux impôts" /></FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Échéance" required><input type="date" className={inputCls} value={f.dueDate} onChange={e => set({ dueDate: e.target.value })} /></FormField>
          <FormField label="Catégorie">
            <select className={selectCls} value={f.category} onChange={e => set({ category: e.target.value })}>
              {Object.entries(ALERT_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="En cas de retard" hint="Ce que coûte un oubli ; ce texte est repris dans chaque rappel."><input className={inputCls} value={f.consequence} maxLength={500} onChange={e => set({ consequence: e.target.value })} placeholder="Ex. : Indemnité de retard d'enregistrement." /></FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Prévenir (jours avant)" hint="Nombres de jours séparés par des virgules, ex. : 30, 7, 1"><input className={inputCls} value={f.remindDays} onChange={e => set({ remindDays: e.target.value })} /></FormField>
          <FormField label="Périodicité" hint="Une fois traitée, une alerte récurrente est recréée pour la période suivante.">
            <select className={selectCls} value={f.repeat} onChange={e => set({ repeat: e.target.value })}>
              {Object.entries(ALERT_REPEATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Notes"><textarea className={textareaCls} rows={3} value={f.description} maxLength={2000} onChange={e => set({ description: e.target.value })} /></FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Destinataires</legend>
          <p className="text-xs text-ink3">Si personne n&apos;est coché, la direction et la comptabilité sont prévenues. Sinon, elles le sont quand même le jour de l&apos;échéance et en cas de retard.</p>
          {inactive.length > 0 && <p className="text-xs text-warn">Destinataire{inactive.length > 1 ? "s" : ""} inactif{inactive.length > 1 ? "s" : ""}, retiré{inactive.length > 1 ? "s" : ""} à l&apos;enregistrement : {inactive.map(name).join(", ")}.</p>}
          <div className="max-h-44 overflow-y-auto grid sm:grid-cols-2 gap-1 border border-line rounded-lg p-2">
            {people.data.map(p => (
              <label key={p._id} className="flex items-center gap-2 text-sm py-0.5">
                <input type="checkbox" checked={f.assigneeIds.includes(p._id)} onChange={() => toggle(p._id)} /> {name(p)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

export default function AlertsPage() {
  return <Suspense fallback={<PageLoading />}><AlertsScreen /></Suspense>;
}
