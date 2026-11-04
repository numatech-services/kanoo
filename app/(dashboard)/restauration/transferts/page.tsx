"use client";
import { useEffect, useState } from "react";
import { Truck, Plus, Printer, PenLine } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useOpKey } from "@/lib/use-op-key";
import { confirmDialog } from "@/components/ui/Dialogs";
import { useApi } from "@/lib/use-api";
import { SignaturePad } from "@/components/shared/SignaturePad";
import { BarcodeScanner, beep } from "@/components/shared/BarcodeScanner";
import { matchCode } from "@/lib/barcodes";
import { RestoNav } from "@/components/restauration/RestoNav";
import type { ReserveData, StockRow } from "@/components/comptoir/RestaurantStock";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const dmy = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const num = (v: string) => { const t = v.replace(/\s/g, "").replace(",", "."); return t === "" ? NaN : Number(t); };
const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

interface Transfer {
  _id: string; number: string; fromDeskId: string; fromName: string; toDeskId: string; toName: string; status: "sent" | "transit" | "received" | "gap"; gapResolution?: { decision: string; value: number };
  lines: Array<{ fromItemId: string; name: string; unit: string; quantity: number; receivedQty?: number; unitCost?: number; lots: Array<{ lotNumber: string; qty: number; expiryDate?: string }> }>;
  value?: number; senderName: string; sentAt: string; receiverName?: string; receivedAt?: string; gapNote?: string; note?: string;
  senderSignature?: string; receiverSignature?: string;
}

/**
 * Transferts entre restaurants : de la réserve de l'un à celle de l'autre,
 * lots et coût conservés, bon numéroté signé à l'envoi puis à la réception.
 */
export default function TransfertsPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [resolving, setResolving] = useState<Transfer | null>(null);
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => setDesks((d.data ?? []) as Array<{ _id: string; name: string }>)).catch(() => {}); }, []);
  const { data, loading, error, reload } = useApi<Transfer[]>("/api/restauration/transferts", d => (d?.data as Transfer[]) ?? [], [], { quiet: true });
  const mine = new Set(desks.map(d => d._id));

  async function resolve(id: string, decision: "return" | "loss") {
    if (!(await confirmDialog(decision === "return" ? "La marchandise manquante revient chez l'expéditeur ?" : "La marchandise manquante est perdue ? Elle compte au résultat de l'expéditeur."))) return;
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/transferts", { action: "resolve", id, decision });
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    showToast("Écart tranché", "success"); setResolving(null); reload();
  }

  async function print(id: string) {
    const d = await apiJson(`/api/restauration/transferts?id=${id}`).catch(() => null);
    const t = d?.data as Transfer | undefined;
    if (!t) return showToast("Bon introuvable.", "error");
    const w = window.open("", "_blank");
    if (!w) return showToast("Autorisez l'ouverture de fenêtres pour imprimer.", "error");
    const rows = t.lines.map(l => `<tr><td>${escHtml(l.name)}</td><td style="text-align:right">${l.quantity} ${escHtml(l.unit)}</td><td>${l.lots.map(x => `${escHtml(x.lotNumber)} (${x.qty}${x.expiryDate ? `, DLC ${new Date(x.expiryDate).toLocaleDateString("fr-FR")}` : ""})`).join("<br>")}</td>${t.value !== undefined ? `<td style="text-align:right">${MONEY((l.unitCost ?? 0) * l.quantity)}</td>` : ""}</tr>`).join("");
    const sig = (label: string, name?: string, at?: string, img?: string) => `<div style="flex:1;border:1px solid #999;padding:8px;min-height:120px"><b>${label}</b><br>${escHtml(name ?? "")}${at ? ` — ${dmy(at)}` : ""}<br>${img ? `<img src="${img}" style="max-height:90px">` : ""}</div>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(t.number)}</title><style>body{font-family:system-ui,sans-serif;font-size:13px;margin:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:5px;text-align:left}</style></head><body>
      <h2>Bon de transfert ${escHtml(t.number)}</h2><p>De <b>${escHtml(t.fromName)}</b> vers <b>${escHtml(t.toName)}</b>, envoyé le ${dmy(t.sentAt)}.${t.note ? `<br>${escHtml(t.note)}` : ""}</p>
      <table><thead><tr><th>Article</th><th>Quantité</th><th>Lots</th>${t.value !== undefined ? "<th>Valeur au coût</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>
      ${t.value !== undefined ? `<p style="text-align:right"><b>Total au coût : ${MONEY(t.value)}</b></p>` : ""}
      ${t.gapNote ? `<p><b>Écart signalé à la réception :</b> ${escHtml(t.gapNote)}</p>` : ""}
      <div style="display:flex;gap:12px;margin-top:16px">${sig("Expédié par", t.senderName, t.sentAt, t.senderSignature)}${sig("Reçu par", t.receiverName, t.receivedAt, t.receiverSignature)}</div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><Truck size={22} /> Transferts entre restaurants</h1>
          <p className="text-sm text-ink2">De la réserve d&apos;un restaurant à celle d&apos;un autre, lots et coût conservés, sur un bon signé à l&apos;envoi et à la réception.</p>
        </div>
        <button disabled={desks.length < 1} onClick={() => setSending(true)} className={buttonClass("primary", "md")}><Plus size={15} /> Nouveau transfert</button>
      </div>
      <RestoNav />
      {error && <p className="text-sm text-neg">{error}</p>}
      {data.filter(t => (t.status === "sent" || t.status === "transit") && mine.has(t.toDeskId)).map(t => (
        <section key={`r${t._id}`} className="surface-card p-4 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm"><b>À recevoir</b> de {t.fromName} : {t.lines.map(l => `${l.name} ${l.quantity} ${l.unit}`).join(", ")}</p>
          <button onClick={() => setReceiving(t)} className={buttonClass("primary", "sm")}><PenLine size={13} /> Signer la réception</button>
        </section>
      ))}
      {loading && !data.length ? <div className="h-40 surface-card animate-pulse" /> : !data.length ? (
        <EmptyState icon={<Truck size={20} />} title="Aucun transfert" hint="Un restaurant en manque peut être dépanné par un autre, sans passer par un achat." />
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="table-dense w-full min-w-[640px]">
            <thead><tr><th>Bon</th><th>De</th><th>Vers</th><th>Articles</th>{data.some(t => t.value !== undefined) && <th className="text-right">Valeur</th>}<th>État</th><th /></tr></thead>
            <tbody>{data.map(t => (
              <tr key={t._id} className="border-t border-line">
                <td className="font-mono text-[12px]">{t.number}<span className="block text-ink3">{dmy(t.sentAt)}</span></td>
                <td>{t.fromName}</td><td>{t.toName}</td>
                <td className="text-[12px]">{t.lines.map(l => `${l.name} ${l.quantity} ${l.unit}`).join(", ")}</td>
                {t.value !== undefined && <td className="text-right font-mono">{MONEY(t.value)}</td>}
                <td>{t.status === "gap" ? <Pill tone="neg">écart à trancher</Pill> : t.status === "received" ? <Pill tone="pos">reçu{t.gapNote ? " avec écart" : ""}</Pill> : <Pill tone="warn">en transit</Pill>}</td>
                <td className="text-right whitespace-nowrap">
                  {(t.status === "sent" || t.status === "transit") && mine.has(t.toDeskId) && <button onClick={() => setReceiving(t)} className={buttonClass("secondary", "sm")}><PenLine size={13} /> Signer la réception</button>}
                  {t.status === "gap" && t.value !== undefined && <button onClick={() => setResolving(t)} className={buttonClass("secondary", "sm")}>Trancher l&apos;écart</button>}
                  <button onClick={() => print(t._id)} className={buttonClass("ghost", "sm")} title="Imprimer le bon"><Printer size={13} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {sending && <SendDialog desks={desks} onClose={() => setSending(false)} onDone={() => { setSending(false); reload(); }} />}
      {resolving && <Modal open onClose={() => setResolving(null)} title={`Écart du bon ${resolving.number}`} description={resolving.gapNote} size="sm" footer={<><button onClick={() => resolve(resolving._id, "return")} className={buttonClass("secondary", "md")}>Revenue chez l&apos;expéditeur</button><button onClick={() => resolve(resolving._id, "loss")} className={buttonClass("primary", "md")}>Perdue</button></>}>
        <ul className="text-sm list-disc pl-5">{resolving.lines.filter(l => (l.receivedQty ?? l.quantity) < l.quantity).map(l => <li key={l.fromItemId}>{l.name} : manque {Math.round((l.quantity - (l.receivedQty ?? 0)) * 1000) / 1000} {l.unit}</li>)}</ul>
      </Modal>}
      {receiving && <ReceiveTransferDialog t={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); reload(); }} />}
    </div>
  );
}

function SendDialog({ desks, onClose, onDone }: { desks: Array<{ _id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [fromId, setFromId] = useState(() => { const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("from"); return q && desks.some(d => d._id === q) ? q : desks[0]?._id ?? ""; });
  const [toId, setToId] = useState("");
  const [all, setAll] = useState<Array<{ _id: string; name: string }>>(desks);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [qty, setQty] = useState<Record<string, { packs: string; units: string }>>({});
  const [signer, setSigner] = useState(""), [sig, setSig] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Destinataires : tous les restaurants de l'organisation (la liste « mes comptoirs » peut être limitée).
  useEffect(() => { apiJson("/api/restauration/transferts?destinations=1").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; if (l.length) setAll(l); }).catch(() => {}); }, []);
  useEffect(() => { if (fromId) apiJson(`/api/comptoir/reserve?deskId=${fromId}`).then(d => setRows(((d.data as ReserveData)?.rows ?? []).filter(r => r.batch ? r.desk > 0 : !r.preparation && r.reserve > 0))).catch(() => setRows([])); }, [fromId]);
  const chosen = rows.filter(r => r.itemId in qty);
  const op = useOpKey();
  async function send() {
    const lines = chosen.map(r => ({ r, q: qty[r.itemId] })).filter(x => num(x.q.packs) > 0 || num(x.q.units) > 0)
      .map(x => num(x.q.packs) > 0 && x.r.pack?.size ? { itemId: x.r.itemId, packs: num(x.q.packs) } : { itemId: x.r.itemId, quantity: num(x.q.units) });
    if (!toId) return showToast("Choisissez le restaurant destinataire.", "error");
    if (!lines.length) return showToast("Saisissez au moins une quantité.", "error");
    setBusy(true);
    const r = await apiSend<{ data: { number: string }; error?: string }>("POST", "/api/restauration/transferts", { action: "send", fromDeskId: fromId, toDeskId: toId, lines, signerName: signer, signature: sig, note: note || undefined }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Transfert refusé", "error");
    op.done(); showToast(`Transfert ${r.data.data.number} envoyé : en transit jusqu'à sa réception`, "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} size="xl" title="Nouveau transfert" description="Sortie de la réserve du restaurant d'origine, entrée dans celle du destinataire. Les lots les plus proches de leur péremption partent les premiers ; un lot périmé ne part pas."
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || !sig || signer.trim().length < 2} onClick={send} className={buttonClass("primary", "md")}>Signer et envoyer</button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="De"><select className={selectCls} value={fromId} onChange={e => { setFromId(e.target.value); setQty({}); }}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
          <FormField label="Vers"><select className={selectCls} value={toId} onChange={e => setToId(e.target.value)}><option value="">Choisir…</option>{all.filter(d => d._id !== fromId).map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
        </div>
        <BarcodeScanner placeholder="Scanner (unité ou carton) ou taper un article, puis Entrée" onCode={code => {
          const m = matchCode(rows, code); beep(!!m); if (!m) return;
          const id = m.row.itemId;
          if (m.pack && m.row.pack?.size) setQty(q => ({ ...q, [id]: { packs: String((num(q[id]?.packs ?? "") || 0) + 1), units: "" } }));
          else setQty(q => id in q ? q : { ...q, [id]: { packs: "", units: "" } });
        }} />
        <select className={selectCls} value="" onChange={e => e.target.value && setQty(q => ({ ...q, [e.target.value]: { packs: "", units: "" } }))}>
          <option value="">Ajouter un article de la réserve…</option>
          {rows.filter(r => !(r.itemId in qty)).map(r => <option key={r.itemId} value={r.itemId}>{r.name} — {r.batch ? `${r.desk} portion(s)` : `${r.reserve} ${r.unit}`}</option>)}
        </select>
        {chosen.length > 0 && (
          <table className="table-dense w-full">
            <thead><tr><th>Article</th><th className="text-right">En réserve</th><th>Paquets</th><th>ou unités</th></tr></thead>
            <tbody>{chosen.map(r => (
              <tr key={r.itemId} className="border-t border-line">
                <td>{r.name}</td><td className="text-right font-mono">{r.batch ? r.desk : r.reserve} {r.unit}</td>
                <td>{r.pack?.size ? <input className={`${inputCls} w-20`} inputMode="decimal" value={qty[r.itemId].packs} onChange={e => setQty(q => ({ ...q, [r.itemId]: { ...q[r.itemId], packs: e.target.value } }))} /> : "—"}</td>
                <td><input className={`${inputCls} w-24`} inputMode="decimal" disabled={num(qty[r.itemId].packs) > 0} value={qty[r.itemId].units} onChange={e => setQty(q => ({ ...q, [r.itemId]: { ...q[r.itemId], units: e.target.value } }))} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <FormField label="Observation (facultatif)"><input className={inputCls} maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></FormField>
        <FormField label="Nom de l'expéditeur" required><input className={inputCls} value={signer} onChange={e => setSigner(e.target.value)} /></FormField>
        <SignaturePad onChange={setSig} />
      </div>
    </Modal>
  );
}

function ReceiveTransferDialog({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [signer, setSigner] = useState(""), [sig, setSig] = useState(""), [gap, setGap] = useState("");
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map(l => [l.fromItemId, String(l.quantity)])));
  const [busy, setBusy] = useState(false);
  const op = useOpKey();
  const legacy = t.status === "sent";
  const short = t.lines.some(l => Number((got[l.fromItemId] ?? "").replace(",", ".")) < l.quantity);
  async function save() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/transferts", { action: "receive", id: t._id, signerName: signer, signature: sig, gapNote: gap || undefined,
      ...(legacy ? {} : { received: t.lines.map(l => ({ fromItemId: l.fromItemId, quantity: Number((got[l.fromItemId] ?? "").replace(",", ".")) })) }) }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Réception refusée", "error");
    op.done();
    showToast(short ? "Reçu : le manque reste en transit, à trancher par le chef ou la finance." : "Réception signée", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Réception ${t.number}`} description={`Envoyé par ${t.fromName} (${t.senderName}) le ${dmy(t.sentAt)}. ${legacy ? "La marchandise est déjà en réserve : vérifiez-la, puis signez." : "Comptez ce qui est arrivé : seule cette quantité entre dans votre réserve."}`}
      footer={<><button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button><button disabled={busy || !sig || signer.trim().length < 2 || (short && !gap.trim())} onClick={save} className={buttonClass("primary", "md")}>Signer la réception</button></>}>
      <div className="space-y-3">
        <ul className="space-y-2">{t.lines.map(l => (
          <li key={l.fromItemId} className="flex items-center justify-between gap-2 text-sm">
            <span>{l.name} <span className="text-ink3">(envoyé : {l.quantity} {l.unit}{l.lots.length ? `, lots ${l.lots.map(x => x.lotNumber).join(", ")}` : ""})</span></span>
            {!legacy && <input className={`${inputCls} w-24`} inputMode="decimal" aria-label={`Quantité reçue de ${l.name}`} value={got[l.fromItemId] ?? ""} onChange={e => setGot(g => ({ ...g, [l.fromItemId]: e.target.value }))} />}
          </li>
        ))}</ul>
        <FormField label={short ? "Que s'est-il passé ?" : "Remarque (facultatif)"} required={short}><input className={inputCls} maxLength={400} placeholder="Ex. : 1 carton abîmé, 2 kg manquants" value={gap} onChange={e => setGap(e.target.value)} /></FormField>
        <FormField label="Nom du réceptionnaire" required><input className={inputCls} value={signer} onChange={e => setSigner(e.target.value)} /></FormField>
        <SignaturePad onChange={setSig} />
      </div>
    </Modal>
  );
}
