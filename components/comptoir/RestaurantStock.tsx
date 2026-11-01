"use client";
import { useEffect, useMemo, useState } from "react";
import { Warehouse, Store, ArrowUpFromLine, ArrowDownToLine, PackagePlus, AlertTriangle, CalendarClock, Settings2, Search, Trash2 } from "lucide-react";
import { LOSS_REASONS } from "@/lib/spot";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { BarcodeScanner, beep } from "@/components/shared/BarcodeScanner";
import { matchCode } from "@/lib/barcodes";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const QTY = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
/** Nombre saisi à la française : virgule décimale, espaces de milliers. NaN si vide ou invalide. */
const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };

export interface StockRow {
  itemId: string; name: string; unit: string; category?: string; barcode?: string; packBarcode?: string; altBarcodes?: string[]; rhythm?: string; linked: boolean; preparation: boolean;
  pack: { label?: string; size?: number } | null;
  desk: number; reserve: number; total: number; unitCost: number | null; value: number | null;
  threshold?: number; reserveThreshold?: number; lowDesk: boolean; lowReserve: boolean;
  nextExpiry: string | null; expiringQty: number; expiredQty: number; suggestion: number;
}
export interface ReserveData { reserveId: string; rows: StockRow[]; totals: { desk: number | null; reserve: number | null }; moves: Array<{ _id: string; name: string; unit: string; type: string; quantity: number; quantityAfter: number; unitCost?: number; reason: string; createdAt: string }> }

/** « 3 cartons + 4 » : une quantité en unités lue en paquets quand l'article en a. */
export function inPacks(qty: number, r: Pick<StockRow, "pack" | "unit">) {
  if (!r.pack?.size || qty < r.pack.size) return `${QTY(qty)} ${r.unit}`;
  const p = Math.floor(qty / r.pack.size), rest = Math.round((qty - p * r.pack.size) * 1000) / 1000;
  return `${p} ${r.pack.label || "paquet"}${p > 1 && !r.pack.label ? "s" : ""}${rest ? ` + ${QTY(rest)}` : ""} (${QTY(qty)} ${r.unit})`;
}

/**
 * Stock du restaurant aux deux niveaux : la RÉSERVE (stock en gros) et le
 * COMPTOIR (stock de vente), avec ce qu'il faut monter de la réserve, les
 * seuils et les péremptions proches.
 */
export function StockLevels({ data, costs, onReceive, onMove, onEdit, onLoss }: {
  data: ReserveData; costs: boolean;
  onReceive: (rows?: StockRow[]) => void; onMove: (dir: "supply" | "return", rows?: StockRow[]) => void; onEdit: (r: StockRow) => void; onLoss: (rows?: StockRow[]) => void;
}) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "alerts">("all");
  const stockRows = data.rows.filter(r => !r.preparation);
  const toSupply = stockRows.filter(r => r.suggestion > 0);
  const alerts = stockRows.filter(r => r.lowDesk || r.lowReserve || r.expiringQty > 0 || r.expiredQty > 0);
  const shown = stockRows.filter(r => (only === "all" || alerts.includes(r)) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.barcode === q));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="surface-card p-3"><p className="text-xs text-ink2 flex items-center gap-1"><Warehouse size={13} /> Réserve (en gros)</p><p className="text-lg font-semibold font-mono">{costs ? MONEY(data.totals.reserve) : `${stockRows.filter(r => r.reserve > 0).length} article(s)`}</p></div>
        <div className="surface-card p-3"><p className="text-xs text-ink2 flex items-center gap-1"><Store size={13} /> Comptoir (vente)</p><p className="text-lg font-semibold font-mono">{costs ? MONEY(data.totals.desk) : `${stockRows.filter(r => r.desk > 0).length} article(s)`}</p></div>
        <div className="surface-card p-3"><p className="text-xs text-ink2 flex items-center gap-1"><AlertTriangle size={13} /> À surveiller</p><p className="text-lg font-semibold">{alerts.length} article(s)</p><p className="text-[11px] text-ink3">{toSupply.length} à monter au comptoir</p></div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[12rem]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" /><input className={`${inputCls} pl-9`} placeholder="Chercher un article ou un code-barres" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select className={`${selectCls} w-auto`} value={only} onChange={e => setOnly(e.target.value as typeof only)}><option value="all">Tous les articles</option><option value="alerts">Alertes seulement</option></select>
        <button onClick={() => onReceive()} className={buttonClass("secondary", "md")}><PackagePlus size={15} /> Réception en réserve</button>
        <button onClick={() => onMove("supply", toSupply.length ? toSupply : undefined)} className={buttonClass("primary", "md")}><ArrowUpFromLine size={15} /> Approvisionner le comptoir{toSupply.length ? ` (${toSupply.length})` : ""}</button>
        <button onClick={() => onMove("return")} className={buttonClass("ghost", "md")}><ArrowDownToLine size={15} /> Retour en réserve</button>
        <button onClick={() => onLoss(stockRows.filter(r => r.expiredQty > 0).length ? stockRows.filter(r => r.expiredQty > 0) : undefined)} className={buttonClass("ghost", "md")}><Trash2 size={15} /> Perte en réserve</button>
      </div>
      {/* Téléphone : une carte par article, trois gestes. */}
      <ul className="sm:hidden space-y-2">
        {shown.map(r => (
          <li key={r.itemId} className="surface-card p-3 space-y-1.5">
            <p className="font-semibold text-ink">{r.name}{(r.lowDesk || r.lowReserve) && <span className="ml-2"><Pill tone="warn">seuil</Pill></span>}</p>
            <p className="text-sm text-ink2">Réserve : <span className="font-mono">{inPacks(r.reserve, r)}</span></p>
            <p className="text-sm text-ink2">Comptoir : <span className="font-mono">{inPacks(r.desk, r)}</span>{r.suggestion > 0 && <span className="text-section"> · monter {inPacks(r.suggestion, r)}</span>}</p>
            <p className="text-xs"><Expiry r={r} /></p>
            <div className="flex gap-2 pt-1">
              {r.reserve > 0 && <button onClick={() => onMove("supply", [r])} className={buttonClass("primary", "sm")}><ArrowUpFromLine size={14} /> Monter</button>}
              <button onClick={() => onReceive([r])} className={buttonClass("secondary", "sm")}><PackagePlus size={14} /> Recevoir</button>
              <button onClick={() => onEdit(r)} className={buttonClass("ghost", "sm")} aria-label="Réglages"><Settings2 size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
      <div className="surface-card overflow-hidden hidden sm:block"><div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr><th>Article</th><th className="text-right">Réserve</th><th className="text-right">Comptoir</th>{costs && <><th className="text-right">Coût unit.</th><th className="text-right">Valeur</th></>}<th>Péremption</th><th></th></tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.itemId} className="border-t border-line">
                <td className="text-ink font-medium">{r.name}
                  <span className="block text-[11px] text-ink3 font-normal">{[r.category, r.pack?.size ? `${r.pack.label || "paquet"} de ${r.pack.size}` : null, r.barcode ? `code ${r.barcode}` : null].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="text-right font-mono text-sm">{inPacks(r.reserve, r)}{r.lowReserve && <span className="block"><Pill tone="warn">seuil réserve</Pill></span>}</td>
                <td className="text-right font-mono text-sm">{inPacks(r.desk, r)}{r.lowDesk && <span className="block"><Pill tone="warn">seuil</Pill></span>}{r.suggestion > 0 && <span className="block text-[11px] text-section">monter {inPacks(r.suggestion, r)}</span>}</td>
                {costs && <><td className="text-right font-mono text-ink2">{MONEY(r.unitCost)}</td><td className="text-right font-mono font-semibold">{MONEY(r.value)}</td></>}
                <td className="text-sm"><Expiry r={r} /></td>
                <td className="text-right whitespace-nowrap">
                  {r.reserve > 0 && <button onClick={() => onMove("supply", [r])} className={buttonClass("ghost", "sm")} title="Monter au comptoir"><ArrowUpFromLine size={14} /></button>}
                  <button onClick={() => onReceive([r])} className={buttonClass("ghost", "sm")} title="Réception en réserve"><PackagePlus size={14} /></button>
                  <button onClick={() => onEdit(r)} className={buttonClass("ghost", "sm")} title="Code-barres, seuils"><Settings2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {data.rows.some(r => r.preparation) && <p className="text-xs text-ink3">Les préparations (plats, boissons maison) n&apos;ont pas de stock propre : leurs ingrédients sortent du comptoir à chaque vente.</p>}
    </div>
  );
}

function Expiry({ r }: { r: StockRow }) {
  if (!r.nextExpiry) return <>—</>;
  return (
    <span className={r.expiredQty > 0 || r.expiringQty > 0 ? "text-neg font-semibold" : "text-ink2"}>
      <CalendarClock size={12} className="inline mr-1" />{new Date(r.nextExpiry).toLocaleDateString("fr-FR")}
      {r.expiredQty > 0 ? ` — ${QTY(r.expiredQty)} périmé(s), à sortir` : r.expiringQty > 0 ? ` (${QTY(r.expiringQty)} sous 7 j)` : ""}
    </span>
  );
}

type Line = { itemId: string; packs: string; quantity: string; cost: string; lotNumber: string; expiryDate: string; refused?: boolean; reason?: string };
const emptyLine = (r: StockRow): Line => ({ itemId: r.itemId, packs: "", quantity: "", cost: "", lotNumber: "", expiryDate: "" });

/** Réception en réserve : on scanne ou choisit les articles, quantités en paquets ou en unités, prix d'achat, lot et péremption. */
export function ReceiveDialog({ deskId, rows, initial, costs, onClose, onDone }: { deskId: string; rows: StockRow[]; initial?: StockRow[]; costs: boolean; onClose: () => void; onDone: () => void }) {
  const stock = rows.filter(r => !r.preparation);
  const [lines, setLines] = useState<Line[]>(() => (initial ?? []).map(emptyLine));
  const [supplier, setSupplier] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string }>>([]);
  useEffect(() => { apiJson("/api/suppliers?limit=500").then(d => setSuppliers(Array.isArray(d.data) ? d.data : d.data?.items ?? [])).catch(() => {}); }, []);
  const [reference, setReference] = useState("");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  // Contrôle à réception (HACCP) : conservation, température, emballages, dates ; refus ligne par ligne.
  const [ctl, setCtl] = useState({ chain: "ambient", temperature: "", packagingOk: true, datesOk: true });
  const byId = useMemo(() => new Map(stock.map(r => [r.itemId, r])), [stock]);
  const add = (r: StockRow) => setLines(ls => ls.some(l => l.itemId === r.itemId) ? ls : [...ls, emptyLine(r)]);
  const setRefused = (i: number, refused: boolean, reason = "") => setLines(ls => ls.map((l, j) => j === i ? { ...l, refused, reason } : l));
  const set = (i: number, k: keyof Line, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const total = lines.filter(l => !l.refused).reduce((t, l) => {
    const r = byId.get(l.itemId); const packs = num(l.packs) || 0, qty = num(l.quantity) || 0, cost = num(l.cost) || 0;
    return t + (packs && r?.pack?.size ? packs * cost : qty * cost);
  }, 0);

  async function save() {
    const bad = lines.find(l => (l.packs.trim() && !(num(l.packs) > 0)) || (l.quantity.trim() && !(num(l.quantity) > 0)) || (l.cost.trim() && !(num(l.cost) >= 0)));
    if (bad) return showToast(`${byId.get(bad.itemId)?.name ?? "Article"} : quantité ou prix invalide.`, "error");
    const payload = lines.filter(l => num(l.packs) > 0 || num(l.quantity) > 0).map(l => {
      const r = byId.get(l.itemId); const byPack = num(l.packs) > 0 && !!r?.pack?.size;
      return { itemId: l.itemId, ...(byPack ? { packs: num(l.packs) } : { quantity: num(l.quantity) }),
        ...(costs && l.cost.trim() !== "" ? (byPack ? { packCost: num(l.cost) } : { unitCost: num(l.cost) }) : {}),
        ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}), ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
        ...(l.refused ? { refused: true, reason: l.reason ?? "" } : {}) };
    });
    if (lines.some(l => l.refused && !(l.reason ?? "").trim())) return showToast("Indiquez le motif de chaque refus.", "error");
    if (ctl.chain !== "ambient" && ctl.temperature.trim() === "") return showToast("Produit frais ou surgelé : relevez sa température.", "error");
    if (!payload.length) return showToast("Saisissez au moins une quantité.", "error");
    setBusy(true);
    const r = await apiSend<{ data: { total: number; unvalued: number; alerts: Array<{ name: string; pct: number; dishes: string[] }> }; error?: string }>("POST", "/api/comptoir/reserve", { deskId, action: "receive", lines: payload, supplier, ...(supplierId ? { supplierId } : {}), reference, paidFromCash: paid,
      control: { chain: ctl.chain, temperature: ctl.temperature.trim() === "" ? null : num(ctl.temperature), packagingOk: ctl.packagingOk, datesOk: ctl.datesOk } });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Réception refusée", "error");
    const refusedN = lines.filter(l => l.refused).length;
    if (refusedN === payload.length) { showToast(`${refusedN} ligne(s) refusée(s) : rien n'entre en stock, le refus est noté au registre d'hygiène.`, "info"); onDone(); return; }
    const a = r.data.data.alerts;
    const unv = r.data.data.unvalued ? ` ${r.data.data.unvalued} ligne(s) sans prix : à valoriser par le chef ou la comptabilité.` : "";
    showToast(a.length ? `Réception enregistrée. Hausse de coût : ${a.map(x => `${x.name} +${x.pct} %${x.dishes.length ? ` (${x.dishes.join(", ")})` : ""}`).join(" ; ")}.${unv}` : `Réception enregistrée en réserve.${unv}`, a.length || unv ? "info" : "success");
    onDone();
  }

  return (
    <Modal open onClose={onClose} size="xl" title="Réception en réserve" description="Achat au marché ou livraison sans bon de commande. Une commande passée depuis le comptoir entre en réserve à sa réception (Achats → Commandes)."
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy} onClick={save} className={buttonClass("primary", "md")}>Enregistrer{costs && total ? ` (${MONEY(total)})` : ""}</button></>}>
      <div className="space-y-3">
        <BarcodeScanner placeholder="Scanner l'article reçu (unité ou carton) ou taper son nom, puis Entrée" onCode={code => {
          const m = matchCode(stock, code);
          beep(!!m);
          if (!m) return showToast(`« ${code} » : article inconnu (attribuez le code dans les réglages de l'article).`, "error");
          // Code du carton : chaque lecture ajoute un carton.
          if (m.pack && m.row.pack?.size) setLines(ls => ls.some(l => l.itemId === m.row.itemId) ? ls.map(l => l.itemId === m.row.itemId ? { ...l, packs: String((num(l.packs) || 0) + 1) } : l) : [...ls, { ...emptyLine(m.row), packs: "1" }]);
          else add(m.row);
        }} />
        <select className={selectCls} value="" onChange={e => { const r = byId.get(e.target.value); if (r) add(r); }}>
          <option value="">Ajouter un article…</option>
          {stock.filter(r => !lines.some(l => l.itemId === r.itemId)).map(r => <option key={r.itemId} value={r.itemId}>{r.name}</option>)}
        </select>
        {lines.length > 0 && (
          <div className="overflow-x-auto"><table className="table-dense w-full">
            <thead><tr><th>Article</th><th>Paquets</th><th>ou unités</th>{costs && <th>Prix d&apos;achat</th>}<th>Lot</th><th>Péremption</th><th>Refus</th><th></th></tr></thead>
            <tbody>{lines.map((l, i) => { const r = byId.get(l.itemId)!; return (
              <tr key={l.itemId} className="border-t border-line">
                <td>{r.name}<span className="block text-[11px] text-ink3">{r.pack?.size ? `${r.pack.label || "paquet"} de ${r.pack.size} ${r.unit}` : r.unit}</span></td>
                <td>{r.pack?.size ? <input className={`${inputCls} w-20`} inputMode="decimal" value={l.packs} onChange={e => set(i, "packs", e.target.value)} /> : <span className="text-ink3 text-xs">—</span>}</td>
                <td><input className={`${inputCls} w-24`} inputMode="decimal" value={l.quantity} disabled={num(l.packs) > 0} onChange={e => set(i, "quantity", e.target.value)} /></td>
                {costs && <td><input className={`${inputCls} w-28`} inputMode="decimal" placeholder={num(l.packs) > 0 ? "TTC par paquet" : "TTC par unité"} value={l.cost} onChange={e => set(i, "cost", e.target.value)} /></td>}
                <td><input className={`${inputCls} w-28`} value={l.lotNumber} onChange={e => set(i, "lotNumber", e.target.value)} /></td>
                <td><input type="date" className={`${inputCls} w-36`} value={l.expiryDate} onChange={e => set(i, "expiryDate", e.target.value)} /></td>
                <td>
                  <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={!!l.refused} onChange={e => setRefused(i, e.target.checked)} /> refusé</label>
                  {l.refused && <input className={`${inputCls} w-40 mt-1`} placeholder="Motif (température, état…)" value={l.reason ?? ""} onChange={e => setRefused(i, true, e.target.value)} />}
                </td>
                <td><button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className={buttonClass("ghost", "sm")}>Retirer</button></td>
              </tr>); })}</tbody>
          </table></div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Fournisseur">
            {suppliers.length > 0 && <select className={selectCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Hors référentiel (marché…)</option>{suppliers.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}</select>}
            {!supplierId && <input className={`${inputCls} ${suppliers.length ? "mt-1" : ""}`} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Marché de Katako, vendeur…" />}
          </FormField>
          <FormField label="Référence (bon, reçu)"><input className={inputCls} value={reference} onChange={e => setReference(e.target.value)} /></FormField>
        </div>
        <fieldset className="border border-line rounded-lg p-3 space-y-2">
          <legend className="text-sm font-semibold px-1">Contrôle à réception</legend>
          <div className="flex gap-3 flex-wrap items-end">
            <FormField label="Conservation"><select className={selectCls} value={ctl.chain} onChange={e => setCtl(c => ({ ...c, chain: e.target.value }))}>
              <option value="ambient">Ambiante (sec, conserves)</option><option value="chilled">Réfrigéré (repère : +4 °C au plus)</option><option value="frozen">Surgelé (repère : −18 °C au plus)</option>
            </select></FormField>
            {ctl.chain !== "ambient" && <FormField label="Température relevée (°C)"><input className={`${inputCls} w-28`} inputMode="decimal" value={ctl.temperature} onChange={e => setCtl(c => ({ ...c, temperature: e.target.value }))} /></FormField>}
            <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={ctl.packagingOk} onChange={e => setCtl(c => ({ ...c, packagingOk: e.target.checked }))} /> Emballages intacts, produits propres</label>
            <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={ctl.datesOk} onChange={e => setCtl(c => ({ ...c, datesOk: e.target.checked }))} /> Dates limites conformes</label>
          </div>
          <p className="text-[11px] text-ink3">Noté au registre d&apos;hygiène (Restauration → Hygiène). Une ligne refusée n&apos;entre pas en stock. Repères usuels, à adapter au plan HACCP de l&apos;établissement.</p>
        </fieldset>
        {costs && <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> Payé en espèces depuis la caisse du comptoir (sortie de caisse et écriture d&apos;achat passées avec la réception)</label>}
        <p className="text-xs text-ink3">Prix d&apos;achat payé (TTC, sans TVA récupérée). Le lot et la date de péremption sont gardés : les sorties prennent le lot le plus proche de sa péremption, un lot périmé reste en réserve. Un article non relié au catalogue l&apos;est automatiquement, au taux de TVA du comptoir.</p>
      </div>
    </Modal>
  );
}

/** Monter des articles de la réserve au comptoir, ou les y redescendre. */
export function LevelMoveDialog({ deskId, rows, direction, initial, onClose, onDone }: { deskId: string; rows: StockRow[]; direction: "supply" | "return"; initial?: StockRow[]; onClose: () => void; onDone: () => void }) {
  const stock = rows.filter(r => !r.preparation && (direction === "supply" ? r.reserve > 0 : r.desk > 0));
  const [qty, setQty] = useState<Record<string, { packs: string; units: string }>>(() => Object.fromEntries((initial ?? []).map(r => {
    const s = direction === "supply" ? r.suggestion : 0;
    return [r.itemId, r.pack?.size && s && s % r.pack.size === 0 ? { packs: String(s / r.pack.size), units: "" } : { packs: "", units: s ? String(s) : "" }];
  })));
  const [busy, setBusy] = useState(false);
  const chosen = stock.filter(r => r.itemId in qty);
  async function save() {
    const lines = chosen.map(r => ({ r, q: qty[r.itemId] })).filter(x => num(x.q.packs) > 0 || num(x.q.units) > 0)
      .map(x => num(x.q.packs) > 0 && x.r.pack?.size ? { itemId: x.r.itemId, packs: num(x.q.packs) } : { itemId: x.r.itemId, quantity: num(x.q.units) });
    if (!lines.length) return showToast("Saisissez au moins une quantité.", "error");
    setBusy(true);
    const r = await apiSend<{ data: { reference: string }; error?: string }>("POST", "/api/comptoir/reserve", { deskId, action: direction, lines });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Mouvement refusé", "error");
    showToast(`${direction === "supply" ? "Comptoir approvisionné" : "Retour en réserve enregistré"} (${r.data.data.reference})`, "success");
    onDone();
  }
  return (
    <Modal open onClose={onClose} size="lg" title={direction === "supply" ? "Approvisionner le comptoir depuis la réserve" : "Retour du comptoir en réserve"}
      description={direction === "supply" ? "Les lots les plus proches de leur péremption sortent les premiers." : "Invendus ou surplus redescendus en réserve."}
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy} onClick={save} className={buttonClass("primary", "md")}>Valider</button></>}>
      <div className="space-y-3">
        <BarcodeScanner placeholder="Scanner (unité ou carton) ou taper un article, puis Entrée" onCode={code => {
          const m = matchCode(stock, code);
          beep(!!m);
          if (!m) return;
          const id = m.row.itemId;
          // Code du carton : chaque lecture ajoute un carton ; code de l'unité : une unité de plus si l'article est déjà choisi.
          if (m.pack && m.row.pack?.size) setQty(q => ({ ...q, [id]: { packs: String((num(q[id]?.packs ?? "") || 0) + 1), units: "" } }));
          else setQty(q => id in q ? (num(q[id].packs) > 0 ? q : { ...q, [id]: { packs: "", units: String((num(q[id].units) || 0) + 1) } }) : { ...q, [id]: { packs: "", units: "" } });
        }} />
        <select className={selectCls} value="" onChange={e => e.target.value && setQty(q => ({ ...q, [e.target.value]: { packs: "", units: "" } }))}>
          <option value="">Ajouter un article…</option>
          {stock.filter(r => !(r.itemId in qty)).map(r => <option key={r.itemId} value={r.itemId}>{r.name} — {direction === "supply" ? `réserve ${inPacks(r.reserve, r)}` : `comptoir ${inPacks(r.desk, r)}`}</option>)}
        </select>
        {chosen.length > 0 && (
          <table className="table-dense w-full">
            <thead><tr><th>Article</th><th className="text-right">Disponible</th><th>Paquets</th><th>ou unités</th></tr></thead>
            <tbody>{chosen.map(r => (
              <tr key={r.itemId} className="border-t border-line">
                <td>{r.name}</td>
                <td className="text-right font-mono text-sm">{inPacks(direction === "supply" ? r.reserve : r.desk, r)}</td>
                <td>{r.pack?.size ? <input className={`${inputCls} w-20`} inputMode="decimal" value={qty[r.itemId].packs} onChange={e => setQty(q => ({ ...q, [r.itemId]: { ...q[r.itemId], packs: e.target.value } }))} /> : "—"}</td>
                <td><input className={`${inputCls} w-24`} inputMode="decimal" disabled={num(qty[r.itemId].packs) > 0} value={qty[r.itemId].units} onChange={e => setQty(q => ({ ...q, [r.itemId]: { ...q[r.itemId], units: e.target.value } }))} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

/** Réglages de stock d'un article : code-barres et seuils des deux niveaux. */
export function StockItemDialog({ row, onClose, onDone }: { row: StockRow; onClose: () => void; onDone: () => void }) {
  const [barcode, setBarcode] = useState(row.barcode ?? "");
  const [packBarcode, setPackBarcode] = useState(row.packBarcode ?? "");
  const [alt, setAlt] = useState<string[]>(row.altBarcodes ?? []);
  const [rhythm, setRhythm] = useState(row.rhythm ?? "");
  const [threshold, setThreshold] = useState(row.threshold != null ? String(row.threshold) : "");
  const [reserveThreshold, setReserveThreshold] = useState(row.reserveThreshold != null ? String(row.reserveThreshold) : "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("PATCH", `/api/comptoir/items/${row.itemId}`, {
      barcode, packBarcode, altBarcodes: alt, rhythm, ...(threshold !== "" ? { threshold: Number(threshold) } : {}), ...(reserveThreshold !== "" ? { reserveThreshold: Number(reserveThreshold) } : {}),
    });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Enregistrement refusé", "error");
    showToast("Article mis à jour", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={row.name} description="Codes-barres lus au scanner (unité, carton, autres étiquettes), seuils d'alerte du comptoir et de la réserve."
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button></>}>
      <div className="space-y-3">
        <FormField label="Code-barres de l'unité"><BarcodeScanner placeholder="Scanner l'article ou taper son code" onCode={c => { beep(true); setBarcode(c); }} /></FormField>
        {barcode && <p className="text-sm">Code retenu : <span className="font-mono">{barcode}</span> <button onClick={() => setBarcode("")} className="text-xs text-ink3 underline">effacer</button></p>}
        {row.pack?.size ? <>
          <FormField label={`Code-barres du ${row.pack.label || "carton"} (${row.pack.size} ${row.unit})`}><BarcodeScanner placeholder="Scanner le carton" onCode={c => { beep(true); setPackBarcode(c); }} /></FormField>
          {packBarcode && <p className="text-sm">Carton : <span className="font-mono">{packBarcode}</span> <button onClick={() => setPackBarcode("")} className="text-xs text-ink3 underline">effacer</button></p>}
        </> : <p className="text-xs text-ink3">Pas de conditionnement en carton déclaré : le code du carton se règle avec le paquet de l&apos;article.</p>}
        <FormField label="Autres codes de l'unité (autre fournisseur, autre étiquette)"><BarcodeScanner placeholder="Scanner un autre code" onCode={c => { beep(true); setAlt(a => a.includes(c) || a.length >= 10 ? a : [...a, c]); }} /></FormField>
        {alt.length > 0 && <p className="text-sm flex flex-wrap gap-2">{alt.map(c => <span key={c} className="font-mono">{c} <button onClick={() => setAlt(a => a.filter(x => x !== c))} className="text-xs text-ink3 underline">retirer</button></span>)}</p>}
        <FormField label="Rythme (comptage du samedi et durée du réassort)" hint="Légumes et pain : chaque semaine ; huile, sucre : toutes les deux semaines ; riz, conserves, gaz : chaque mois (compté la première semaine du mois).">
          <select className={selectCls} value={rhythm} onChange={e => setRhythm(e.target.value)}>
            <option value="">Chaque semaine (par défaut)</option>
            <option value="week">Chaque semaine — réassort pour 7 jours</option>
            <option value="fortnight">Toutes les deux semaines — réassort pour 14 jours</option>
            <option value="month">Chaque mois — réassort pour 30 jours</option>
          </select>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={`Seuil du comptoir (${row.unit})`}><input className={inputCls} inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} /></FormField>
          <FormField label={`Seuil de la réserve (${row.unit})`}><input className={inputCls} inputMode="decimal" value={reserveThreshold} onChange={e => setReserveThreshold(e.target.value)} /></FormField>
        </div>
        <p className="text-xs text-ink3">Sous le seuil du comptoir, l&apos;article est proposé à « Approvisionner le comptoir » ; sous celui de la réserve, il entre dans le réassort fournisseur.</p>
      </div>
    </Modal>
  );
}

/** Perte constatée en réserve (carton périmé, sac abîmé) : sortie de la réserve, lots les plus proches de la péremption d'abord. */
export function ReserveLossDialog({ deskId, rows, initial, onClose, onDone }: { deskId: string; rows: StockRow[]; initial?: StockRow[]; onClose: () => void; onDone: () => void }) {
  const stock = rows.filter(r => !r.preparation && r.reserve > 0);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries((initial ?? []).map(r => [r.itemId, r.expiredQty ? String(r.expiredQty) : ""])));
  const [reason, setReason] = useState(initial?.length ? "expired" : "broken");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = stock.filter(r => r.itemId in qty);
  async function save() {
    const lines = chosen.filter(r => num(qty[r.itemId]) > 0).map(r => ({ itemId: r.itemId, quantity: num(qty[r.itemId]) }));
    if (!lines.length) return showToast("Saisissez au moins une quantité.", "error");
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/comptoir/reserve", { deskId, action: "loss", lines, reason, note });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Perte refusée", "error");
    showToast("Perte en réserve enregistrée", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Perte en réserve" description="Sortie du stock en gros, comptée dans les pertes du comptoir au coût."
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button></>}>
      <div className="space-y-3">
        <FormField label="Motif"><select className={selectCls} value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(LOSS_REASONS).filter(([k]) => k !== "inventory").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        <select className={selectCls} value="" onChange={e => e.target.value && setQty(q => ({ ...q, [e.target.value]: "" }))}>
          <option value="">Ajouter un article…</option>
          {stock.filter(r => !(r.itemId in qty)).map(r => <option key={r.itemId} value={r.itemId}>{r.name} — réserve {inPacks(r.reserve, r)}</option>)}
        </select>
        {chosen.map(r => (
          <div key={r.itemId} className="flex items-center gap-2"><span className="flex-1 text-sm">{r.name}{r.expiredQty ? <span className="block text-[11px] text-neg">{QTY(r.expiredQty)} périmé(s)</span> : null}</span>
            <input className={`${inputCls} w-28`} inputMode="decimal" placeholder={r.unit} value={qty[r.itemId]} onChange={e => setQty(q => ({ ...q, [r.itemId]: e.target.value }))} /></div>
        ))}
        <FormField label="Précision (facultative)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}
