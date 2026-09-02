"use client";
import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

interface Opp {
  _id: string; reference: string; title: string; stage: string;
  estimatedAmount: number; probability: number; expectedCloseDate?: string;
  nextFollowUpDate?: string; companyName?: string; contactName?: string;
  clientId?: { name: string }; assignedTo?: { firstName: string; lastName: string };
}
interface Stats { totalPipelineValue?: number; weightedValue?: number; count?: number; }
type Pipeline = Record<string, Opp[]>;

const STAGES: Array<{ key: string; label: string; color: string; bg: string }> = [
  { key:"prospect",    label:"Prospect",      color:"text-gray-700",   bg:"bg-gray-100"   },
  { key:"qualified",   label:"Qualifié",      color:"text-blue-700",   bg:"bg-blue-100"   },
  { key:"proposal",    label:"Devis envoyé",  color:"text-purple-700", bg:"bg-purple-100" },
  { key:"negotiation", label:"Négociation",   color:"text-amber-700",  bg:"bg-amber-100"  },
  { key:"won",         label:"Gagné",         color:"text-green-700",  bg:"bg-green-100"  },
  { key:"lost",        label:"Perdu",         color:"text-red-600",    bg:"bg-red-100"    },
];

export default function CRMPage() {
  const [mounted, setMounted] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline>({});
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", stage: "prospect", estimatedAmount: 0, probability: 50,
    companyName: "", contactName: "", contactEmail: "", contactPhone: "",
    expectedCloseDate: "", nextFollowUpDate: "", source: "outbound", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/crm/opportunities?view=pipeline", { credentials: "include" });
    const d = await res.json();
    setPipeline(d.data?.pipeline || {});
    setStats(d.data?.stats || {});
    setLoading(false);
  }, []);
  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const u = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch("/api/crm/opportunities", {
      method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify(form),
    });
    setModalOpen(false); setSaving(false); load();
  }

  async function moveStage(oppId: string, newStage: string) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch(`/api/crm/opportunities/${oppId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include", body: JSON.stringify({ stage: newStage }),
    });
    load();
  }

  function isOverdue(date?: string): boolean {
    if (!date) return false;
    return new Date(date) < new Date();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Pipeline commercial</h1>
          <p className="text-sm text-moss">CRM · Suivez vos opportunités de la prospection à la signature</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouvelle opportunité</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss">Valeur totale pipeline</p>
          <p className="text-xl font-bold font-mono text-ink mt-1">{((stats.totalPipelineValue||0)/1_000_000).toFixed(1)}M XOF</p>
        </div>
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss">Valeur pondérée (probabilités)</p>
          <p className="text-xl font-bold font-mono text-green-700 mt-1">{((stats.weightedValue||0)/1_000_000).toFixed(1)}M XOF</p>
        </div>
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss">Opportunités actives</p>
          <p className="text-xl font-bold text-ink mt-1">{stats.count || 0}</p>
        </div>
      </div>

      {/* Kanban */}
      {loading ? (
        <div className="grid grid-cols-6 gap-3">{STAGES.map(s => <div key={s.key} className="h-96 bg-white rounded-xl animate-pulse border border-clay/20"/>)}</div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
          {STAGES.map(stage => {
            const opps = pipeline[stage.key] || [];
            const stageValue = opps.reduce((s, o) => s + o.estimatedAmount, 0);
            return (
              <div key={stage.key}
                className="bg-sand rounded-xl border border-clay/20 min-h-[400px]"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (dragging) moveStage(dragging, stage.key); setDragging(null); }}
              >
                <div className="px-3 py-3 border-b border-clay/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stage.bg} ${stage.color}`}>{stage.label}</span>
                    <span className="text-xs text-moss font-medium">{opps.length}</span>
                  </div>
                  {stageValue > 0 && <p className="text-xs font-mono text-moss">{(stageValue/1_000_000).toFixed(1)}M XOF</p>}
                </div>
                <div className="p-2 flex flex-col gap-2">
                  {opps.map(opp => (
                    <div key={opp._id}
                      draggable
                      onDragStart={() => setDragging(opp._id)}
                      onDragEnd={() => setDragging(null)}
                      className={`bg-white rounded-lg border border-clay/20 p-3 cursor-grab active:cursor-grabbing hover:border-cedar/40 transition-colors ${dragging === opp._id ? "opacity-50" : ""}`}
                    >
                      <p className="font-medium text-ink text-xs leading-tight">{opp.title}</p>
                      <p className="text-xs text-moss mt-0.5 truncate">{opp.clientId?.name || opp.companyName || "—"}</p>
                      {opp.estimatedAmount > 0 && (
                        <p className="text-xs font-mono font-medium text-cedar mt-1.5">{opp.estimatedAmount.toLocaleString("fr-FR")} XOF</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1 bg-clay/20 rounded-full">
                          <div className="h-1 bg-cedar rounded-full" style={{ width: `${opp.probability}%` }}/>
                        </div>
                        <span className="text-xs text-moss">{opp.probability}%</span>
                      </div>
                      {opp.nextFollowUpDate && (
                        <p className={`text-xs mt-1.5 ${isOverdue(opp.nextFollowUpDate) ? "text-red-600 font-medium" : "text-moss"}`}>
                          {isOverdue(opp.nextFollowUpDate) ? "⏰ " : ""}Relance : {new Date(opp.nextFollowUpDate).toLocaleDateString("fr-FR")}
                        </p>
                      )}
                      {/* Mini-sélecteur de stage rapide */}
                      <select
                        value={opp.stage}
                        onChange={e => moveStage(opp._id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="mt-2 w-full text-xs border border-clay/20 rounded-lg px-1.5 py-1 bg-sand text-moss focus:outline-none"
                      >
                        {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </div>
                  ))}
                  {opps.length === 0 && (
                    <p className="text-xs text-moss text-center py-6 opacity-60">Aucune opportunité</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle opportunité" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <FormField label="Titre de l'opportunité" required>
            <input className={inputCls} value={form.title} onChange={e=>u("title",e.target.value)} required placeholder="Ex: Fourniture matériel informatique — Ministère"/>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Étape pipeline">
              <select className={selectCls} value={form.stage} onChange={e=>u("stage",e.target.value)}>
                {STAGES.filter(s=>!["won","lost"].includes(s.key)).map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </FormField>
            <FormField label="Source">
              <select className={selectCls} value={form.source} onChange={e=>u("source",e.target.value)}>
                <option value="outbound">Prospection sortante</option>
                <option value="inbound">Entrante (contact spontané)</option>
                <option value="referral">Recommandation</option>
                <option value="event">Événement / salon</option>
                <option value="other">Autre</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Entreprise prospect">
              <input className={inputCls} value={form.companyName} onChange={e=>u("companyName",e.target.value)} placeholder="Nom de l'entreprise"/>
            </FormField>
            <FormField label="Nom du contact">
              <input className={inputCls} value={form.contactName} onChange={e=>u("contactName",e.target.value)}/>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Montant estimé (XOF)">
              <input type="number" className={inputCls} value={form.estimatedAmount} onChange={e=>u("estimatedAmount",Number(e.target.value))} min={0}/>
            </FormField>
            <FormField label="Probabilité (%)">
              <input type="number" className={inputCls} value={form.probability} onChange={e=>u("probability",Number(e.target.value))} min={0} max={100}/>
            </FormField>
            <FormField label="Prochaine relance">
              <input type="date" className={inputCls} value={form.nextFollowUpDate} onChange={e=>u("nextFollowUpDate",e.target.value)}/>
            </FormField>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
            <button type="button" onClick={()=>setModalOpen(false)} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
            <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Création…":"Ajouter au pipeline"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
