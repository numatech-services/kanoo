"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PackagePlus, ArrowUpFromLine, ScanLine, ArrowLeft, Truck } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";
import { apiJson } from "@/lib/api-client";
import { ReceiveDialog, LevelMoveDialog, type ReserveData } from "@/components/comptoir/RestaurantStock";
import { InventoryPanel } from "@/components/comptoir/InventoryPanel";
import { TodayDeliveries } from "@/components/restauration/StandingDeliveries";

/**
 * Écran du magasinier, pensé pour le téléphone et la douchette : trois gestes
 * — recevoir une livraison en réserve, monter au comptoir, compter le stock —
 * et les transferts entre restaurants. Rien d'autre à l'écran.
 */
export default function MagasinPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [data, setData] = useState<ReserveData | null>(null);
  const [mode, setMode] = useState<"home" | "receive" | "supply" | "count">("home");
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const load = useCallback(() => { if (deskId) apiJson(`/api/comptoir/reserve?deskId=${deskId}`).then(d => setData((d.data as ReserveData) ?? null)).catch(() => setData(null)); }, [deskId]);
  useEffect(() => { load(); }, [load]);
  const costs = !!data?.rows.some(r => r.unitCost !== null);
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
          <Link href="/restauration/transferts" className="h-12 rounded-xl border border-line text-base font-semibold inline-flex items-center justify-center gap-2 text-ink2"><Truck size={18} /> Transferts entre restaurants</Link>
          {deskId && <TodayDeliveries key={deskId} deskId={deskId} onChange={load} big />}
          {data && <p className="text-center text-sm text-ink3">{data.rows.filter(r => r.lowDesk).length} article(s) à monter · {data.rows.filter(r => r.lowReserve).length} sous le seuil de réserve</p>}
        </div>
      )}
      {mode === "receive" && data && <ReceiveDialog deskId={deskId} rows={data.rows} costs={costs} onClose={() => setMode("home")} onDone={done} />}
      {mode === "supply" && data && <LevelMoveDialog deskId={deskId} rows={data.rows} direction="supply" initial={data.rows.filter(r => r.lowDesk && r.reserve > 0)} onClose={() => setMode("home")} onDone={done} />}
    </div>
  );
}
