"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Minus, Plus, Banknote, Smartphone, MessageCircle, WifiOff, RotateCcw } from "lucide-react";
import { useUrlReady } from "@/lib/url-param";
import { apiJson, apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
import { bestPromoPrice, type Promo } from "@/lib/spot";
import { PageLoading } from "@/components/ui/PageState";

const MONEY = (n: number) => `${Math.round(n || 0).toLocaleString("fr-FR")} F`;
interface Item { _id: string; name: string; unit: string; quantity: number; salePrice?: number; category?: string; recipe?: unknown[] }
interface Pending { clientRef: string; body: Record<string, unknown>; total: number; at: number }

/** Référence unique d'un ticket (le serveur ne l'enregistre qu'une fois). */
const newRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 12)}`);
/**
 * Envoi d'un ticket : l'écran garde lui-même les tickets en attente (le
 * service worker ne les met pas dans sa file : un ticket ne doit exister qu'à
 * un endroit), et la référence du ticket sert de clé d'idempotence.
 */
const sendSale = (body: Record<string, unknown>) => apiSend("POST", "/api/comptoir/sales", body, { "X-Kanoo-Offline": "page", "Idempotency-Key": `sale-${body.clientRef}` });
/** Horodatage d'un ticket mis en attente (appelé au clic, jamais au rendu). */
const nowMs = () => Date.now();
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

/**
 * Caisse rapide (téléphone) : les articles en gros boutons, un ticket en
 * deux touches, le reçu par WhatsApp. En connexion faible, le ticket est mis
 * en attente sur le téléphone et renvoyé dès que le réseau revient ; sa
 * référence garantit qu'il n'est jamais enregistré deux fois.
 */
export default function QuickSalePage() {
  const [deskId, setDeskId] = useState("");
  const ready = useUrlReady(p => setDeskId(p.get("deskId") ?? ""));
  const [items, setItems] = useState<Item[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [cat, setCat] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [last, setLast] = useState<{ number: string; text: string } | null>(null);
  const qKey = `kanoo-quick-queue-${deskId}`, iKey = `kanoo-quick-items-${deskId}`;
  const pickDesk = useCallback((id: string) => { setDeskId(id); window.history.replaceState(null, "", `/comptoir/rapide?deskId=${id}`); }, []);

  // Articles : lus en ligne, sinon la dernière liste gardée sur le téléphone.
  useEffect(() => {
    if (!ready || !deskId) return;
    // File d'attente gardée sur le téléphone : lue une fois le comptoir connu.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture du stockage local, une fois
    setQueue(store.get<Pending[]>(qKey, []));
    apiJson(`/api/comptoir/items?deskId=${deskId}`).then(d => { const list = (d.data ?? []) as Item[]; setItems(list); store.set(iKey, list); })
      .catch(() => setItems(store.get<Item[]>(iKey, [])));
    // Promotions en cours : le prix affiché est celui que le serveur appliquera.
    apiJson(`/api/comptoir/promos?deskId=${deskId}`).then(d => { const list = ((d.data?.items ?? []) as Promo[]).filter(p => p.active !== false); setPromos(list); store.set(`${iKey}-promos`, list); })
      .catch(() => setPromos(store.get<Promo[]>(`${iKey}-promos`, [])));
  }, [ready, deskId, qKey, iKey]);

  // Renvoi des tickets en attente (au retour du réseau, et toutes les 30 s).
  const flush = useCallback(async () => {
    const pending = store.get<Pending[]>(qKey, []);
    if (!pending.length) return;
    const left: Pending[] = [];
    for (const p of pending) {
      const res = await sendSale(p.body);
      // Réseau absent, ou réponse d'un ancien service worker (« mis en file ») : on garde.
      if (res.status === 0 || res.data?.offline) { left.push(p); continue; }
      if (!res.ok) showToast(`Ticket en attente refusé : ${res.data?.error ?? "erreur"}`, "error");
    }
    store.set(qKey, left); setQueue(left);
    if (left.length < pending.length) showToast(`${pending.length - left.length} ticket(s) en attente envoyé(s).`, "success");
  }, [qKey]);
  useEffect(() => {
    if (!deskId) return;
    const t = setInterval(flush, 30_000);
    window.addEventListener("online", flush);
    return () => { clearInterval(t); window.removeEventListener("online", flush); };
  }, [deskId, flush]);

  const sellable = items.filter(i => (i.salePrice ?? 0) > 0);
  const cats = [...new Set(sellable.map(i => i.category).filter(Boolean))] as string[];
  const shown = cat ? sellable.filter(i => i.category === cat) : sellable;
  const lines = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ item: items.find(i => i._id === id)!, q })).filter(l => l.item), [cart, items]);
  const priceOf = useCallback((it: Item, q: number) => {
    const list = it.salePrice ?? 0;
    return bestPromoPrice(list, promos, { _id: it._id, category: it.category }, q, new Date())?.price ?? list;
  }, [promos]);
  const total = lines.reduce((t, l) => t + l.q * priceOf(l.item, l.q), 0);
  const add = (id: string, d: number) => setCart(c => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));

  function receiptText(number: string) {
    return [`Ticket ${number}`, ...lines.map(l => `${l.item.name} × ${l.q} : ${MONEY(l.q * priceOf(l.item, l.q))}`), `Total : ${MONEY(total)}`, "Merci de votre visite !"].join("\n");
  }

  async function pay(method: "cash" | "orange_money") {
    if (!lines.length || busy) return;
    const clientRef = newRef();
    // Montant fixé par le serveur (promotions comprises) : un seul moyen de paiement.
    const body = { deskId, clientRef, lines: lines.map(l => ({ itemId: l.item._id, quantity: l.q })), payMethod: method };
    setBusy(true);
    const res = await sendSale(body);
    setBusy(false);
    if (res.status === 0 || res.data?.offline || (res.ok && !res.data?.data?.sale)) {
      // Pas de réseau : le ticket attend sur le téléphone.
      const next = [...store.get<Pending[]>(qKey, []), { clientRef, body, total, at: nowMs() }];
      store.set(qKey, next); setQueue(next);
      setLast({ number: "en attente", text: receiptText("(en attente de réseau)") });
      setCart({});
      showToast("Pas de réseau : ticket gardé, il partira dès le retour de la connexion.", "warning");
      return;
    }
    if (!res.ok) { showToast(res.data?.error || "Ticket refusé.", "error"); return; }
    const sale = res.data.data.sale as { number: string; totalTTC: number; lines: Array<{ label: string; quantity: number; totalTTC: number }> };
    setLast({ number: sale.number, text: [`Ticket ${sale.number}`, ...sale.lines.map(l => `${l.label} × ${l.quantity} : ${MONEY(l.totalTTC)}`), `Total : ${MONEY(sale.totalTTC)}`, "Merci de votre visite !"].join("\n") });
    setCart({});
    setItems(it => it.map(i => (cart[i._id] && !i.recipe?.length ? { ...i, quantity: i.quantity - cart[i._id] } : i)));
  }

  if (!ready) return <PageLoading />;
  if (!deskId) return <DeskPicker onPick={pickDesk} />;
  return (
    <div className="max-w-xl mx-auto pb-72 sm:pb-48 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Link href="/comptoir" className="text-sm text-ink2 inline-flex items-center gap-1"><ArrowLeft size={14} /> Comptoir</Link>
        {queue.length > 0 && <button onClick={flush} className="text-xs px-2 py-1 rounded-full bg-warn-50 text-warn inline-flex items-center gap-1"><WifiOff size={12} /> {queue.length} en attente · renvoyer</button>}
      </div>
      {cats.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setCat("")} className={`px-3 h-9 rounded-full text-sm whitespace-nowrap border ${!cat ? "bg-section text-onink border-section" : "border-line2 text-ink2"}`}>Tout</button>
          {cats.map(c => <button key={c} onClick={() => setCat(c)} className={`px-3 h-9 rounded-full text-sm whitespace-nowrap border ${cat === c ? "bg-section text-onink border-section" : "border-line2 text-ink2"}`}>{c}</button>)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {shown.map(i => {
          const out = !i.recipe?.length && i.quantity <= (cart[i._id] ?? 0);
          return (
            <button key={i._id} disabled={out} onClick={() => add(i._id, 1)}
              className={`relative min-h-20 rounded-xl border p-2 text-left active:scale-95 transition ${cart[i._id] ? "border-section bg-section/10" : "border-line bg-surface"} ${out ? "opacity-40" : ""}`}>
              <span className="block text-sm font-semibold text-ink leading-tight">{i.name}</span>
              <span className="block text-xs text-ink2 mt-1">{priceOf(i, 1) < (i.salePrice ?? 0) ? <><s className="text-ink3">{MONEY(i.salePrice ?? 0)}</s> <b className="text-pos">{MONEY(priceOf(i, 1))}</b></> : MONEY(i.salePrice ?? 0)}</span>
              {cart[i._id] ? <span className="absolute top-1 right-1 min-w-6 h-6 px-1 rounded-full bg-section text-onink text-xs font-bold flex items-center justify-center">{cart[i._id]}</span> : null}
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-3 text-sm text-ink3">Aucun article avec un prix de vente.</p>}
      </div>

      {last && !lines.length && (
        <div className="surface-card p-3 text-sm space-y-2">
          <p className="font-semibold text-pos">Ticket {last.number} enregistré.</p>
          <div className="flex gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(last.text)}`} target="_blank" rel="noopener noreferrer" className="flex-1 h-11 rounded-lg border border-pos/30 text-pos inline-flex items-center justify-center gap-2"><MessageCircle size={16} /> Reçu WhatsApp</a>
            <button onClick={() => setLast(null)} className="flex-1 h-11 rounded-lg border border-line2 inline-flex items-center justify-center gap-2"><RotateCcw size={16} /> Nouveau</button>
          </div>
        </div>
      )}

      {/* Panier : au-dessus de la barre de navigation et de la bulle de l'assistant (téléphone). */}
      {lines.length > 0 && (
        <div className="fixed bottom-40 sm:bottom-24 inset-x-0 px-3 z-30">
          <div className="max-w-xl mx-auto surface-card p-3 shadow-lg space-y-2">
            <div className="max-h-32 overflow-y-auto divide-y divide-line">
              {lines.map(l => (
                <div key={l.item._id} className="flex items-center justify-between py-1 text-sm">
                  <span className="truncate pr-2">{l.item.name}</span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => add(l.item._id, -1)} className="w-8 h-8 rounded-full border border-line2 inline-flex items-center justify-center" aria-label="Moins"><Minus size={14} /></button>
                    <span className="w-6 text-center font-mono">{l.q}</span>
                    <button onClick={() => add(l.item._id, 1)} className="w-8 h-8 rounded-full border border-line2 inline-flex items-center justify-center" aria-label="Plus"><Plus size={14} /></button>
                    <span className="w-20 text-right font-mono">{MONEY(l.q * priceOf(l.item, l.q))}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-bold text-lg"><span>Total</span><span>{MONEY(total)}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => pay("cash")} className="h-14 rounded-xl bg-section text-onink font-semibold inline-flex items-center justify-center gap-2"><Banknote size={18} /> Espèces</button>
              <button disabled={busy} onClick={() => pay("orange_money")} className="h-14 rounded-xl bg-pos text-onink font-semibold inline-flex items-center justify-center gap-2"><Smartphone size={18} /> Mobile money</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Caisse rapide ouverte sans comptoir (lien direct, raccourci du téléphone) :
 * le choix du comptoir, ou le seul existant ouvert d'office — au lieu d'une
 * impasse « ouvrez-la depuis un comptoir ».
 */
function DeskPicker({ onPick }: { onPick: (id: string) => void }) {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }> | null>(null);
  useEffect(() => {
    apiJson("/api/comptoir/desks").then(d => {
      const list = (Array.isArray(d.data) ? d.data : d.data?.items ?? []) as Array<{ _id: string; name: string }>;
      if (list.length === 1) onPick(list[0]._id);
      else setDesks(list);
    });
  }, [onPick]);
  if (!desks) return <PageLoading />;
  return (
    <div className="max-w-md mx-auto space-y-3">
      <h1 className="page-title">Caisse rapide</h1>
      {desks.length === 0
        ? <p className="text-sm text-ink2">Aucun comptoir accessible. <Link href="/comptoir" className="text-section font-semibold">Créer ou ouvrir un comptoir</Link></p>
        : <>
            <p className="text-sm text-ink2">Choisissez le comptoir où vous vendez :</p>
            <div className="grid gap-2">
              {desks.map(d => (
                <button key={d._id} onClick={() => onPick(d._id)} className="surface-card px-4 h-14 text-left font-semibold text-ink hover:bg-surface2">{d.name}</button>
              ))}
            </div>
          </>}
    </div>
  );
}
