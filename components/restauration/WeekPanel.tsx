"use client";
import { CalendarCheck } from "lucide-react";
import { Pill } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";

interface Week { last: { weekEnd: string; closedAt: string; summary: { stockValue: number; gapValue: number } } | null; day: string; blockers: string[]; warnings: string[]; canClose: boolean; threshold: number | null; canManage: boolean }
const DAY = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR");

/** La semaine du site : ce qui reste à faire avant de clôturer, puis la clôture. Le stock restant repart tel quel. */
export function WeekPanel({ deskId, costs }: { deskId: string; costs: boolean }) {
  const { data, reload } = useApi<Week | null>(`/api/restauration/semaine?deskId=${deskId}`, d => (d?.data as Week) ?? null, null, { quiet: true });
  if (!data) return null;
  async function post(body: Record<string, unknown>, msg: string) {
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/semaine", { deskId, ...body });
    if (!r.ok) return showToast(r.data.error || "Refusé", "error");
    showToast(msg, "success"); reload();
  }
  async function close() {
    if (await confirmDialog({ title: `Clôturer la semaine au ${DAY(data!.day)} ?`, message: "Toute la journée est arrêtée : plus de vente, de dépense ni de réception à cette date, jusqu'à une réouverture par la comptabilité. Le stock restant est conservé." })) post({ action: "close" }, "Semaine clôturée");
  }
  async function reopen() {
    const reason = await promptDialog({ title: "Rouvrir la semaine", label: "Motif", required: true, multiline: true });
    if (reason) post({ action: "reopen", weekEnd: data!.last!.weekEnd, reason }, "Semaine rouverte");
  }
  async function threshold() {
    const v = await promptDialog({ title: "Seuil d'écart d'inventaire (FCFA)", message: "Au-delà, la validation revient à la direction ou à la comptabilité.", label: "Seuil", type: "number", defaultValue: String(data!.threshold ?? ""), required: true });
    if (v) post({ action: "threshold", value: Number(v) }, "Seuil enregistré");
  }
  return (
    <section className="surface-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink inline-flex items-center gap-2"><CalendarCheck size={16} /> Fin de semaine</p>
        {data.last ? <Pill tone="mute">close au {DAY(data.last.weekEnd)}</Pill> : <Pill tone="info">jamais clôturée</Pill>}
      </div>
      {data.blockers.length > 0 && <ul className="text-sm text-ink2 list-disc pl-5">{data.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
      {data.warnings.map(w => <p key={w} className="text-[12px] text-warn">{w}</p>)}
      {costs && <div className="flex gap-2 flex-wrap">
        <button disabled={!data.canClose} onClick={close} className={buttonClass("primary", "sm")}>Clôturer la semaine</button>
        {data.last && data.canManage && <button onClick={reopen} className={buttonClass("ghost", "sm")}>Rouvrir</button>}
        {data.canManage && <button onClick={threshold} className={buttonClass("ghost", "sm")}>Seuil d&apos;écart : {data.threshold === null ? "aucun" : `${data.threshold.toLocaleString("fr-FR")} FCFA`}</button>}
      </div>}
    </section>
  );
}
