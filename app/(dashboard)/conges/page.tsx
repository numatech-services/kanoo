"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Check, X, Ban, Trash2 } from "lucide-react";
import { selectCls } from "@/components/ui/FormField";
import { RequestDialog } from "@/components/hr/LeaveRequestDialog";
import { LEAVE_TYPES } from "@/lib/leave-types";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import {apiJson, apiSend } from "@/lib/api-client";
import { buttonClass } from "@/components/ui/button-class";
interface Leave {
  _id: string; type: string; startDate: string; endDate: string; days: number; reason?: string; status: string;
  employeeId?: { _id: string; firstName: string; lastName: string } | null; decisionNote?: string;
  decidedBy?: { firstName?: string; lastName?: string } | null;
}
interface Balance { acquired: number; taken: number; pending: number; available: number }
const STATUS: Record<string, [string, string]> = {
  pending: ["En attente", "bg-warn-50 text-warn"], approved: ["Approuvé", "bg-pos-50 text-pos"],
  rejected: ["Refusé", "bg-neg-50 text-neg"], cancelled: ["Annulé", "bg-surface2 text-ink2"],
};
const d = (s: string) => new Date(s).toLocaleDateString("fr-FR");

/** Congés : mes demandes et mon solde ; pour un responsable, les demandes à valider. */
export default function LeavesPage() {
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const [items, setItems] = useState<Leave[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [hasEmployee, setHasEmployee] = useState(true);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ scope: tab === "mine" ? "mine" : "team" });
    if (status) p.set("status", status);
    const d = await apiJson(`/api/leaves?${p}`).catch(() => null);
    setItems(d?.data?.items ?? []);
    if (tab === "mine") setBalance(d?.data?.balance ?? null);
    setCanDecide(!!d?.data?.canDecide);
    setHasEmployee(!!d?.data?.ownEmployeeId);
  }, [tab, status]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: string) {
    const note = action === "reject" ? await promptDialog({ title: "Motif du refus :", multiline: true }) ?? undefined : undefined;
    if (action === "reject" && !note) return;
    const res = await apiSend("PATCH", `/api/leaves/${id}`, { action, note });
    const x = res.data;
    setMsg(res.ok ? null : { ok: false, text: x.error || "Action refusée" });
    load();
  }
  async function remove(id: string) {
    if (!(await confirmDialog({ title: "Supprimer cette demande ?", danger: true }))) return;
    const res = await apiSend("DELETE", `/api/leaves/${id}`);
    if (!res.ok) { const x = res.data; setMsg({ ok: false, text: x.error || "Suppression refusée" }); }
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><CalendarClock size={22} className="text-section" /> Congés et absences</h1>
          <p className="text-sm text-ink2">30 jours ouvrables par an (2,5 par mois de service). Validation par le chef de service.</p>
        </div>
        {hasEmployee && <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}><Plus size={16} /> Demander un congé</button>}
      </div>
      {!hasEmployee && tab === "mine" && <p className="p-3 rounded-lg bg-warn-50 text-warn text-sm">Votre compte n&apos;est rattaché à aucune fiche salarié : demandez à l&apos;Administration de faire le lien.</p>}
      {msg && <p className={`p-3 rounded-lg text-sm ${msg.ok ? "bg-pos-50 text-pos" : "bg-neg-50 text-neg"}`}>{msg.text}</p>}

      {tab === "mine" && balance && (
        <div className="grid sm:grid-cols-4 gap-4">
          {[["Acquis", balance.acquired], ["Pris", balance.taken], ["En attente", balance.pending], ["Disponible", balance.available]].map(([k, v]) => (
            <div key={String(k)} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className={`text-xl font-bold mt-1 ${k === "Disponible" ? (Number(v) >= 0 ? "text-pos" : "text-neg") : "text-ink"}`}>{v} j</p></div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => setTab("mine")} className={`px-4 h-9 rounded-lg text-sm font-semibold ${tab === "mine" ? "bg-section text-onink" : "border border-line2 text-ink2"}`}>Mes demandes</button>
        {canDecide && <button onClick={() => setTab("team")} className={`px-4 h-9 rounded-lg text-sm font-semibold ${tab === "team" ? "bg-section text-onink" : "border border-line2 text-ink2"}`}>Demandes de l&apos;équipe</button>}
        <select className={`${selectCls} w-auto h-9`} value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous statuts</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-x-auto">
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left">{tab === "team" && <th>Salarié</th>}<th>Type</th><th>Du</th><th>Au</th><th className="text-right">Jours</th><th>Motif</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} className="text-center text-ink3 py-8">Aucune demande</td></tr>}
            {items.map(l => (
              <tr key={l._id} className="border-t border-line">
                {tab === "team" && <td>{l.employeeId ? `${l.employeeId.firstName} ${l.employeeId.lastName}` : "—"}</td>}
                <td className="text-sm">{LEAVE_TYPES[l.type] ?? l.type}</td>
                <td className="text-xs">{d(l.startDate)}</td><td className="text-xs">{d(l.endDate)}</td>
                <td className="text-right font-mono">{l.days}</td>
                <td className="text-xs text-ink2 max-w-[14rem] truncate" title={l.reason}>{l.reason}{l.decisionNote && <span className="block text-ink3">↳ {l.decisionNote}</span>}</td>
                <td><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS[l.status]?.[1]}`}>{STATUS[l.status]?.[0] ?? l.status}</span></td>
                <td className="text-right whitespace-nowrap">
                  {tab === "team" && l.status === "pending" && <>
                    <button onClick={() => act(l._id, "approve")} className="p-1.5 text-pos hover:bg-pos-50 rounded" title="Approuver"><Check size={15} /></button>
                    <button onClick={() => act(l._id, "reject")} className="p-1.5 text-neg hover:bg-neg-50 rounded" title="Refuser"><X size={15} /></button>
                  </>}
                  {["pending", "approved"].includes(l.status) && <button onClick={async () => { if (await confirmDialog({ title: "Annuler ce congé ?", danger: true })) act(l._id, "cancel"); }} className="p-1.5 text-ink3 hover:text-warn" title="Annuler"><Ban size={14} /></button>}
                  {l.status === "pending" && tab === "mine" && <button onClick={() => remove(l._id)} className="p-1.5 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <RequestDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); setTab("mine"); load(); }} />}
    </div>
  );
}
