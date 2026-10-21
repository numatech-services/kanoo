"use client";
import { useCallback, useEffect, useState } from "react";
import { Bug, CheckCircle2, RotateCcw } from "lucide-react";
import { apiJson, apiSend } from "@/lib/api-client";
import { buttonClass } from "@/components/ui/button-class";

interface ErrorItem {
  _id: string; source: "api" | "render" | "client" | "csp"; message: string; stack?: string; url?: string;
  lastRef?: string; userAgent?: string; count: number; firstAt: string; lastAt: string; resolvedAt?: string;
}
const SOURCE: Record<ErrorItem["source"], string> = { api: "API", render: "Rendu serveur", client: "Navigateur", csp: "CSP" };
const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** Journal des erreurs de la plateforme, regroupées (lib/error-log.ts). */
export default function ErrorsPage() {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState("");
  const [resolved, setResolved] = useState(false);
  const [data, setData] = useState<{ items: ErrorItem[]; totals: Array<{ _id: string; groups: number; occurrences: number }> } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson(`/api/superadmin/errors?days=${days}${source ? `&source=${source}` : ""}${resolved ? "&resolved=1" : ""}`).then(d => setData(d.data)).catch(() => setData({ items: [], totals: [] }));
  }, [days, source, resolved]);
  useEffect(() => { load(); }, [load]);

  async function mark(id: string, r: boolean) {
    await apiSend("PATCH", "/api/superadmin/errors", { id, resolved: r });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2"><Bug size={22} /> Journal des erreurs</h1>
        <p className="text-sm text-ink2 mt-1">Erreurs des API, du rendu serveur, des navigateurs et violations CSP, regroupées. Une erreur résolue qui se reproduit revient dans la liste.</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {[1, 7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={buttonClass(days === d ? "primary" : "secondary", "sm")}>{d === 1 ? "24 h" : `${d} j`}</button>)}
        <span className="w-px h-6 bg-line mx-1" />
        {[["", "Toutes"], ["api", "API"], ["render", "Rendu"], ["client", "Navigateur"], ["csp", "CSP"]].map(([v, l]) => (
          <button key={v} onClick={() => setSource(v)} className={buttonClass(source === v ? "primary" : "secondary", "sm")}>{l}</button>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-ink2 ml-2"><input type="checkbox" className="accent-section" checked={resolved} onChange={e => setResolved(e.target.checked)} /> Inclure les résolues</label>
      </div>
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["api", "render", "client", "csp"] as const).map(s => {
            const t = data.totals.find(x => x._id === s);
            return <div key={s} className="surface-card p-4"><p className="text-xs text-ink3">{SOURCE[s]}</p><p className="text-xl font-bold num text-ink">{t?.groups ?? 0}</p><p className="text-xs text-ink2">{t?.occurrences ?? 0} occurrence(s)</p></div>;
          })}
        </div>
      )}
      {!data ? <div className="h-40 surface-card animate-pulse" /> : data.items.length === 0 ? (
        <p className="text-sm text-ink3 surface-card p-6 text-center">Aucune erreur sur la période. 🎉</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map(e => (
            <li key={e._id} className={`surface-card p-4 ${e.resolvedAt ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neg-50 text-neg">{SOURCE[e.source]}</span>
                <button className="flex-1 min-w-[14rem] text-left" onClick={() => setOpen(open === e._id ? null : e._id)}>
                  <p className="text-sm font-semibold text-ink break-words">{e.message}</p>
                  <p className="text-xs text-ink2">{e.count} fois · dernière {fmt(e.lastAt)} · première {fmt(e.firstAt)}{e.url ? ` · ${e.url}` : ""}{e.lastRef ? ` · réf. ${e.lastRef}` : ""}</p>
                </button>
                {e.resolvedAt
                  ? <button onClick={() => mark(e._id, false)} className={buttonClass("secondary", "sm")}><RotateCcw size={13} /> Rouvrir</button>
                  : <button onClick={() => mark(e._id, true)} className={buttonClass("secondary", "sm")}><CheckCircle2 size={13} /> Résolue</button>}
              </div>
              {open === e._id && (e.stack || e.userAgent) && (
                <pre className="mt-3 text-[11px] leading-relaxed bg-surface2 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">{e.stack}{e.userAgent ? `\n\n${e.userAgent}` : ""}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
