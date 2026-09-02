"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import {
  Calendar, MapPin, Video, Users, UserCheck, UserX, Wallet, ScanLine,
  Plus, Download, X, ArrowLeft, Ticket, Mail, FileDown, CreditCard, RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";

interface Ev {
  _id: string; title: string; description?: string; startAt: string; endAt?: string;
  locationType: string; address?: string; meetingLink?: string; capacity: number;
  status: string; isPaid: boolean; visibility: string;
  ticketTypes: { _id: string; name: string; price: number; quantity: number }[];
}
interface Attendee {
  _id: string; firstName: string; lastName: string; email?: string; phone?: string;
  ticketTypeName?: string; amount: number; status: string; checkedInAt?: string; ticketCode: string;
}
interface Stats { total: number; present: number; registered: number; absent: number; cancelled: number; refunded: number; revenue: number; }

const A_STATUS: Record<string, { label: string; cls: string }> = {
  registered: { label: "Inscrit", cls: "badge-sent" },
  paid: { label: "Payé", cls: "badge-paid" },
  present: { label: "Présent", cls: "badge-paid" },
  cancelled: { label: "Annulé", cls: "badge-draft" },
  refunded: { label: "Remboursé", cls: "badge-late" },
};

function TicketQR({ payload }: { payload: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    QRCode.toDataURL(payload, { margin: 1, width: 240, color: { dark: "#17130E", light: "#FFFFFF" } })
      .then(setUrl).catch(() => {});
  }, [payload]);
  return url ? <img src={url} alt="QR code du billet" width={200} height={200} className="rounded-md border border-line" /> : <div className="w-[200px] h-[200px] bg-surface2 rounded-md animate-pulse" />;
}

export default function ActiviteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<Ev | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showReg, setShowReg] = useState(false);
  const [reg, setReg] = useState({ firstName: "", lastName: "", email: "", phone: "", ticketTypeId: "", markPaid: false, checkin: false });
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState<{ name: string; payload: string; code: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [evRes, atRes] = await Promise.all([
        fetch(`/api/events/${id}`, { credentials: "include" }),
        fetch(`/api/events/${id}/attendees${filter ? `?status=${filter}` : ""}`, { credentials: "include" }),
      ]);
      const evD = await evRes.json();
      const atD = await atRes.json();
      if (evRes.ok) setEv(evD.data);
      if (atRes.ok) { setAttendees(atD.data.attendees || []); setStats(atD.data.stats); }
    } catch { toast.error("Erreur de chargement"); } finally { setLoading(false); }
  }, [id, filter]);

  useEffect(() => { load(); }, [load]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!reg.firstName.trim() || !reg.lastName.trim()) { toast.error("Nom et prénom requis"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${id}/attendees`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(reg),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Inscription impossible");
      toast.success("Participant inscrit");
      setTicket({ name: `${reg.firstName} ${reg.lastName}`, payload: d.data.qrPayload, code: d.data.attendee.ticketCode });
      setReg({ firstName: "", lastName: "", email: "", phone: "", ticketTypeId: "", markPaid: false, checkin: false });
      setShowReg(false);
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erreur"); } finally { setSaving(false); }
  }

  async function pay(attendeeId: string) {
    const tid = toast.loading("Initialisation du paiement…");
    try {
      const res = await fetch(`/api/events/${id}/attendees/${attendeeId}/pay`, { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      toast.success("Redirection vers le paiement…", { id: tid });
      window.open(d.data.paymentUrl, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur", { id: tid });
    }
  }

  async function resend(attendeeId: string) {
    const tid = toast.loading("Envoi du billet…");
    try {
      const res = await fetch(`/api/events/${id}/attendees/${attendeeId}/ticket`, { method: "POST", credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec de l'envoi");
      toast.success("Billet renvoyé par email", { id: tid });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur", { id: tid });
    }
  }

  async function refund(attendeeId: string) {
    if (!confirm("Rembourser ce billet ? Il sera invalidé et la place libérée.")) return;
    const tid = toast.loading("Remboursement…");
    try {
      const res = await fetch(`/api/events/${id}/attendees/${attendeeId}/refund`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec");
      toast.success("Billet remboursé", { id: tid });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur", { id: tid });
    }
  }

  function exportCsv(scope: "all" | "present" | "absent") {
    const rows = attendees.filter((a) =>
      scope === "all" ? true : scope === "present" ? a.status === "present" : a.status !== "present" && a.status !== "cancelled" && a.status !== "refunded"
    );
    const header = ["Prénom", "Nom", "Email", "Téléphone", "Billet", "Montant", "Statut", "Pointé le"];
    const csv = [header.join(";"), ...rows.map((a) => [
      a.firstName, a.lastName, a.email || "", a.phone || "", a.ticketTypeName || "", a.amount || 0,
      A_STATUS[a.status]?.label || a.status, a.checkedInAt ? new Date(a.checkedInAt).toLocaleString("fr-FR") : "",
    ].join(";"))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${scope}-${ev?.title || "activite"}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="max-w-5xl space-y-4"><div className="h-24 bg-surface rounded-lg border border-line animate-pulse" /><div className="h-64 bg-surface rounded-lg border border-line animate-pulse" /></div>;
  if (!ev) return <div className="text-center py-20 text-ink2">Activité introuvable. <Link href="/activites" className="text-accent-700 font-semibold">Retour</Link></div>;

  const participation = stats && stats.total > 0 ? Math.round((stats.present / Math.max(1, stats.total - stats.cancelled - stats.refunded)) * 100) : 0;

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/activites" className="inline-flex items-center gap-1.5 text-sm text-ink2 hover:text-ink"><ArrowLeft size={15} /> Activités</Link>

      {/* Header */}
      <div className="card card-p flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge ${A_STATUS[ev.status]?.cls || "badge-draft"}`}>{ev.status}</span>
            {ev.isPaid && <span className="badge badge-warn"><Ticket size={11} /> Payant</span>}
            <span className="text-xs text-ink3">{ev.visibility === "private" ? "Sur invitation" : "Public"}</span>
          </div>
          <h1 className="page-title">{ev.title}</h1>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-ink2">
            <span className="flex items-center gap-1.5"><Calendar size={14} className="text-ink3" /> {new Date(ev.startAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
            <span className="flex items-center gap-1.5">{ev.locationType === "online" ? <Video size={14} className="text-ink3" /> : <MapPin size={14} className="text-ink3" />} {ev.locationType === "online" ? (ev.meetingLink || "En ligne") : (ev.address || "Lieu à préciser")}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/activites/${id}/checkin`} className="btn-secondary"><ScanLine size={16} /> Check-in</Link>
          <button onClick={() => setShowReg(true)} className="btn-primary"><Plus size={16} /> Inscrire</button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { ic: <Users size={16} />, label: "Inscrits", value: stats.total - stats.cancelled - stats.refunded },
            { ic: <UserCheck size={16} />, label: "Présents", value: stats.present },
            { ic: <UserX size={16} />, label: "Absents", value: stats.absent },
            { ic: <Wallet size={16} />, label: "Recette", value: `${stats.revenue.toLocaleString("fr-FR")} F` },
          ].map((s, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 text-ink2 text-xs font-medium"><span className="w-7 h-7 rounded-md bg-accent-50 text-accent-700 grid place-items-center">{s.ic}</span>{s.label}</div>
              <div className="font-display text-2xl font-semibold mt-2 num">{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {stats && (
        <div className="card card-p">
          <div className="flex items-center justify-between text-sm mb-2"><span className="font-semibold">Taux de participation</span><span className="num text-accent-700 font-semibold">{participation}%</span></div>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${participation}%` }} /></div>
        </div>
      )}

      {/* Attendees */}
      <div className="card">
        <div className="flex items-center justify-between p-4 border-b border-line flex-wrap gap-2">
          <h3 className="section-title">Participants</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 px-2 rounded-md border border-line2 bg-surface text-sm text-ink">
              <option value="">Tous</option><option value="present">Présents</option><option value="registered">Inscrits</option><option value="paid">Payés</option><option value="cancelled">Annulés</option>
            </select>
            <button onClick={() => exportCsv("all")} className="btn-secondary h-9"><Download size={14} /> Tous</button>
            <button onClick={() => exportCsv("present")} className="btn-secondary h-9">Présents</button>
            <button onClick={() => exportCsv("absent")} className="btn-secondary h-9">Absents</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink3 bg-surface2">
              <th className="px-4 py-2.5 font-semibold">Participant</th><th className="px-4 py-2.5 font-semibold">Contact</th><th className="px-4 py-2.5 font-semibold">Billet</th><th className="px-4 py-2.5 font-semibold">Statut</th><th className="px-4 py-2.5 font-semibold">Pointé</th><th className="px-4 py-2.5 font-semibold text-right">Billet</th>
            </tr></thead>
            <tbody>
              {attendees.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink2">Aucun participant. Cliquez sur « Inscrire » pour ajouter le premier.</td></tr>
              ) : attendees.map((a) => (
                <tr key={a._id} className="border-t border-line hover:bg-surface2">
                  <td className="px-4 py-3 font-medium">{a.firstName} {a.lastName}<div className="text-xs text-ink3 font-mono">{a.ticketCode}</div></td>
                  <td className="px-4 py-3 text-ink2">{a.email || a.phone || "—"}</td>
                  <td className="px-4 py-3 text-ink2">{a.ticketTypeName || (ev.isPaid ? "—" : "Gratuit")}{a.amount ? <span className="num"> · {a.amount.toLocaleString("fr-FR")} F</span> : ""}</td>
                  <td className="px-4 py-3"><span className={`badge ${A_STATUS[a.status]?.cls || "badge-draft"}`}>{A_STATUS[a.status]?.label || a.status}</span></td>
                  <td className="px-4 py-3 text-ink2 num">{a.checkedInAt ? new Date(a.checkedInAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {ev.isPaid && a.status === "registered" && (
                        <button onClick={() => pay(a._id)} title="Payer en ligne (mobile money / carte)" className="w-8 h-8 grid place-items-center rounded-md border border-line2 text-accent-700 hover:bg-accent-50"><CreditCard size={14} /></button>
                      )}
                      <a href={`/api/events/${id}/attendees/${a._id}/ticket`} title="Télécharger le billet PDF" className="w-8 h-8 grid place-items-center rounded-md border border-line2 text-ink2 hover:bg-surface2"><FileDown size={14} /></a>
                      <button onClick={() => resend(a._id)} disabled={!a.email} title={a.email ? "Renvoyer par email" : "Pas d'email"} className="w-8 h-8 grid place-items-center rounded-md border border-line2 text-ink2 hover:bg-surface2 disabled:opacity-40"><Mail size={14} /></button>
                      {["paid", "present"].includes(a.status) && (
                        <button onClick={() => refund(a._id)} title="Rembourser" className="w-8 h-8 grid place-items-center rounded-md border border-line2 text-neg hover:bg-neg-50"><RotateCcw size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal inscription */}
      {showReg && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setShowReg(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={register} className="bg-surface rounded-lg border border-line shadow-soft w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between"><h3 className="section-title">Inscrire un participant</h3><button type="button" onClick={() => setShowReg(false)}><X size={18} className="text-ink2" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder="Prénom *" value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: e.target.value })} />
              <input className="input" placeholder="Nom *" value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: e.target.value })} />
            </div>
            <input className="input" placeholder="Email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
            <input className="input" placeholder="Téléphone" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} />
            {ev.isPaid && (
              <select className="input" value={reg.ticketTypeId} onChange={(e) => setReg({ ...reg, ticketTypeId: e.target.value })}>
                <option value="">— Type de billet —</option>
                {ev.ticketTypes.map((t) => <option key={t._id} value={t._id}>{t.name} — {t.price.toLocaleString("fr-FR")} F</option>)}
              </select>
            )}
            {/* Vente sur place */}
            <div className="rounded-md bg-surface2 border border-line p-3 space-y-2">
              <p className="text-xs font-semibold text-ink2">Vente sur place</p>
              {ev.isPaid && (
                <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={reg.markPaid} onChange={(e) => setReg({ ...reg, markPaid: e.target.checked })} className="w-4 h-4 accent-accent" />
                  Réglé sur place (espèces)
                </label>
              )}
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input type="checkbox" checked={reg.checkin} onChange={(e) => setReg({ ...reg, checkin: e.target.checked })} className="w-4 h-4 accent-accent" />
                Entrée immédiate (marquer présent)
              </label>
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? "Inscription…" : reg.checkin ? "Inscrire & pointer l'entrée" : "Inscrire & générer le billet"}</button>
          </form>
        </div>
      )}

      {/* Modal billet (QR) */}
      {ticket && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setTicket(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-surface rounded-lg border border-line shadow-soft w-full max-w-sm p-6 text-center space-y-3">
            <div className="flex items-center justify-between"><h3 className="section-title">Billet émis</h3><button onClick={() => setTicket(null)}><X size={18} className="text-ink2" /></button></div>
            <p className="text-sm text-ink2">{ticket.name}</p>
            <div className="grid place-items-center"><TicketQR payload={ticket.payload} /></div>
            <p className="text-xs text-ink2">Code de secours</p>
            <p className="font-mono text-lg font-semibold tracking-wider">{ticket.code}</p>
            <p className="text-xs text-ink3">Présentez ce QR à l'entrée. L'envoi email/WhatsApp sera automatisé dans une phase dédiée.</p>
          </div>
        </div>
      )}
    </div>
  );
}
