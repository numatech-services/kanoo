"use client";
import { useCallback, useEffect, useState } from "react";
import { CookingPot, Save, ArrowUpFromLine, ClipboardCheck, ShoppingCart } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { useOpKey } from "@/lib/use-op-key";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const QTY = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SERVICES = { midi: "Midi", soir: "Soir", jour: "Journée" } as const;
type Svc = keyof typeof SERVICES;

interface Plan {
  day: string; basis: "schedule" | "history"; expectedTickets: number | null; portions: number; menuCost: number | null; costPerPortion: number | null;
  dishes: Array<{ itemId: string; name: string; category?: string; forecast: number; planned: number; unitCost: number | null; cost: number | null; priceTTC: number }>;
  needs: Array<{ itemId: string; name: string; unit: string; needed: number; desk: number; reserve: number; toSupply: number; toBuy: number }>;
  menus: Array<{ _id: string; service: Svc; lines: Array<{ itemId: string; quantity: number }>; issuedRef?: string; closing?: { at: string; lines: Array<{ itemId: string; produced: number; sold: number; leftover: number; leftoverValue?: number }> } }>;
  menuItems: Array<{ itemId: string; name: string; category?: string; preparation: boolean }>;
}

/**
 * Production et cuisine, jour par jour : prévision des ventes, menu de chaque
 * service, ingrédients à monter de la réserve (bon de sortie) et à acheter,
 * coût du menu, puis fin de service (produit, vendu, restes passés en perte).
 */
export default function ProductionPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [day, setDay] = useState(() => dayOf(new Date(Date.now() + 86_400_000)));
  const [service, setService] = useState<Svc>("midi");
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const { data: plan, loading, error, reload } = useApi<Plan | null>(deskId ? `/api/restauration/production?deskId=${deskId}&day=${day}` : null, d => (d?.data as Plan) ?? null, null, { quiet: true });
  const menu = plan?.menus.find(m => m.service === service);
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><CookingPot size={22} /> Production et cuisine</h1>
          <p className="text-sm text-ink2">Ce qu&apos;il faut produire, ce qu&apos;il faut sortir de la réserve ou acheter, et ce qui reste en fin de service.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          <FormField label="Jour"><input type="date" className={inputCls} value={day} onChange={e => e.target.value && setDay(e.target.value)} /></FormField>
          <FormField label="Service"><select className={selectCls} value={service} onChange={e => setService(e.target.value as Svc)}>{(Object.keys(SERVICES) as Svc[]).map(k => <option key={k} value={k}>{SERVICES[k]}</option>)}</select></FormField>
        </div>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {deskId && <BatchPanel key={deskId} deskId={deskId} day={day} />}
      {loading && !plan ? <div className="h-64 surface-card animate-pulse" /> : !plan ? null
        // Clé : un autre jour, service ou menu enregistré repart des données reçues.
        : <DayView key={`${plan.day}:${service}:${JSON.stringify(menu?.lines ?? null)}:${menu?.closing ? 1 : 0}`} plan={plan} menu={menu} service={service} deskId={deskId} reload={reload} />}
    </div>
  );
}

function DayView({ plan, menu, service, deskId, reload }: { plan: Plan; menu: Plan["menus"][number] | undefined; service: Svc; deskId: string; reload: () => void }) {
  const day = plan.day;
  // Menu saisi, sinon la prévision comme point de départ.
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(menu ? menu.lines.map(l => [l.itemId, String(l.quantity)]) : plan.menus.length ? [] : plan.dishes.map(d => [d.itemId, String(d.forecast)])));
  const [close, setClose] = useState<Record<string, { produced: string; leftover: string }>>(() => Object.fromEntries((menu?.lines ?? []).map(l => [l.itemId, { produced: String(l.quantity), leftover: "0" }])));
  const [busy, setBusy] = useState(false);
  const name = (id: string) => plan.menuItems.find(m => m.itemId === id)?.name ?? plan.dishes.find(d => d.itemId === id)?.name ?? "—";

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const r = await apiSend<{ error?: string; data?: { reference?: string; toBuy?: unknown[]; leftoverValue?: number } }>("POST", "/api/restauration/production", { deskId, day, service, ...body });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Opération refusée", "error");
    showToast(okMsg + (r.data.data?.reference ? ` (${r.data.data.reference})` : "") + (r.data.data?.leftoverValue ? ` — restes ${MONEY(r.data.data.leftoverValue)}` : ""), "success");
    reload();
  }

  return (
    <div className="space-y-5">
        <p className="text-sm text-ink2">
          Prévision {plan.basis === "schedule" ? "d'après l'emploi du temps du campus" : "d'après la moyenne des quatre mêmes jours de semaine précédents"}, réservations EasyPay comprises
          {plan.expectedTickets !== null ? ` · environ ${plan.expectedTickets} ticket(s) attendus` : ""} · {plan.portions} portion(s) au plan
          {plan.menuCost !== null ? ` · coût matière ${MONEY(plan.menuCost)}, soit ${MONEY(plan.costPerPortion)} par portion` : ""}.
        </p>

        <section className="surface-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-ink">Menu du service — {SERVICES[service]} {menu?.closing ? <Pill tone="mute">clos</Pill> : null}</h2>
            {!menu?.closing && <button disabled={busy} onClick={() => post({ action: "menu", lines: Object.entries(qty).map(([itemId, q]) => ({ itemId, quantity: Number(q) || 0 })) }, "Menu enregistré")} className={buttonClass("primary", "sm")}><Save size={14} /> Enregistrer le menu</button>}
          </div>
          <table className="table-dense w-full">
            <thead><tr><th>Plat ou article</th><th className="text-right">Prévu</th><th>À produire</th>{plan.menuCost !== null && <th className="text-right">Coût matière</th>}<th></th></tr></thead>
            <tbody>
              {Object.keys(qty).map(id => {
                const d = plan.dishes.find(x => x.itemId === id);
                return (
                  <tr key={id} className="border-t border-line">
                    <td>{name(id)}</td>
                    <td className="text-right font-mono text-ink2">{d?.forecast ?? "—"}</td>
                    <td><input className={`${inputCls} w-24`} inputMode="numeric" disabled={!!menu?.closing} value={qty[id]} onChange={e => setQty(x => ({ ...x, [id]: e.target.value }))} /></td>
                    {plan.menuCost !== null && <td className="text-right font-mono">{d?.unitCost != null ? MONEY(d.unitCost * (Number(qty[id]) || 0)) : "—"}</td>}
                    <td>{!menu?.closing && <button onClick={() => setQty(x => { const n = { ...x }; delete n[id]; return n; })} className={buttonClass("ghost", "sm")}>Retirer</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!menu?.closing && (
            <select className={selectCls} value="" onChange={e => e.target.value && setQty(x => ({ ...x, [e.target.value]: x[e.target.value] ?? "0" }))}>
              <option value="">Ajouter un plat…</option>
              {plan.menuItems.filter(m => !(m.itemId in qty)).map(m => <option key={m.itemId} value={m.itemId}>{m.name}{m.preparation ? "" : " (article)"}</option>)}
            </select>
          )}
        </section>

        <section className="surface-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-ink">Ingrédients du jour</h2>
            <button disabled={busy || !plan.needs.some(n => n.toSupply > 0)} onClick={() => post({ action: "issue" }, "Bon de sortie passé : comptoir approvisionné depuis la réserve")} className={buttonClass("primary", "sm")}><ArrowUpFromLine size={14} /> Bon de sortie de la réserve</button>
          </div>
          {!plan.needs.length ? <p className="text-sm text-ink3">Rien au plan pour ce jour.</p> : (
            <div className="overflow-x-auto"><table className="table-dense w-full">
              <thead><tr><th>Ingrédient</th><th className="text-right">Nécessaire</th><th className="text-right">Au comptoir</th><th className="text-right">En réserve</th><th className="text-right">À monter</th><th className="text-right">À acheter</th></tr></thead>
              <tbody>{plan.needs.map(n => (
                <tr key={n.itemId} className="border-t border-line">
                  <td>{n.name}</td><td className="text-right font-mono">{QTY(n.needed)} <span className="text-ink3 text-xs">{n.unit}</span></td>
                  <td className="text-right font-mono text-ink2">{QTY(n.desk)}</td><td className="text-right font-mono text-ink2">{QTY(n.reserve)}</td>
                  <td className="text-right font-mono">{n.toSupply ? QTY(n.toSupply) : "—"}</td>
                  <td className={`text-right font-mono ${n.toBuy ? "text-neg font-semibold" : ""}`}>{n.toBuy ? QTY(n.toBuy) : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {plan.needs.some(n => n.toBuy > 0) && <p className="text-xs text-warn flex gap-1.5"><ShoppingCart size={13} className="mt-0.5" /> {plan.needs.filter(n => n.toBuy > 0).length} ingrédient(s) à acheter : passez la commande (Comptoir → Stock → Réassort) ou la réception du marché.</p>}
          {plan.menus.some(m => m.issuedRef) && <p className="text-xs text-ink3">Bon de sortie déjà passé : {plan.menus.find(m => m.issuedRef)?.issuedRef}.</p>}
        </section>

        {menu && (
          <section className="surface-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-semibold text-ink inline-flex items-center gap-2"><ClipboardCheck size={16} /> Fin de service — {SERVICES[service]}</h2>
              {!menu.closing && <button disabled={busy} onClick={() => post({ action: "close", lines: Object.entries(close).map(([itemId, v]) => ({ itemId, produced: Number(v.produced) || 0, leftover: Number(v.leftover) || 0 })) }, "Service clos : restes passés en perte")} className={buttonClass("primary", "sm")}>Clore le service</button>}
            </div>
            {menu.closing ? (
              <table className="table-dense w-full">
                <thead><tr><th>Plat</th><th className="text-right">Produit</th><th className="text-right">Vendu</th><th className="text-right">Restes</th><th className="text-right">Valeur des restes</th></tr></thead>
                <tbody>{menu.closing.lines.map(l => <tr key={l.itemId} className="border-t border-line"><td>{name(l.itemId)}</td><td className="text-right font-mono">{l.produced}</td><td className="text-right font-mono">{l.sold}</td><td className="text-right font-mono">{l.leftover}</td><td className="text-right font-mono">{MONEY(l.leftoverValue)}</td></tr>)}</tbody>
              </table>
            ) : !menu.lines.length ? <EmptyState icon={<ClipboardCheck size={20} />} title="Menu vide" hint="Enregistrez d'abord le menu du service." /> : (
              <table className="table-dense w-full">
                <thead><tr><th>Plat</th><th>Produit</th><th>Restes (non vendus)</th></tr></thead>
                <tbody>{menu.lines.map(l => (
                  <tr key={l.itemId} className="border-t border-line">
                    <td>{name(l.itemId)}</td>
                    <td><input className={`${inputCls} w-24`} inputMode="numeric" value={close[l.itemId]?.produced ?? ""} onChange={e => setClose(x => ({ ...x, [l.itemId]: { ...x[l.itemId], produced: e.target.value } }))} /></td>
                    <td><input className={`${inputCls} w-24`} inputMode="numeric" value={close[l.itemId]?.leftover ?? ""} onChange={e => setClose(x => ({ ...x, [l.itemId]: { ...x[l.itemId], leftover: e.target.value } }))} /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="text-[11px] text-ink3">Les ventes du jour sont reprises des tickets. Les restes sont passés en perte « invendus » : leurs ingrédients sortent du stock au coût de la fiche technique et entrent dans le résultat.</p>
          </section>
        )}
    </div>
  );
}

/** Produire à l'avance : pour les plats réglés « par lot », les ingrédients sortent ici et les portions entrent au comptoir. */
function BatchPanel({ deskId, day }: { deskId: string; day: string }) {
  const op = useOpKey();
  const [dishes, setDishes] = useState<Array<{ _id: string; name: string; quantity?: number }>>([]);
  const [itemId, setItemId] = useState(""), [portions, setPortions] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => setDishes(((d.data ?? []) as Array<{ _id: string; name: string; quantity?: number; productionMode?: string }>).filter(i => i.productionMode === "batch"))).catch(() => {}); }, [deskId]);
  useEffect(() => { load(); }, [load]);
  if (!dishes.length) return null;
  async function produce() {
    setBusy(true);
    const r = await apiSend<{ error?: string; data?: { number: string; portions: number; unitCost?: number } }>("POST", "/api/restauration/production", { deskId, day, action: "batch", itemId, portions: Number(portions.replace(",", ".")) }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Production refusée", "error");
    op.done(); showToast(`${r.data.data?.portions} portion(s) produites (${r.data.data?.number})`, "success"); setPortions(""); load();
  }
  return (
    <section className="surface-card p-4 space-y-2">
      <h2 className="font-semibold text-ink">Produire un lot</h2>
      <div className="flex gap-2 items-end flex-wrap">
        <FormField label="Plat"><select className={selectCls} value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Choisir…</option>{dishes.map(d => <option key={d._id} value={d._id}>{d.name} ({d.quantity ?? 0} en stock)</option>)}</select></FormField>
        <FormField label="Portions"><input className={`${inputCls} w-24`} inputMode="numeric" value={portions} onChange={e => setPortions(e.target.value)} /></FormField>
        <button disabled={busy || !itemId || !(Number(portions) > 0)} onClick={produce} className={buttonClass("primary", "md")}>Produire</button>
      </div>
    </section>
  );
}
