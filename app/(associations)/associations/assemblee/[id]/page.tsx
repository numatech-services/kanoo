"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Megaphone, Users, Check, Plus, Trash2, Gavel, FileText, Upload, Download } from "lucide-react";

import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
interface Decision { text: string; votes: { for: number; against: number; abstain: number }; passed: boolean }
interface AG {
  _id: string; title: string; type: string; date: string; location?: string;
  convocationSentAt?: string; quorumRequired?: number; quorumAchieved?: number;
  attendees?: string[]; decisions?: Decision[];
  pvFile?: { name?: string; dataUri?: string; uploadedAt?: string };
}
interface Member { _id: string; firstName?: string; lastName?: string; code?: string }

async function csrf() {
  const csrfToken = await getCsrfToken();
  return csrfToken as string;
}

export default function AGDetailPage() {
  const { id } = useParams();
  const [ag, setAg] = useState<AG | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [quorumRequired, setQuorumRequired] = useState(0);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/assemblee/${id}`, { credentials: "include" }).then((r) => r.json()).then((d) => {
      const a: AG = d.data || d;
      setAg(a); setQuorumRequired(a.quorumRequired || 0);
      setAttendees((a.attendees || []).map(String)); setDecisions(a.decisions || []);
    });
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/membres?limit=1000", { credentials: "include" }).then((r) => r.json())
      .then((d) => setMembers(Array.isArray(d.data) ? d.data : d.data?.items || [])).catch(() => {});
  }, []);

  async function patch(body: Partial<AG>, msg: string) {
    setSaving(true); setNotice(null);
    try {
      const res = await fetch(`/api/assemblee/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include", body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Échec");
      setNotice(msg); load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Enregistrement impossible"); } finally { setSaving(false); }
  }

  function toggle(mid: string) {
    setAttendees((a) => (a.includes(mid) ? a.filter((x) => x !== mid) : [...a, mid]));
  }
  function saveAll() {
    patch({ quorumRequired, quorumAchieved: attendees.length, attendees, decisions }, "Modifications enregistrées.");
  }
  function addDecision() {
    setDecisions((d) => [...d, { text: "", votes: { for: 0, against: 0, abstain: 0 }, passed: false }]);
  }
  function updateDecision(i: number, patch: Partial<Decision>) {
    setDecisions((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function updateVote(i: number, key: keyof Decision["votes"], val: number) {
    setDecisions((d) => d.map((x, idx) => (idx === i ? { ...x, votes: { ...x.votes, [key]: val } } : x)));
  }

  function uploadPv(file: File) {
    if (file.size > 2_500_000) { setNotice("PV trop lourd (2,5 Mo max). Réduisez le fichier."); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ pvFile: { name: file.name, dataUri: String(reader.result), uploadedAt: new Date().toISOString() } }, "Procès-verbal enregistré.");
    reader.readAsDataURL(file);
  }

  if (!ag) return <div className="p-6"><div className="h-32 bg-surface rounded-xl animate-pulse" /></div>;
  const name = (m: Member) => [m.firstName, m.lastName].filter(Boolean).join(" ") || m.code || "Membre";
  const quorumOk = attendees.length >= quorumRequired;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div>
        <Link href="/associations/assemblee" className="text-xs text-ink2 hover:text-ink">← Assemblées générales</Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="page-title">{ag.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ag.type === "ordinary" ? "bg-info-50 text-info" : "bg-warn-50 text-warn"}`}>{ag.type === "ordinary" ? "Ordinaire" : "Extraordinaire"}</span>
        </div>
        <p className="text-sm text-ink2">{new Date(ag.date).toLocaleDateString("fr-FR", { dateStyle: "long" })}{ag.location ? ` · ${ag.location}` : ""}</p>
      </div>

      {notice && <p className="px-4 py-2 rounded-lg bg-surface2 border border-line text-sm text-ink">{notice}</p>}

      {/* Convocation */}
      <section className="surface-card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2"><Megaphone size={17} /> Convocation</h2>
          <p className="text-sm text-ink2 mt-0.5">{ag.convocationSentAt ? `Envoyée le ${new Date(ag.convocationSentAt).toLocaleDateString("fr-FR")}.` : "Pas encore envoyée."}</p>
        </div>
        {!ag.convocationSentAt && (
          <button onClick={() => patch({ convocationSentAt: new Date().toISOString() }, "Convocation marquée envoyée.")} disabled={saving}
            className="px-4 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">Marquer envoyée</button>
        )}
      </section>

      {/* Présences & quorum */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink flex items-center gap-2"><Users size={17} /> Présences & quorum</h2>
          <span className={`text-sm font-bold ${quorumOk ? "text-pos" : "text-neg"}`}>{attendees.length} présent{attendees.length > 1 ? "s" : ""} / {quorumRequired} requis</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink2">Quorum requis :</label>
          <input type="number" min={0} value={quorumRequired} onChange={(e) => setQuorumRequired(Number(e.target.value))} className="w-24 p-2 border border-line rounded-lg text-sm" />
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-ink3">Aucun adhérent à afficher.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line2 divide-y divide-line">
            {members.map((m) => (
              <label key={m._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface2/40">
                <input type="checkbox" className="accent-section" checked={attendees.includes(m._id)} onChange={() => toggle(m._id)} />
                <span className="text-ink">{name(m)}</span>{m.code && <span className="text-ink3 text-xs">· {m.code}</span>}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Résolutions & votes */}
      <section className="surface-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink flex items-center gap-2"><Gavel size={17} /> Résolutions & votes</h2>
          <button onClick={addDecision} className="text-sm text-section font-semibold inline-flex items-center gap-1 hover:underline"><Plus size={15} /> Ajouter</button>
        </div>
        {decisions.length === 0 ? (
          <p className="text-sm text-ink3">Aucune résolution. Ajoutez-en pour consigner les votes.</p>
        ) : decisions.map((d, i) => (
          <div key={i} className="rounded-xl border border-line p-3 space-y-2">
            <div className="flex gap-2">
              <input value={d.text} onChange={(e) => updateDecision(i, { text: e.target.value })} placeholder="Intitulé de la résolution"
                className="flex-1 p-2 border border-line rounded-lg text-sm" />
              <button onClick={() => setDecisions((ds) => ds.filter((_, idx) => idx !== i))} className="text-ink3 hover:text-neg"><Trash2 size={15} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {(["for", "against", "abstain"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <span className="text-ink2">{k === "for" ? "Pour" : k === "against" ? "Contre" : "Abst."}</span>
                  <input type="number" min={0} value={d.votes[k]} onChange={(e) => updateVote(i, k, Number(e.target.value))} className="w-16 p-1.5 border border-line rounded text-center" />
                </label>
              ))}
              <label className="flex items-center gap-1.5 ml-auto">
                <input type="checkbox" className="accent-section" checked={d.passed} onChange={(e) => updateDecision(i, { passed: e.target.checked })} />
                <span className={d.passed ? "text-pos font-semibold" : "text-ink2"}>Adoptée</span>
              </label>
            </div>
          </div>
        ))}
      </section>

      {/* Procès-verbal */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink flex items-center gap-2"><FileText size={17} /> Procès-verbal (PV)</h2>
        {ag.pvFile?.dataUri ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a href={ag.pvFile.dataUri} download={ag.pvFile.name || "PV.pdf"}
              className="inline-flex items-center gap-2 text-sm text-section hover:underline">
              <Download size={15} /> {ag.pvFile.name || "Télécharger le PV"}
            </a>
            <div className="flex gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
                <Upload size={14} /> Remplacer
                <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPv(e.target.files[0])} />
              </label>
              <button onClick={() => patch({ pvFile: null } as unknown as Partial<AG>, "PV retiré.")} className="text-xs text-neg hover:underline">Retirer</button>
            </div>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
            <Upload size={15} /> Joindre le PV (PDF ou image, 2,5 Mo max)
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPv(e.target.files[0])} />
          </label>
        )}
      </section>

      <div className="flex justify-end">
        <button onClick={saveAll} disabled={saving}
          className={buttonClass("primary", "md")}>
          <Check size={16} /> {saving ? "Enregistrement…" : "Enregistrer présences & résolutions"}
        </button>
      </div>
    </div>
  );
}
