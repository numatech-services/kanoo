"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ScanBarcode, Warehouse, Store, CheckCircle2, XCircle, CloudOff, Save } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { BarcodeScanner, beep } from "@/components/shared/BarcodeScanner";
import { matchCode } from "@/lib/barcodes";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const QTY = (n?: number | null) => (n === undefined || n === null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: 3 }));

interface InvLine { itemId: string; name: string; unit: string; barcode?: string; packBarcode?: string; altBarcodes?: string[]; packSize?: number; parts?: Array<{ device: string; qty: number }>; counted?: number; expected?: number; gap?: number; unitCost?: number; gapValue?: number }
interface Gap { itemId: string; name: string; unit: string; expected: number; counted: number; gap: number; value: number }
const GAP_REASONS = ["Erreur de comptage (recompté)", "Casse ou perte non déclarée", "Erreur de réception", "Erreur de caisse", "Consommation non saisie", "Inexpliqué"];
interface Inv { _id: string; number: string; level: "desk" | "reserve"; status: "open" | "validated" | "cancelled"; category?: string; createdAt: string; validatedAt?: string; gapValue?: number; lines?: InvLine[] }
const LEVEL = { desk: "Comptoir", reserve: "Réserve" } as const;
const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };

/** Identifiant de cet appareil : chaque appareil compte son sous-total, le serveur les additionne. */
function deviceId(): string {
  try {
    let d = localStorage.getItem("kanoo:device");
    if (!d) { d = `d-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; localStorage.setItem("kanoo:device", d); }
    return d;
  } catch { return "web"; }
}
/** Comptages de CET appareil en attente d'envoi, gardés dans le navigateur : rien n'est perdu si le réseau tombe. */
const queueKey = (id: string) => `kanoo:inventory:${id}:${deviceId()}`;
function readQueue(id: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(queueKey(id)) || "{}"); } catch { return {}; }
}
function writeQueue(id: string, q: Record<string, number>) {
  try { if (Object.keys(q).length) localStorage.setItem(queueKey(id), JSON.stringify(q)); else localStorage.removeItem(queueKey(id)); } catch { /* stockage indisponible */ }
}

/**
 * Inventaires du comptoir et de la réserve : on ouvre un inventaire, on
 * scanne (douchette ou caméra) ou on cherche chaque article et on saisit ce
 * qu'on compte. La validation (chef du comptoir, finance) passe les écarts
 * en stock et les chiffre au coût.
 */
export function InventoryPanel({ deskId, costs, categories, onChange }: { deskId: string; costs: boolean; categories: string[]; onChange: () => void }) {
  const { data: list, reload } = useApi<Inv[]>(`/api/comptoir/inventory?deskId=${deskId}`, d => (d?.data as Inv[]) ?? [], []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [start, setStart] = useState<"desk" | "reserve" | null>(null);
  const [category, setCategory] = useState("");
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = list.filter(i => i.status === "open");

  async function create() {
    if (!start) return;
    setBusy(true);
    const r = await apiSend<{ data: Inv; error?: string }>("POST", "/api/comptoir/inventory", { deskId, level: start, ...(category ? { category } : {}), ...(opening ? { opening: true } : {}) });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Ouverture impossible", "error");
    setStart(null); setCategory(""); setOpening(false); reload(); setOpenId(r.data.data._id);
  }

  return (
    <section className="surface-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink flex items-center gap-2"><ClipboardCheck size={17} /> Inventaires au scanner</h3>
        <div className="flex gap-2">
          <button onClick={() => setStart("desk")} className={buttonClass("secondary", "sm")}><Store size={14} /> Inventaire du comptoir</button>
          <button onClick={() => setStart("reserve")} className={buttonClass("secondary", "sm")}><Warehouse size={14} /> Inventaire de la réserve</button>
        </div>
      </div>
      {open.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {open.map(i => (
            <button key={i._id} onClick={() => setOpenId(i._id)} className={buttonClass("primary", "sm")}><ScanBarcode size={14} /> Reprendre {i.number} ({LEVEL[i.level]}{i.category ? ` · ${i.category}` : ""})</button>
          ))}
        </div>
      )}
      {list.filter(i => i.status !== "open").length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Inventaire</th><th>Niveau</th><th>Date</th><th>État</th>{costs && <th className="text-right">Écart au coût</th>}<th></th></tr></thead>
            <tbody>
              {list.filter(i => i.status !== "open").slice(0, 8).map(i => (
                <tr key={i._id} className="border-t border-line">
                  <td className="font-mono text-xs">{i.number}{i.category ? <span className="block text-[11px] text-ink3 font-sans">{i.category}</span> : null}</td>
                  <td>{LEVEL[i.level]}</td>
                  <td className="text-ink2">{new Date(i.validatedAt ?? i.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td>{i.status === "validated" ? <Pill tone="pos">validé</Pill> : <Pill tone="mute">annulé</Pill>}</td>
                  {costs && <td className={`text-right font-mono ${(i.gapValue ?? 0) < 0 ? "text-neg" : ""}`}>{i.status === "validated" ? MONEY(i.gapValue) : "—"}</td>}
                  <td className="text-right">{i.status === "validated" && <button onClick={() => setOpenId(i._id)} className={buttonClass("ghost", "sm")}>Détail</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!list.length && <p className="text-sm text-ink3">Aucun inventaire. Un inventaire se fait de préférence comptoir fermé ; la réserve peut se compter à tout moment.</p>}

      <Modal open={!!start} onClose={() => setStart(null)} title={start === "reserve" ? "Inventaire de la réserve" : "Inventaire du comptoir"}
        description="Tous les articles à compter, ou une seule famille pour un inventaire tournant."
        footer={<><button onClick={() => setStart(null)} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy} onClick={create} className={buttonClass("primary", "md")}>Commencer</button></>}>
        <FormField label="Famille (facultative)">
          <select className={selectCls} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Tous les articles</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormField>
        {costs && <label className="mt-3 inline-flex items-start gap-2 text-sm text-ink2"><input type="checkbox" className="mt-1" checked={opening} onChange={e => setOpening(e.target.checked)} /> Stock initial : première saisie du stock existant (les écarts constituent le stock, sans gain ni perte dans le résultat)</label>}
      </Modal>
      {openId && <CountScreen id={openId} costs={costs} onClose={() => { setOpenId(null); reload(); }} onValidated={() => { reload(); onChange(); }} />}
    </section>
  );
}

function CountScreen({ id, costs, onClose, onValidated }: { id: string; costs: boolean; onClose: () => void; onValidated: () => void }) {
  const { data: inv, reload } = useApi<Inv | null>(`/api/comptoir/inventory?id=${id}`, d => (d?.data as Inv) ?? null, null);
  const device = useMemo(() => deviceId(), []);
  const [pending, setPending] = useState<Record<string, number>>(() => readQueue(id));
  const [current, setCurrent] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [packs, setPacks] = useState("");
  const [plusOne, setPlusOne] = useState(false);
  const [filter, setFilter] = useState<"todo" | "all" | "gaps">("todo");
  const [unknown, setUnknown] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [review, setReview] = useState<Gap[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const reviewed = useRef(false);
  const [refocus, setRefocus] = useState(0);
  const closedRef = useRef(false);
  const qtyRef = useRef<HTMLInputElement>(null);
  const lines = useMemo(() => inv?.lines ?? [], [inv]);
  const readOnly = inv?.status !== "open";
  /** Sous-total de cet appareil (en attente, sinon enregistré) et total tous appareils. */
  const mineOf = useCallback((l: InvLine) => pending[l.itemId] ?? l.parts?.find(p => p.device === device)?.qty, [pending, device]);
  const totalOf = useCallback((l: InvLine) => {
    const saved = l.parts?.find(p => p.device === device)?.qty ?? 0, mine = mineOf(l);
    if (l.counted == null && mine == null) return undefined;
    return Math.round(((l.counted ?? 0) - saved + (mine ?? 0)) * 1000) / 1000;
  }, [mineOf, device]);
  const done = lines.filter(l => totalOf(l) != null).length;

  const setCount = useCallback((itemId: string, value: number | ((prev: number) => number), base = 0) => {
    setPending(p => {
      const v = typeof value === "function" ? value(p[itemId] ?? base) : value;
      const n = { ...p, [itemId]: Math.max(0, Math.round(v * 1000) / 1000) };
      writeQueue(id, n); return n;
    });
  }, [id]);

  const flush = useCallback(async () => {
    if (closedRef.current) return false;
    const q = readQueue(id);
    const counts = Object.entries(q).map(([itemId, counted]) => ({ itemId, counted }));
    if (!counts.length) return true;
    setSaving(true);
    const r = await apiSend<{ error?: string; data?: { rejected?: number } }>("PATCH", "/api/comptoir/inventory", { id, device, counts });
    setSaving(false);
    if (!r.ok) {
      if (r.status === 400 && /clos/.test(r.data.error ?? "")) { closedRef.current = true; showToast("Inventaire déjà validé ou annulé : les comptages de cet appareil n'ont pas été pris en compte.", "error"); writeQueue(id, {}); setPending({}); reload(); }
      else if (r.status) showToast(r.data.error || "Enregistrement impossible", "error");
      return false;
    }
    if (r.data.data?.rejected) showToast(`${r.data.data.rejected} comptage(s) invalide(s) écarté(s).`, "error");
    // Ne retire de la file que ce qui vient d'être envoyé (un comptage fait entre-temps reste).
    const now = readQueue(id);
    for (const c of counts) if (now[c.itemId] === c.counted) delete now[c.itemId];
    writeQueue(id, now); setPending(now); reload();
    return true;
  }, [id, device, reload]);

  // Envoi régulier et au retour du réseau.
  useEffect(() => {
    if (readOnly) return;
    const t = setInterval(() => { if (navigator.onLine) flush(); }, 15000);
    const on = () => flush();
    window.addEventListener("online", on);
    return () => { clearInterval(t); window.removeEventListener("online", on); };
  }, [flush, readOnly]);

  function onCode(code: string) {
    const m = matchCode(lines, code);
    if (!m) { beep(false); setUnknown(code); return; }
    beep(true);
    const hit = m.row, step = m.pack && hit.packSize ? hit.packSize : 1;
    // Lecture du code du carton : un carton entier (« +1 » ajoute un carton, sinon le champ carton est prérempli).
    if (plusOne) { setCount(hit.itemId, prev => prev + step, hit.parts?.find(p => p.device === device)?.qty ?? 0); setCurrent(hit.itemId); return; }
    setCurrent(hit.itemId); setQty(""); setPacks(m.pack && hit.packSize ? "1" : "");
    setTimeout(() => qtyRef.current?.focus(), 30);
  }

  /** Quantité saisie (cartons + unités) ; un code-barres arrivé dans le champ quantité (douchette) est traité comme une lecture. */
  function entered(): number | null {
    if (/^\d{8,}$/.test(qty.trim())) { onCode(qty.trim()); setQty(""); return null; }
    const cur = lines.find(x => x.itemId === current);
    const p = packs.trim() ? num(packs) : 0, u = qty.trim() ? num(qty) : 0;
    if (!(p >= 0) || !(u >= 0) || (!packs.trim() && !qty.trim())) { showToast("Quantité invalide.", "error"); return null; }
    return Math.round((p * (cur?.packSize ?? 0) + u) * 1000) / 1000;
  }
  function apply(mode: "add" | "replace") {
    if (!current) return;
    const n = entered();
    if (n === null) return;
    const l = lines.find(x => x.itemId === current)!;
    // Un article rangé à plusieurs endroits : chaque saisie s'ajoute au sous-total de l'appareil.
    if (mode === "add") setCount(current, prev => prev + n, l.parts?.find(p => p.device === device)?.qty ?? 0);
    else setCount(current, n);
    setQty(""); setPacks(""); setCurrent(null); setRefocus(x => x + 1);
  }

  async function validate() {
    if (validating) return;
    setValidating(true);
    try {
      if (!(await flush()) && Object.keys(readQueue(id)).length) return;
      const missing = lines.length - done;
      if (!reviewed.current && !(await confirmDialog({ title: "Valider l'inventaire ?", message: `${done} article(s) compté(s)${missing ? `, ${missing} non compté(s) (leur stock ne change pas)` : ""}. Vérifiez qu'aucun autre appareil n'a de comptage en attente. Les écarts avec le stock théorique relevé au moment du comptage seront passés en stock et chiffrés au coût.` }))) return;
      // Les écarts se voient ici, après le comptage à l'aveugle : chacun reçoit sa justification.
      const rv = await apiJson(`/api/comptoir/inventory?id=${id}&review=1`).catch(() => null);
      const gaps = (rv?.data?.gaps ?? []) as Gap[];
      if (gaps.length && !reviewed.current) { setReview(gaps); return; }
      const r = await apiSend<{ data: Inv; error?: string }>("POST", "/api/comptoir/inventory", { id, action: "validate", reasons });
      reviewed.current = false;
      if (!r.ok) return showToast(r.data.error || "Validation impossible", "error");
      closedRef.current = true; writeQueue(id, {});
      showToast(`Inventaire validé${costs && r.data.data.gapValue !== undefined ? ` — écart ${MONEY(r.data.data.gapValue)}` : ""}`, "success");
      reload(); onValidated();
    } finally { setValidating(false); }
  }

  async function cancel() {
    if (!(await confirmDialog({ title: "Annuler cet inventaire ?", message: "Les comptages sont abandonnés ; le stock ne change pas.", danger: true }))) return;
    const r = await apiSend<{ error?: string }>("POST", "/api/comptoir/inventory", { id, action: "cancel" });
    if (!r.ok) return showToast(r.data.error || "Annulation impossible", "error");
    closedRef.current = true; writeQueue(id, {}); onClose();
  }

  const shown = lines.filter(l => filter === "all" ? true : filter === "todo" ? totalOf(l) == null : (l.gap ?? 0) !== 0);
  const cur = lines.find(l => l.itemId === current);
  const queued = Object.keys(pending).length;

  if (review) return (
    <Modal open onClose={() => setReview(null)} title="Écarts à justifier" description="Si un écart vous surprend, fermez et recomptez cet article." size="lg" footer={<button disabled={review.some(g => !reasons[g.itemId])} onClick={() => { reviewed.current = true; setReview(null); validate(); }} className={buttonClass("primary", "md")}>Valider l&apos;inventaire</button>}>
      <ul className="divide-y divide-line">{review.map(g => (
        <li key={g.itemId} className="py-2 space-y-1">
          <p className="text-sm flex justify-between gap-2"><span>{g.name} : compté {g.counted}, attendu {g.expected} {g.unit}</span><b className={`font-mono ${g.value < 0 ? "text-neg" : ""}`}>{MONEY(g.value)}</b></p>
          <select className={selectCls} value={reasons[g.itemId] ?? ""} aria-label={`Justification de ${g.name}`} onChange={e => setReasons(r => ({ ...r, [g.itemId]: e.target.value }))}><option value="">Justification…</option>{GAP_REASONS.map(x => <option key={x}>{x}</option>)}</select>
        </li>
      ))}</ul>
    </Modal>
  );
  return (
    <Modal open onClose={async () => { if (!readOnly) await flush(); onClose(); }} size="xl" title={inv ? `${inv.number} — ${LEVEL[inv.level]}` : "Inventaire"}
      description={readOnly ? (inv?.status === "validated" ? `Validé le ${new Date(inv.validatedAt!).toLocaleDateString("fr-FR")}` : "Annulé") : `${done} / ${lines.length} article(s) compté(s), tous appareils`}
      footer={readOnly ? <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button> : <>
        <button onClick={cancel} className={buttonClass("ghost", "md")}><XCircle size={15} /> Annuler l&apos;inventaire</button>
        <button disabled={saving} onClick={() => flush()} className={buttonClass("secondary", "md")}><Save size={15} /> Enregistrer</button>
        {costs && <button disabled={validating} onClick={validate} className={buttonClass("primary", "md")}><CheckCircle2 size={15} /> Valider</button>}
      </>}>
      {!inv ? <div className="h-40 animate-pulse surface-card" /> : (
        <div className="space-y-3">
          {!readOnly && <>
            <div className="h-2 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-pos" style={{ width: `${lines.length ? (done / lines.length) * 100 : 0}%` }} /></div>
            <BarcodeScanner onCode={onCode} refocus={refocus} />
            <label className="inline-flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={plusOne} onChange={e => setPlusOne(e.target.checked)} /> +1 à chaque lecture (compter pièce par pièce)</label>
            {plusOne && cur && <p className="text-2xl font-bold font-mono">{cur.name} : {QTY(mineOf(cur))} <button onClick={() => setCount(cur.itemId, prev => prev - 1, cur.parts?.find(p => p.device === device)?.qty ?? 0)} className={buttonClass("secondary", "sm")}>−1</button></p>}
            {cur && !plusOne && (
              <div className="surface-card p-3 flex flex-wrap items-end gap-2 border-section">
                <div className="flex-1 min-w-[10rem]"><p className="font-semibold text-ink">{cur.name}</p><p className="text-xs text-ink3">Déjà compté sur cet appareil : {QTY(mineOf(cur))} {cur.unit}{totalOf(cur) !== mineOf(cur) ? ` · tous appareils : ${QTY(totalOf(cur))}` : ""}</p></div>
                {cur.packSize ? <FormField label={`Paquets de ${cur.packSize}`}><input className={`${inputCls} w-24`} inputMode="decimal" value={packs} onChange={e => setPacks(e.target.value)} onKeyDown={e => { if (e.key === "Enter") apply("add"); }} /></FormField> : null}
                <FormField label={cur.packSize ? `+ unités (${cur.unit})` : `Quantité (${cur.unit})`}><input ref={qtyRef} className={`${inputCls} w-28`} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => { if (e.key === "Enter") apply("add"); }} /></FormField>
                <button onClick={() => apply("add")} className={buttonClass("primary", "md")}>Ajouter</button>
                <button onClick={() => apply("replace")} className={buttonClass("secondary", "md")}>Remplacer</button>
              </div>
            )}
            {queued > 0 && <p className="text-xs text-warn flex items-center gap-1"><CloudOff size={13} /> {queued} comptage(s) gardé(s) sur cet appareil, envoyé(s) dès que possible.</p>}
          </>}
          <div className="flex gap-1 text-xs">
            {(readOnly ? [["all", "Tous"], ["gaps", "Écarts"]] : [["todo", "À compter"], ["all", "Tous"]]).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k as typeof filter)} className={`px-2.5 h-7 rounded-full border ${filter === k ? "bg-ink text-white border-ink" : "border-line text-ink2"}`}>{l}</button>
            ))}
          </div>
          <div className="overflow-x-auto max-h-[45vh]">
            <table className="table-dense w-full">
              <thead><tr><th>Article</th><th className="text-right">{readOnly ? "Compté" : "Cet appareil"}</th>{!readOnly && <th className="text-right">Total</th>}{readOnly && <><th className="text-right">Théorique</th><th className="text-right">Écart</th>{costs && <th className="text-right">Valeur</th>}</>}{!readOnly && <th></th>}</tr></thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.itemId} className={`border-t border-line ${l.itemId === current ? "bg-surface2" : ""}`}>
                    <td>{l.name}{l.barcode ? <span className="block text-[11px] text-ink3 font-mono">{l.barcode}</span> : null}</td>
                    <td className="text-right font-mono">{readOnly ? QTY(l.counted) : <CountCell value={mineOf(l)} onCommit={v => v === null ? setPending(p => { const n = { ...p }; delete n[l.itemId]; writeQueue(id, n); return n; }) : setCount(l.itemId, v)} />} <span className="text-ink3 text-xs">{l.unit}</span></td>
                    {!readOnly && <td className="text-right font-mono text-ink2">{QTY(totalOf(l))}</td>}
                    {readOnly && <>
                      <td className="text-right font-mono text-ink2">{QTY(l.expected)}</td>
                      <td className={`text-right font-mono ${(l.gap ?? 0) < 0 ? "text-neg" : (l.gap ?? 0) > 0 ? "text-pos" : ""}`}>{l.gap ? `${l.gap > 0 ? "+" : ""}${QTY(l.gap)}` : l.counted == null ? "non compté" : "0"}</td>
                      {costs && <td className={`text-right font-mono ${(l.gapValue ?? 0) < 0 ? "text-neg" : ""}`}>{l.gapValue ? MONEY(l.gapValue) : "—"}</td>}
                    </>}
                    {!readOnly && <td className="text-right"><button onClick={() => { setCurrent(l.itemId); setQty(""); setPacks(""); setPlusOne(false); setTimeout(() => qtyRef.current?.focus(), 30); }} className={buttonClass("ghost", "sm")}>Compter</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {readOnly && costs && inv.gapValue !== undefined && <p className={`text-sm font-semibold ${inv.gapValue < 0 ? "text-neg" : ""}`}>Écart net de l&apos;inventaire : {MONEY(inv.gapValue)}</p>}
        </div>
      )}
      {unknown && <AssignCode code={unknown} lines={lines} onClose={() => { setUnknown(null); setRefocus(x => x + 1); }} onDone={(itemId) => { setUnknown(null); reload(); setCurrent(itemId); setTimeout(() => qtyRef.current?.focus(), 50); }} />}
    </Modal>
  );
}

/** Saisie d'un comptage dans le tableau : texte libre (virgule, espaces), enregistré à la sortie du champ ou à Entrée. */
function CountCell({ value, onCommit }: { value: number | undefined; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? "" : String(value).replace(".", ","));
  const commit = () => {
    if (text === null) return;
    const v = num(text);
    if (text.trim() === "") onCommit(null);
    else if (v >= 0 && v <= 1e6) onCommit(v);
    else showToast("Quantité invalide.", "error");
    setText(null);
  };
  return <input className={`${inputCls} w-24 text-right inline-block`} inputMode="decimal" value={shown} placeholder="—" onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} />;
}

/** Code lu inconnu : on l'attribue à un article (il sera reconnu la prochaine fois, au comptoir comme à la réserve). */
function AssignCode({ code, lines, onClose, onDone }: { code: string; lines: InvLine[]; onClose: () => void; onDone: (itemId: string) => void }) {
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!itemId) return;
    setBusy(true);
    const r = await apiSend<{ error?: string }>("PATCH", `/api/comptoir/items/${itemId}`, { barcode: code });
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Attribution impossible", "error");
    showToast("Code-barres attribué", "success"); onDone(itemId);
  }
  return (
    <Modal open onClose={onClose} title="Code-barres inconnu" description={`« ${code} » ne correspond à aucun article de cet inventaire.`}
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Ignorer</button><button disabled={!itemId || busy} onClick={save} className={buttonClass("primary", "md")}>Attribuer</button></>}>
      <FormField label="Article qui porte ce code">
        <select className={selectCls} value={itemId} onChange={e => setItemId(e.target.value)}>
          <option value="">Choisir…</option>
          {lines.filter(l => !l.barcode).map(l => <option key={l.itemId} value={l.itemId}>{l.name}</option>)}
        </select>
      </FormField>
    </Modal>
  );
}
