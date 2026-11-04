"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PackagePlus, ArrowUpFromLine, ScanLine, ArrowLeft, Truck, ShoppingCart, TriangleAlert, Receipt, CalendarRange } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { useOpKey } from "@/lib/use-op-key";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { LOSS_REASONS } from "@/lib/spot";
import { useApi } from "@/lib/use-api";
import { WeekPanel } from "@/components/restauration/WeekPanel";
import { apiJson, apiSend } from "@/lib/api-client";
import { ReceiveDialog, LevelMoveDialog, ReserveLossDialog, type ReserveData } from "@/components/comptoir/RestaurantStock";
import { InventoryPanel } from "@/components/comptoir/InventoryPanel";
import { TodayDeliveries } from "@/components/restauration/StandingDeliveries";

/**
 * Accueil du gestionnaire, pensé pour le téléphone et la douchette : recevoir,
 * vendre, monter au comptoir, compter ; puis transférer, déclarer une perte,
 * ajouter une dépense, préparer la semaine. Rien d'autre à l'écran.
 */
export default function MagasinPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [data, setData] = useState<ReserveData | null>(null);
  const [mode, setMode] = useState<"home" | "receive" | "supply" | "count" | "loss" | "lossDesk" | "expense" | "deposit">("home");
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const load = useCallback(() => { if (deskId) apiJson(`/api/comptoir/reserve?deskId=${deskId}`).then(d => setData((d.data as ReserveData) ?? null)).catch(() => setData(null)); }, [deskId]);
  useEffect(() => { load(); }, [load]);
  const costs = !!data?.showCosts;
  const done = () => { setMode("home"); load(); };
  const big = "w-full min-h-[96px] rounded-2xl border-2 text-xl font-bold inline-flex items-center justify-center gap-3 active:scale-[0.99] transition";

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/restauration" className="h-10 w-10 inline-flex items-center justify-center rounded-full border border-line" aria-label="Retour"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-ink flex-1">Magasin</h1>
      </div>
      {desks.length > 1 && <select className={`${selectCls} h-12 text-base`} value={deskId} onChange={e => { setDeskId(e.target.value); setMode("home"); }} aria-label="Restaurant">{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select>}
      {mode === "count" ? (
        <div className="space-y-3">
          <button onClick={done} className="h-11 px-4 rounded-full border border-line text-sm font-semibold inline-flex items-center gap-2"><ArrowLeft size={15} /> Fin du comptage</button>
          {deskId && <InventoryPanel deskId={deskId} costs={costs} categories={[...new Set((data?.rows ?? []).map(r => r.category).filter(Boolean) as string[])].sort()} onChange={load} />}
        </div>
      ) : (
        <div className="grid gap-3">
          <button disabled={!data} onClick={() => setMode("receive")} className={`${big} border-section bg-section text-white`}><PackagePlus size={30} /> Recevoir</button>
          <button disabled={!data} onClick={() => setMode("supply")} className={`${big} border-ink text-ink`}><ArrowUpFromLine size={30} /> Monter au comptoir</button>
          <button disabled={!deskId} onClick={() => setMode("count")} className={`${big} border-ink text-ink`}><ScanLine size={30} /> Compter</button>
          <Link href={deskId ? `/comptoir?desk=${deskId}` : "/comptoir"} className={`${big} border-ink text-ink`}><ShoppingCart size={30} /> Vendre</Link>
          <div className="grid grid-cols-2 gap-2">
            <Link href={deskId ? `/restauration/transferts?from=${deskId}` : "/restauration/transferts"} className="h-12 rounded-xl border border-line text-[15px] font-semibold inline-flex items-center justify-center gap-2 text-ink"><Truck size={17} /> Transférer</Link>
            <button disabled={!data} onClick={() => setMode("lossDesk")} className="h-12 rounded-xl border border-line text-[15px] font-semibold inline-flex items-center justify-center gap-2 text-ink"><TriangleAlert size={17} /> Perte</button>
            <button disabled={!deskId} onClick={() => setMode("expense")} className="h-12 rounded-xl border border-line text-[15px] font-semibold inline-flex items-center justify-center gap-2 text-ink"><Receipt size={17} /> Dépense</button>
            <Link href="/restauration/achats#semaine" className="h-12 rounded-xl border border-line text-[15px] font-semibold inline-flex items-center justify-center gap-2 text-ink"><CalendarRange size={17} /> Ma semaine</Link>
          </div>
          {deskId && <TodayDeliveries key={deskId} deskId={deskId} onChange={load} big />}
          {costs && <button disabled={!deskId} onClick={() => setMode("deposit")} className="h-11 rounded-xl border border-line text-sm font-semibold text-ink2">Remise d&apos;espèces en banque</button>}
          {deskId && <WeekPanel key={`w${deskId}`} deskId={deskId} costs={costs} />}
          {data && <p className="text-center text-sm text-ink3">{data.rows.filter(r => r.lowDesk).length} article(s) à monter · {data.rows.filter(r => r.lowReserve).length} sous le seuil de réserve</p>}
        </div>
      )}
      {mode === "lossDesk" && data && <DeskLossDialog deskId={deskId} rows={data.rows} onClose={() => setMode("home")} onDone={done} onReserve={() => setMode("loss")} />}
      {mode === "deposit" && <DepositDialog deskId={deskId} onClose={() => setMode("home")} onDone={done} />}
      {mode === "loss" && data && <ReserveLossDialog deskId={deskId} rows={data.rows} onClose={() => setMode("home")} onDone={done} />}
      {mode === "expense" && <ExpenseDialog deskId={deskId} onClose={() => setMode("home")} onDone={done} />}
      {mode === "receive" && data && <ReceiveDialog deskId={deskId} rows={data.rows} costs={costs} onClose={() => setMode("home")} onDone={done} />}
      {mode === "supply" && data && <LevelMoveDialog deskId={deskId} rows={data.rows} direction="supply" initial={data.rows.filter(r => r.lowDesk && r.reserve > 0)} onClose={() => setMode("home")} onDone={done} />}
    </div>
  );
}

const amountOf = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

/** Perte au comptoir, le cas courant ; la réserve a son propre écran. */
function DeskLossDialog({ deskId, rows, onClose, onDone, onReserve }: { deskId: string; rows: ReserveData["rows"]; onClose: () => void; onDone: () => void; onReserve: () => void }) {
  const op = useOpKey();
  const [itemId, setItemId] = useState(""), [quantity, setQuantity] = useState(""), [reason, setReason] = useState("broken"), [busy, setBusy] = useState(false);
  const list = rows.filter(r => r.desk > 0 || r.preparation);
  async function save() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/comptoir/losses", { deskId, itemId, quantity: amountOf(quantity), reason }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Déclaration refusée", "error");
    op.done(); showToast("Perte enregistrée", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Déclarer une perte" description="Au comptoir." size="sm" footer={<><button onClick={onReserve} className={buttonClass("ghost", "md")}>C&apos;est en réserve</button><button disabled={busy || !itemId || !(amountOf(quantity) > 0)} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button></>}>
      <div className="space-y-3">
        <FormField label="Article"><select className={`${selectCls} h-12 text-base`} value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Choisir…</option>{list.map(r => <option key={r.itemId} value={r.itemId}>{r.name} ({r.desk} {r.unit})</option>)}</select></FormField>
        <FormField label="Quantité"><input className={`${inputCls} h-12 text-base`} inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></FormField>
        <FormField label="Motif"><select className={selectCls} value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(LOSS_REASONS).filter(([k]) => k !== "inventory").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

/** Remise d'espèces : l'argent change de place, ce n'est ni une recette ni une dépense. */
function DepositDialog({ deskId, onClose, onDone }: { deskId: string; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const { data } = useApi<{ accounts?: Array<{ _id: string; label: string }> } | null>(`/api/restauration/semaine?deskId=${deskId}`, d => (d?.data as never) ?? null, null, { quiet: true });
  const [amount, setAmount] = useState(""), [to, setTo] = useState(""), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/semaine", { deskId, action: "deposit", amount: amountOf(amount), toAccountId: to }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    op.done(); showToast("Remise enregistrée", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Remise d'espèces" description="Ni recette ni dépense : l'argent change de place." size="sm" footer={<button disabled={busy || !to || !(amountOf(amount) > 0)} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button>}>
      <div className="space-y-3">
        <FormField label="Montant (FCFA)"><input className={`${inputCls} h-12 text-base`} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Compte qui reçoit"><select className={selectCls} value={to} onChange={e => setTo(e.target.value)}><option value="">Choisir…</option>{(data?.accounts ?? []).map(a => <option key={a._id} value={a._id}>{a.label}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

/** Dépense rapide payée en caisse. Une marchandise passe par « Recevoir ». */
function ExpenseDialog({ deskId, onClose, onDone }: { deskId: string; onClose: () => void; onDone: () => void }) {
  const op = useOpKey();
  const [amount, setAmount] = useState(""), [label, setLabel] = useState(""), [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const natures = Object.entries(EXPENSE_CATEGORIES).filter(([k]) => !["supply", "ingredients", "utilities"].includes(k));
  async function save() {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/comptoir/cash", { deskId, direction: "out", amount: amountOf(amount), label: label.trim() || EXPENSE_CATEGORIES[category], category, method: "cash" }, op.headers());
    setBusy(false);
    if (!r.ok) return showToast(r.data.error || "Dépense refusée", "error");
    op.done(); showToast("Dépense enregistrée", "success"); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Ajouter une dépense" description="Payée depuis la caisse du site." size="sm" footer={<button disabled={busy || !category || !(amountOf(amount) > 0)} onClick={save} className={buttonClass("primary", "md")}>Enregistrer</button>}>
      <div className="space-y-3">
        <FormField label="Nature"><select className={`${selectCls} h-12 text-base`} value={category} onChange={e => setCategory(e.target.value)}><option value="">Choisir…</option>{natures.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        <FormField label="Montant (FCFA)"><input className={`${inputCls} h-12 text-base`} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Précision (facultatif)"><input className={inputCls} value={label} onChange={e => setLabel(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}
