"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, ArrowLeft, Keyboard, Camera, Wifi, WifiOff, DownloadCloud, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

interface Result { valid: boolean; reason?: string; name?: string; ticketTypeName?: string; offline?: boolean }
interface Ticket { code: string; name: string; present: boolean }
interface Manifest { ts: number; byId: Record<string, Ticket>; byCode: Record<string, string> }
interface QueueItem { code: string; at: number }

// Parse local du QR (pas de vérif de signature côté client — faite au serveur).
function parseQr(payload: string): { id: string; code: string } | null {
  const p = payload.trim().split(".");
  if (p.length !== 4 || p[0] !== "KANOO1") return null;
  return { id: p[1], code: p[2] };
}

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220;
    o.type = "sine";
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
  } catch { /* audio indisponible */ }
}

export default function CheckinPage() {
  const { id } = useParams<{ id: string }>();
  const MKEY = `kanoo:manifest:${id}`;
  const QKEY = `kanoo:queue:${id}`;

  const [result, setResult] = useState<Result | null>(null);
  const [count, setCount] = useState(0);
  const [manual, setManual] = useState("");
  const [camActive, setCamActive] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [cached, setCached] = useState(0);
  const [pending, setPending] = useState(0);
  const [preparing, setPreparing] = useState(false);

  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const readManifest = useCallback((): Manifest | null => {
    try { const s = localStorage.getItem(MKEY); return s ? JSON.parse(s) : null; } catch { return null; }
  }, [MKEY]);
  const writeManifest = useCallback((m: Manifest) => { try { localStorage.setItem(MKEY, JSON.stringify(m)); } catch { /* quota */ } }, [MKEY]);
  const readQueue = useCallback((): QueueItem[] => { try { const s = localStorage.getItem(QKEY); return s ? JSON.parse(s) : []; } catch { return []; } }, [QKEY]);
  const writeQueue = useCallback((q: QueueItem[]) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); setPending(q.length); } catch { /* quota */ } }, [QKEY]);

  // Synchronise la file des pointages hors-ligne.
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    let q = readQueue();
    if (q.length === 0) return;
    for (const item of [...q]) {
      try {
        const res = await fetch(`/api/events/${id}/checkin`, {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ code: item.code }),
        });
        if (res.ok) { q = q.filter((x) => x.at !== item.at); writeQueue(q); }
      } catch { break; } // encore hors-ligne : on réessaiera
    }
    if (q.length === 0) toast.success("Pointages synchronisés");
  }, [id, readQueue, writeQueue]);

  // Prépare le hors-ligne : télécharge le manifeste des billets.
  const prepareOffline = useCallback(async () => {
    setPreparing(true);
    try {
      const res = await fetch(`/api/events/${id}/checkin/manifest`, { credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      const byId: Record<string, Ticket> = {};
      const byCode: Record<string, string> = {};
      for (const t of d.data.tickets as Array<{ id: string; code: string; name: string; present: boolean }>) {
        byId[t.id] = { code: t.code, name: t.name, present: t.present };
        byCode[t.code] = t.id;
      }
      writeManifest({ ts: Date.now(), byId, byCode });
      setCached(d.data.count);
      toast.success(`${d.data.count} billets prêts pour le hors-ligne`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally { setPreparing(false); }
  }, [id, writeManifest]);

  // Validation locale (hors-ligne) contre le manifeste + mise en file.
  const localValidate = useCallback((idFromQr: string | undefined, code: string): Result => {
    const m = readManifest();
    if (!m) return { valid: false, reason: "Liste non préparée pour le hors-ligne", offline: true };
    const ticketId = idFromQr && m.byId[idFromQr] ? idFromQr : m.byCode[code];
    const ticket = ticketId ? m.byId[ticketId] : undefined;
    if (!ticket) return { valid: false, reason: "Billet inconnu", offline: true };
    if (idFromQr && ticket.code !== code) return { valid: false, reason: "Billet non valide", offline: true };
    if (ticket.present) return { valid: false, reason: "Déjà pointé", name: ticket.name, offline: true };
    ticket.present = true;
    writeManifest(m);
    const q = readQueue(); q.push({ code: ticket.code, at: Date.now() }); writeQueue(q);
    return { valid: true, name: ticket.name, offline: true };
  }, [readManifest, writeManifest, readQueue, writeQueue]);

  const verify = useCallback(async (payload?: string, codeInput?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const parsed = payload ? parseQr(payload) : null;
    const code = (codeInput || parsed?.code || "").trim().toUpperCase();

    const finish = (r: Result) => {
      setResult(r);
      if (r.valid) setCount((c) => c + 1);
      beep(r.valid);
      setTimeout(() => { setResult(null); busyRef.current = false; }, 1700);
    };

    if (navigator.onLine) {
      try {
        const res = await fetch(`/api/events/${id}/checkin`, {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify(payload ? { payload } : { code }),
        });
        const d = await res.json();
        const r: Result = res.ok ? d.data : { valid: false, reason: d.error || "Erreur" };
        // Tenir le manifeste local à jour si présent.
        const m = readManifest();
        if (m && r.valid) { const tid = m.byCode[code]; if (tid && m.byId[tid]) { m.byId[tid].present = true; writeManifest(m); } }
        finish({ ...r, name: r.name || (r as { attendee?: { firstName?: string; lastName?: string } }).attendee?.firstName });
        return;
      } catch {
        // réseau tombé : bascule hors-ligne
      }
    }
    finish(localValidate(parsed?.id, code));
  }, [id, localValidate, readManifest, writeManifest]);

  // Caméra (import dynamique — pas de SSR).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new mod.Html5Qrcode("qr-reader");
        scannerRef.current = { stop: () => scanner.stop(), clear: () => scanner.clear() };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded: string) => {
            const now = Date.now();
            if (decoded === lastRef.current.code && now - lastRef.current.at < 2500) return;
            lastRef.current = { code: decoded, at: now };
            verify(decoded);
          },
          () => { /* pas de QR : ignoré */ }
        );
        setCamActive(true);
      } catch {
        setError("Caméra inaccessible. Autorisez l'accès ou utilisez la saisie manuelle.");
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) { s.stop().then(() => s.clear()).catch(() => {}); }
    };
  }, [verify]);

  // État réseau + init compteurs + sync auto au retour en ligne.
  useEffect(() => {
    setOnline(navigator.onLine);
    setCached(Object.keys(readManifest()?.byId || {}).length);
    setPending(readQueue().length);
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) sync();
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [readManifest, readQueue, sync]);

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link href={`/activites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-ink2 hover:text-ink"><ArrowLeft size={15} /> Retour</Link>
        <span className="text-sm text-ink2">Validés : <b className="num text-accent-700">{count}</b></span>
      </div>

      <div>
        <h1 className="page-title flex items-center gap-2"><Camera size={22} /> Contrôle des entrées</h1>
        <p className="text-sm text-ink2 mt-0.5">Scannez le QR du billet. Fonctionne dans le navigateur, même hors-ligne.</p>
      </div>

      {/* Barre d'état réseau / hors-ligne */}
      <div className="card p-3 flex items-center gap-3 text-sm flex-wrap">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${online ? "text-acacia" : "text-warn"}`}>
          {online ? <Wifi size={15} /> : <WifiOff size={15} />} {online ? "En ligne" : "Hors-ligne"}
        </span>
        <span className="text-ink2">Cache : <b className="num">{cached}</b> billets</span>
        {pending > 0 && <span className="text-warn">À synchroniser : <b className="num">{pending}</b></span>}
        <div className="ml-auto flex gap-2">
          <button onClick={prepareOffline} disabled={preparing || !online} className="btn-secondary h-8 text-xs disabled:opacity-40"><DownloadCloud size={13} /> {preparing ? "…" : "Préparer hors-ligne"}</button>
          {pending > 0 && <button onClick={sync} disabled={!online} className="btn-secondary h-8 text-xs disabled:opacity-40"><RefreshCw size={13} /> Sync</button>}
        </div>
      </div>

      {/* Caméra + overlay résultat */}
      <div className="relative rounded-lg overflow-hidden border border-line bg-ink aspect-square">
        <div id="qr-reader" className="w-full h-full [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />
        {!camActive && !error && <div className="absolute inset-0 grid place-items-center text-bg/70 text-sm">Initialisation de la caméra…</div>}
        {error && <div className="absolute inset-0 grid place-items-center text-center p-6 text-bg/80 text-sm">{error}</div>}
        {result && (
          <div className={`absolute inset-0 grid place-items-center text-center p-6 ${result.valid ? "bg-acacia/95" : "bg-neg/95"}`}>
            <div className="text-white">
              {result.valid ? <CheckCircle2 size={64} className="mx-auto" /> : <XCircle size={64} className="mx-auto" />}
              <p className="font-display text-2xl font-semibold mt-3">{result.valid ? "Valide" : (result.reason || "Refusé")}</p>
              {result.name && <p className="text-lg mt-1">{result.name}</p>}
              {result.offline && <p className="text-xs opacity-80 mt-1">enregistré hors-ligne</p>}
            </div>
          </div>
        )}
      </div>

      {/* Saisie manuelle */}
      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { verify(undefined, manual.trim()); setManual(""); } }} className="card card-p">
        <label className="label flex items-center gap-1.5"><Keyboard size={14} /> Code de secours (si le QR est illisible)</label>
        <div className="flex gap-2">
          <input className="input font-mono uppercase" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="XXXXX-XXXXX" />
          <button type="submit" className="btn-primary">Valider</button>
        </div>
      </form>
    </div>
  );
}
