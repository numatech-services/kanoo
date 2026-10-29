"use client";
import { useEffect, useState } from "react";
import { KeyRound, Plus, Copy, RotateCcw, Ban, ArrowLeftRight, PlugZap } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { EVENT_LABELS, type EventType } from "@/lib/easypay";

const MONEY = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} FCFA`;
const WHEN = (d?: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Key { _id: string; name: string; keyPrefix?: string; isActive: boolean; revokedAt?: string; lastUsedAt?: string; expiresAt?: string; createdAt: string; requestCount?: number }
interface Ev { _id: string; type: string; externalId: string; occurredAt?: string; createdAt: string; status: "applied" | "failed" | "rejected" | "ignored"; error?: string; ref?: { kind: string; number?: string }; attempts: number }
interface Day { day: string; sales: number; card: number; voids: number; voided: number; topups: number; topup: number; net: number; received: number; paid: number; events: { applied: number; pending: number; ignored: number } }
interface Data { keys: Key[]; events: Ev[]; counts: Record<string, number>; balance: number | null; daily?: Day[]; lastEventAt?: string | null }

const STATUS: Record<Ev["status"], { label: string; tone: "pos" | "neg" | "warn" | "mute" }> = {
  applied: { label: "appliqué", tone: "pos" }, failed: { label: "en échec", tone: "neg" }, rejected: { label: "illisible", tone: "warn" }, ignored: { label: "écarté", tone: "mute" },
};

/**
 * Liaison avec EasyPay (caisse, cartes et appli des étudiants) : clé de
 * l'API, compte courant avec Numatech, événements reçus et leur rejeu.
 */
export function EasypayTab({ deskId, onChange }: { deskId: string; onChange: () => void }) {
  const [filter, setFilter] = useState("");
  const { data, reload } = useApi<Data>(`/api/comptoir/easypay?deskId=${deskId}${filter ? `&status=${filter}` : ""}`,
    d => d?.data ?? { keys: [], events: [], counts: {}, balance: null }, { keys: [], events: [], counts: {}, balance: null });
  const [newKey, setNewKey] = useState<{ key: string; expiresAt: string; apiUrl: string } | null>(null);
  const [remit, setRemit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const active = data.keys.filter(k => k.isActive);
  // Heure de l'affichage, figée au premier rendu (pas d'appel impur pendant le rendu).
  const [renderedAt] = useState(() => Date.now());

  async function createKey() {
    setBusy("key");
    const r = await apiSend<{ data: { key: string; expiresAt: string }; error?: string }>("POST", "/api/comptoir/easypay", { deskId, action: "create_key", name: "EasyPay" });
    setBusy(null);
    if (!r.ok) return showToast((r.data as { error?: string }).error || "Création impossible", "error");
    setNewKey({ ...r.data.data, apiUrl: `${window.location.origin}/api/v1/spot` });
    reload();
  }
  async function revoke(k: Key) {
    if (!(await confirmDialog({ title: `Révoquer la clé ${k.keyPrefix ?? ""} ?`, message: "EasyPay ne pourra plus rien envoyer avec elle.", danger: true }))) return;
    const r = await apiSend("POST", "/api/comptoir/easypay", { deskId, action: "revoke_key", keyId: k._id });
    if (!r.ok) return showToast((r.data as { error?: string }).error || "Révocation impossible", "error");
    showToast("Clé révoquée", "success"); reload();
  }
  async function act(ev: Ev, action: "replay" | "ignore") {
    if (action === "ignore" && !(await confirmDialog({ title: "Écarter cet événement ?", message: "Il ne sera pas écrit dans Kanoo." }))) return;
    setBusy(ev._id);
    const r = await apiSend<{ data: { status: string; error?: string }; error?: string }>("POST", `/api/comptoir/easypay/events/${ev._id}`, { action });
    setBusy(null);
    if (!r.ok) return showToast((r.data as { error?: string }).error || "Opération refusée", "error");
    if (action === "replay" && r.data.data.status !== "applied") showToast(`Toujours refusé : ${r.data.data.error}`, "error");
    else showToast(action === "replay" ? "Événement appliqué" : "Événement écarté", "success");
    reload(); onChange();
  }

  const days = data.daily ?? [];
  const stale = active.length > 0 && (!data.lastEventAt || renderedAt - new Date(data.lastEventAt).getTime() > 86_400_000);
  const DAYLBL = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="space-y-5">
      <section className="surface-card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-ink flex items-center gap-2"><ArrowLeftRight size={17} /> Rapprochement des 7 derniers jours</h3>
          <p className={`text-xs ${stale ? "text-warn font-semibold" : "text-ink3"}`}>Dernier envoi de la caisse : {WHEN(data.lastEventAt)}{stale ? " — rien reçu depuis plus de 24 h : vérifier la connexion de la caisse" : ""}</p>
        </div>
        {(data.counts.failed || data.counts.rejected) ? <p className="text-sm text-neg">{(data.counts.failed ?? 0) + (data.counts.rejected ?? 0)} événement(s) en attente de traitement (plus bas : rejouer ou écarter) — tant qu&apos;ils attendent, ventes, stock et sommes dues sont incomplets.</p> : null}
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Jour</th><th className="text-right">Ventes par carte</th><th className="text-right">Annulations</th><th className="text-right">Recharges au comptoir</th><th className="text-right">Dû par Numatech</th>{data.balance !== null && <th className="text-right">Reversements</th>}<th className="text-right">Envois reçus</th></tr></thead>
            <tbody>
              {days.map(d => (
                <tr key={d.day} className="border-t border-line">
                  <td className="whitespace-nowrap">{DAYLBL(d.day)}</td>
                  <td className="text-right font-mono">{d.sales ? <>{MONEY(d.card)}<span className="block text-[11px] text-ink3">{d.sales} ticket(s)</span></> : "—"}</td>
                  <td className="text-right font-mono">{d.voids ? <span className="text-neg">−{MONEY(d.voided)}</span> : "—"}</td>
                  <td className="text-right font-mono">{d.topups ? <span>−{MONEY(d.topup)}</span> : "—"}</td>
                  <td className={`text-right font-mono font-semibold ${d.net < 0 ? "text-neg" : ""}`}>{d.net ? MONEY(d.net) : "—"}</td>
                  {data.balance !== null && <td className="text-right font-mono">{d.received ? <span className="text-pos">+{MONEY(d.received)}</span> : ""}{d.paid ? <span className="block text-neg">−{MONEY(d.paid)}</span> : ""}{!d.received && !d.paid ? "—" : ""}</td>}
                  <td className="text-right text-xs whitespace-nowrap">{d.events.applied} appliqué(s){d.events.pending ? <span className="block text-neg">{d.events.pending} en attente</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink3">« Dû par Numatech » : ventes payées par carte, moins les annulations et les recharges de cartes encaissées au comptoir. Le solde cumulé figure plus bas (compte courant). Pour un rapprochement à deux sources, EasyPay devra envoyer son total de clôture par jour (en préparation côté EasyPay).</p>
      </section>

      <div className="surface-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="font-semibold text-ink flex items-center gap-2"><PlugZap size={17} /> Liaison EasyPay</h3>
            <p className="text-sm text-ink2 mt-1">
              Kanoo fournit à EasyPay les articles et les prix du comptoir. EasyPay envoie ses ventes, annulations, recharges en espèces,
              mouvements de stock et pré-commandes : ils deviennent des tickets, des encaissements et des mouvements de stock ici.
            </p>
            <p className="text-xs text-ink3 mt-1">
              Adresse de l&apos;API : <code className="font-mono">/api/v1/spot</code> sur l&apos;adresse de Kanoo. Les ventes payées par carte sont dues par Numatech (compte 467100) ;
              les recharges encaissées au comptoir lui reviennent.
            </p>
          </div>
          <button onClick={createKey} disabled={busy === "key"} className={buttonClass("primary", "md")}><Plus size={15} /> {active.length ? "Nouvelle clé" : "Relier EasyPay"}</button>
        </div>
        {data.keys.length > 0 && (
          <div className="overflow-x-auto"><table className="table-dense">
            <thead><tr><th>Clé</th><th>Créée</th><th>Dernier appel</th><th>Expire</th><th>État</th><th></th></tr></thead>
            <tbody>{data.keys.map(k => (
              <tr key={k._id} className={k.isActive ? "" : "opacity-50"}>
                <td className="font-mono text-xs">{k.keyPrefix ?? "kno_…"}</td>
                <td className="text-ink2">{WHEN(k.createdAt)}</td>
                <td className="text-ink2">{WHEN(k.lastUsedAt)}{k.requestCount ? <span className="text-ink3"> · {k.requestCount} appels</span> : null}</td>
                <td className="text-ink2">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString("fr-FR") : "—"}</td>
                <td>{k.isActive ? <Pill tone="pos">active</Pill> : <Pill tone="mute">révoquée</Pill>}</td>
                <td className="text-right">{k.isActive && <button onClick={() => revoke(k)} className={buttonClass("ghost", "sm")}><Ban size={14} /> Révoquer</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {data.balance !== null && (
        <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink2">Compte courant avec Numatech (cartes EasyPay)</p>
            <p className={`text-xl font-semibold font-mono ${data.balance >= 0 ? "text-ink" : "text-neg"}`}>{MONEY(Math.abs(data.balance))}</p>
            <p className="text-xs text-ink3">{data.balance > 0 ? "Numatech doit cette somme au comptoir (ventes par carte moins recharges encaissées)." : data.balance < 0 ? "Le comptoir doit cette somme à Numatech (recharges encaissées en espèces)." : "Compte soldé."}</p>
          </div>
          <button onClick={() => setRemit(true)} className={buttonClass("secondary", "md")}><ArrowLeftRight size={15} /> Enregistrer un reversement</button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink mr-2">Événements reçus</h3>
          {(Object.keys(STATUS) as Ev["status"][]).map(s => data.counts[s] ? <Pill key={s} tone={STATUS[s].tone}>{data.counts[s]} {STATUS[s].label}</Pill> : null)}
          <div className="ml-auto w-40">
            <select value={filter} onChange={e => setFilter(e.target.value)} className={selectCls} aria-label="Filtrer les événements">
              <option value="">Tous</option>
              {(Object.keys(STATUS) as Ev["status"][]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </div>
        </div>
        {data.events.length === 0 ? <EmptyState icon={<KeyRound size={20} />} title="Rien de reçu pour l'instant" hint="Créez une clé, copiez-la dans EasyPay : les ventes de la caisse arriveront ici." /> : (
          <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
            <table className="table-dense">
              <thead><tr><th>Reçu</th><th>Type</th><th>Heure à la caisse</th><th>État</th><th>Dans Kanoo</th><th></th></tr></thead>
              <tbody>{data.events.map(ev => (
                <tr key={ev._id}>
                  <td className="text-ink2 whitespace-nowrap">{WHEN(ev.createdAt)}</td>
                  <td className="text-ink">{EVENT_LABELS[ev.type as EventType] ?? ev.type}<span className="block text-[11px] font-mono text-ink3">{ev.externalId}</span></td>
                  <td className="text-ink2 whitespace-nowrap">{WHEN(ev.occurredAt)}</td>
                  <td><Pill tone={STATUS[ev.status].tone}>{STATUS[ev.status].label}</Pill>{ev.error && <span className="block text-xs text-ink3 max-w-sm">{ev.error}</span>}</td>
                  <td className="text-ink2">{ev.ref?.number ?? (ev.status === "applied" ? "✓" : "—")}</td>
                  <td className="text-right whitespace-nowrap">
                    {ev.status === "failed" && <button disabled={busy === ev._id} onClick={() => act(ev, "replay")} className={buttonClass("ghost", "sm")}><RotateCcw size={14} /> Rejouer</button>}
                    {(ev.status === "failed" || ev.status === "rejected") && <button disabled={busy === ev._id} onClick={() => act(ev, "ignore")} className={buttonClass("ghost", "sm")}><Ban size={14} /> Écarter</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        )}
      </div>

      {newKey && <KeyDialog keyValue={newKey.key} expiresAt={newKey.expiresAt} apiUrl={newKey.apiUrl} onClose={() => setNewKey(null)} />}
      {remit && <RemittanceDialog deskId={deskId} balance={data.balance ?? 0} onClose={() => setRemit(false)} onDone={() => { setRemit(false); reload(); onChange(); }} />}
    </div>
  );
}

function KeyDialog({ keyValue, expiresAt, apiUrl, onClose }: { keyValue: string; expiresAt: string; apiUrl: string; onClose: () => void }) {
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => showToast("Copié", "success")).catch(() => {});
  return (
    <Modal open title="Clé EasyPay créée" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-warn font-semibold">Cette clé ne sera plus affichée : copiez-la maintenant.</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs break-all p-2 rounded-lg bg-surface2 border border-line2">{keyValue}</code>
          <button onClick={() => copy(keyValue)} className={buttonClass("secondary", "sm")}><Copy size={14} /> Copier</button>
        </div>
        <p className="text-ink2">Sur le serveur EasyPay, reliez le site à ce comptoir (la clé est demandée, jamais passée en clair dans la commande) :</p>
        <code className="block font-mono text-xs p-2 rounded-lg bg-surface2 border border-line2 break-all">deploy/bin/dc exec app php artisan easypay:kanoo-link the-spot --url={apiUrl}</code>
        <p className="text-xs text-ink3">Valable jusqu&apos;au {new Date(expiresAt).toLocaleDateString("fr-FR")}. Créez-en une nouvelle avant cette date, puis révoquez l&apos;ancienne.</p>
        <div className="flex justify-end"><button onClick={onClose} className={buttonClass("primary", "md")}>C&apos;est copié</button></div>
      </div>
    </Modal>
  );
}

function RemittanceDialog({ deskId, balance, onClose, onDone }: { deskId: string; balance: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Array<{ _id: string; label: string }>>([]);
  const [form, setForm] = useState({ treasuryAccountId: "", amount: String(Math.abs(balance) || ""), direction: balance < 0 ? "paid" : "received", date: localDay(), reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/treasury-accounts?limit=100", { credentials: "include" }).then(r => r.ok ? r.json() : null)
      .then(d => setAccounts(d?.data?.items ?? [])).catch(() => {});
  }, []);
  async function save() {
    setSaving(true); setError(null);
    const r = await apiSend("POST", "/api/comptoir/easypay", { deskId, action: "remittance", ...form, amount: Number(form.amount) });
    setSaving(false);
    if (!r.ok) return setError((r.data as { error?: string }).error || "Enregistrement impossible");
    showToast("Reversement enregistré", "success"); onDone();
  }
  return (
    <Modal open title="Reversement EasyPay" onClose={onClose}>
      <div className="space-y-3">
        <FormField label="Sens">
          <select className={selectCls} value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}>
            <option value="received">Numatech verse au comptoir</option>
            <option value="paid">Le comptoir verse à Numatech</option>
          </select>
        </FormField>
        <FormField label="Compte de trésorerie">
          <select className={selectCls} value={form.treasuryAccountId} onChange={e => setForm({ ...form, treasuryAccountId: e.target.value })}>
            <option value="">Choisir…</option>
            {accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Montant (FCFA)"><input className={inputCls} inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></FormField>
          <FormField label="Date"><input type="date" className={inputCls} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></FormField>
        </div>
        <FormField label="Référence (facultatif)"><input className={inputCls} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="n° de virement…" /></FormField>
        {error && <p className="text-sm text-neg">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonClass("ghost", "md")}>Annuler</button>
          <button onClick={save} disabled={saving || !form.treasuryAccountId || !(Number(form.amount) > 0)} className={buttonClass("primary", "md")}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
