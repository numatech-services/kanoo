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
  changedSince: number; restartDate: string; interrupted?: boolean;
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
  // Empreinte du fichier réellement reçu : sans elle, l'effacement reste fermé.
  const [received, setReceived] = useState<{ exportId: string; hash: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  // Avancement de l'export : collection en cours et documents reçus.
  const [progress, setProgress] = useState("");
  const load = useCallback(() => apiJson("/api/accounting/restart").then(d => { if (d?.success === false) setDenied(true); else setP(d?.data ?? null); }).catch(() => setDenied(true)), []);
  useEffect(() => { load(); }, [load]);
  if (denied || !p) return null;

  async function post(body: Record<string, unknown>) {
    const res = await apiSend("POST", "/api/accounting/restart", body);
    if (!res.ok) throw new Error(res.data?.error || "Export interrompu : recommencez.");
    return res.data.data;
  }
  async function download() {
    setBusy(true); setReceived(null); setSaved(false);
    try {
      // Morceaux de mille documents : aucune requête ne porte toute l'organisation.
      const start = await post({ action: "export-start" }) as { exportId: string; exportedAt: string; collections: Array<{ name: string; count: number }> };
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const counts: Record<string, number> = {};
      const total = start.collections.reduce((t, c) => t + c.count, 0);
      let done = 0;
      for (const c of start.collections) {
        const parts: string[] = [];
        let after: string | null = null;
        do {
          const chunk = await post({ action: "export-chunk", exportId: start.exportId, collection: c.name, after }) as { docs: string[]; after: string | null };
          parts.push(...chunk.docs); after = chunk.after; done += chunk.docs.length;
          setProgress(`${c.name} — ${done.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")} documents`);
        } while (after);
        counts[c.name] = parts.length;
        zip.file(`${c.name}.json`, `[\n${parts.join(",\n")}\n]`);
      }
      zip.file("LISEZMOI.txt", [
        "Export complet Kanoo", `Coupure : ${start.exportedAt}`,
        "Un fichier par collection, au format EJSON canonique ; mots de passe, empreintes et jetons retirés.",
        "Les justificatifs (fichiers) ne sont pas dans l'archive : leur inventaire est dans attachments.json, ils restent sur le stockage.",
        "À conserver dix ans.", "", ...Object.entries(counts).map(([k, v]) => `${k} : ${v}`),
      ].join("\n"));
      setProgress("Compression de l'archive…");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `kanoo-export-${todayLocal()}.zip`; a.click();
      // URL libérée plus tard : le navigateur doit avoir fini d'écrire le fichier.
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      await post({ action: "export-complete", exportId: start.exportId, counts, hash });
      setReceived({ exportId: start.exportId, hash });
      setProgress("");
      showToast(`Export téléchargé (${total.toLocaleString("fr-FR")} documents) : gardez-le en lieu sûr, et pendant dix ans.`, "success");
      await load();
    } catch (e) { setProgress(""); showToast(e instanceof Error ? e.message : "Export impossible", "error"); }
    finally { setBusy(false); }
  }
  async function restart() {
    setBusy(true);
    const res = await apiSend("POST", "/api/accounting/restart", { action: "restart", exportId: received?.exportId, exportHash: received?.hash, confirm });
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
        {progress && <p className="text-xs text-ink2">{progress}</p>}
        {received && p.export && <p className="text-xs text-pos">Export reçu le {new Date(p.export.exportedAt).toLocaleString("fr-FR")}, valable deux heures.</p>}
        {received && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-section" checked={saved} onChange={e => setSaved(e.target.checked)} /> J&apos;ai enregistré l&apos;archive en lieu sûr (disque, clé ou drive).</label>}
        {p.interrupted && <p className="text-xs text-neg">Une reprise a été interrompue : téléchargez un nouvel export et relancez l&apos;effacement.</p>}
        {received && p.changedSince > 0 && <p className="text-xs text-neg">{p.changedSince} opération(s) saisie(s) depuis l&apos;export : téléchargez-le de nouveau.</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">2. Effacement</p>
        {p.openSessions > 0 && <p className="text-xs text-neg">{p.openSessions} caisse(s) ouverte(s) : fermez-les d&apos;abord.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <p className="text-sm text-ink2 self-end">Date de reprise : <b>{formatDate(p.restartDate)}</b> (aujourd&apos;hui). La comptable y saisit les soldes d&apos;ouverture.</p>
          <FormField label="Tapez REPRENDRE pour confirmer"><input className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} /></FormField>
        </div>
        <button onClick={restart} disabled={busy || !received || !saved || p.changedSince > 0 || confirm !== "REPRENDRE" || p.openSessions > 0 || total + p.treasuryAccounts === 0}
          className={buttonClass("danger", "md")}>Effacer et repartir de zéro</button>
      </div>
    </section>
  );
}
