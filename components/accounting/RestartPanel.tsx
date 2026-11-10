"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { formatDate, todayLocal } from "@/lib/format";

interface Preview {
  counts: Array<{ key: string; label: string; count: number }>;
  treasuryAccounts: number; openSessions: number;
  export: { exportId: string; exportedAt: string; exportHash?: string } | null;
  lastRestart: { at: string; date: string } | null;
}

/**
 * Repartir de zéro : export complet de l'organisation, puis effacement de la
 * comptabilité, de la trésorerie et des caisses. Gérant seulement ; la
 * comptable saisit ensuite ses soldes d'ouverture à la date de reprise.
 */
export function RestartPanel({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [confirm, setConfirm] = useState("");
  const load = useCallback(() => apiJson("/api/accounting/restart").then(d => { if (d?.success === false) setDenied(true); else setP(d?.data ?? null); }).catch(() => setDenied(true)), []);
  useEffect(() => { load(); }, [load]);
  if (denied || !p) return null;

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/restart?export=1", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Export impossible");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `kanoo-export-${todayLocal()}.zip`; a.click();
      URL.revokeObjectURL(a.href);
      showToast("Export téléchargé : gardez-le en lieu sûr (dix ans).", "success");
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : "Export impossible", "error"); }
    finally { setBusy(false); }
  }
  async function restart() {
    setBusy(true);
    const res = await apiSend("POST", "/api/accounting/restart", { exportId: p!.export?.exportId, restartDate: date, confirm });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Reprise refusée.", "error"); return; }
    showToast("Comptabilité, trésorerie et caisses remises à zéro. Saisissez les soldes d'ouverture.", "success");
    setConfirm(""); await load(); onDone();
  }
  const total = p.counts.reduce((t, c) => t + c.count, 0);
  return (
    <section className="surface-card p-5 space-y-4 border border-neg/30">
      <div>
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><RotateCcw size={16} /> Repartir de zéro</h2>
        <p className="text-sm text-ink2">Pour une reprise complète par la comptable : tout est d&apos;abord exporté, puis les écritures, la trésorerie et les caisses sont effacées. Factures, achats, clients, fournisseurs, stock et paie restent. La période avant la date de reprise est ensuite verrouillée.</p>
        {p.lastRestart && <p className="text-xs text-ink3 mt-1">Dernière reprise le {formatDate(p.lastRestart.at)}, à la date du {formatDate(p.lastRestart.date)}.</p>}
      </div>
      <div className="grid sm:grid-cols-3 gap-2 text-sm">
        {p.counts.map(c => <div key={c.key} className="flex justify-between gap-2 border-b border-line py-1"><span className="text-ink2">{c.label}</span><span className="font-mono">{c.count}</span></div>)}
        <div className="flex justify-between gap-2 border-b border-line py-1"><span className="text-ink2">Comptes de trésorerie remis à zéro</span><span className="font-mono">{p.treasuryAccounts}</span></div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">1. Export complet</p>
        <button onClick={download} disabled={busy} className={buttonClass("secondary", "md")}><Download size={15} /> Télécharger toutes les données</button>
        {p.export && <p className="text-xs text-pos">Export fait le {new Date(p.export.exportedAt).toLocaleString("fr-FR")} (valable 24 heures).</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">2. Effacement</p>
        {p.openSessions > 0 && <p className="text-xs text-neg">{p.openSessions} caisse(s) ouverte(s) : fermez-les d&apos;abord.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Date de reprise" hint="Date des soldes d'ouverture ; au plus tard aujourd'hui."><input type="date" className={inputCls} value={date} max={todayLocal()} onChange={e => setDate(e.target.value)} /></FormField>
          <FormField label="Tapez REPRENDRE pour confirmer"><input className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} /></FormField>
        </div>
        <button onClick={restart} disabled={busy || !p.export || confirm !== "REPRENDRE" || p.openSessions > 0 || total + p.treasuryAccounts === 0}
          className={buttonClass("danger", "md")}>Effacer et repartir de zéro</button>
      </div>
    </section>
  );
}
