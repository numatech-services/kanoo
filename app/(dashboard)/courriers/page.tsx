"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, FileText, Trash2, Download, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";

interface Letter {
  _id: string; reference?: string; kind: string; subject: string;
  recipient?: string; status: string; aiAssisted?: boolean; createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  courrier: "Courrier", rapport: "Rapport", attestation: "Attestation",
  note: "Note", reponse_ao: "Réponse AO", autre: "Autre",
};

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function CourriersPage() {
  const [items, setItems] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Letter> & { body?: string; place?: string; signatory?: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/courriers?limit=50", { credentials: "include" })
      .then(r => r.json())
      .then(d => setItems(d.data?.items || []))
      .catch(() => setError("Lecture impossible."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!confirm("Supprimer ce courrier ?")) return;
    await fetch(`/api/courriers/${id}`, {
      method: "DELETE", credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink">Courriers & correspondances</h1>
          <p className="text-sm text-ink2">
            Lettres, rapports, attestations — au format et à la marque de votre organisation.
          </p>
        </div>
        <button onClick={() => setEditing({ kind: "courrier", subject: "" })}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau courrier
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {loading ? (
        <div className="h-64 surface-card animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title="Aucun courrier"
          hint="Rédigez une lettre ou un rapport ; il sera généré en PDF à votre marque." />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="table-dense">
            <thead><tr><th>Objet</th><th>Type</th><th>Destinataire</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {items.map(l => (
                <tr key={l._id}>
                  <td>
                    <button onClick={() => fetch(`/api/courriers/${l._id}`, { credentials: "include" }).then(r => r.json()).then(d => setEditing(d.data))}
                      className="text-ink font-medium hover:text-section text-left">
                      {l.subject}
                    </button>
                    {l.aiAssisted && <span className="ml-2 text-[10px] text-section">IA</span>}
                  </td>
                  <td><Pill tone="mute">{KIND_LABEL[l.kind] ?? l.kind}</Pill></td>
                  <td className="text-ink2">{l.recipient || "—"}</td>
                  <td className="text-ink2 whitespace-nowrap">{new Date(l.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <span className="flex items-center gap-1 justify-end">
                      <a href={`/api/courriers/${l._id}/pdf`} target="_blank" rel="noopener"
                        className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title="PDF">
                        <Download size={15} />
                      </a>
                      <button onClick={() => del(l._id)} title="Supprimer"
                        className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50">
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ComposeDialog letter={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ComposeDialog({
  letter, onClose, onSaved,
}: { letter: Partial<Letter> & { body?: string; place?: string; signatory?: string }; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    kind: letter.kind || "courrier",
    reference: letter.reference || "",
    subject: letter.subject || "",
    recipient: letter.recipient || "",
    place: letter.place || "",
    body: letter.body || "",
    signatory: letter.signatory || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = letter._id;

  // ── Assistant IA ──────────────────────────────────────────────────────────
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsed, setAiUsed] = useState(Boolean(letter.aiAssisted));
  const [ai, setAi] = useState<{ configured: boolean; remaining: number; quota: number } | null>(null);

  useEffect(() => {
    fetch("/api/ai/redaction", { credentials: "include" })
      .then(r => r.json())
      .then(d => d.success && setAi({ configured: d.data.configured, remaining: d.data.quota.remaining, quota: d.data.quota.quota }))
      .catch(() => {});
  }, []);

  async function generate() {
    if (!form.subject.trim()) { setError("Renseignez d'abord l'objet : l'IA en a besoin."); return; }
    if (form.body.trim() && !confirm("Remplacer le corps actuel par le texte proposé par l'IA ?")) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/redaction", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({
          kind: form.kind, subject: form.subject, recipient: form.recipient,
          place: form.place, signatory: form.signatory, instructions: aiInstructions,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Génération refusée");
      setForm(f => ({ ...f, body: d.data.body }));
      setAiUsed(true);
      if (d.data.quota) setAi(a => a && { ...a, remaining: Math.max(0, a.quota - d.data.quota.used) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Génération impossible");
    } finally {
      setAiLoading(false);
    }
  }

  async function save() {
    if (!form.subject.trim()) { setError("L'objet est requis."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(id ? `/api/courriers/${id}` : "/api/courriers", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({ ...form, aiAssisted: aiUsed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Enregistrement refusé");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={id ? "Modifier le courrier" : "Nouveau courrier"} size="xl">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label="Type">
            <select className={selectCls} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
          <FormField label="Référence" hint="Optionnelle">
            <input className={inputCls} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
          </FormField>
          <FormField label="Lieu" hint="Ex. Niamey">
            <input className={inputCls} value={form.place} onChange={e => setForm(f => ({ ...f, place: e.target.value }))} />
          </FormField>
        </div>
        <FormField label="Objet" required>
          <input className={inputCls} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
        </FormField>
        <FormField label="Destinataire" hint="Bloc adresse — une ligne par retour à la ligne.">
          <textarea className={textareaCls} rows={2} value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} />
        </FormField>
        {/* Assistant IA rédactionnel */}
        {ai?.configured && (
          <div className="rounded-xl border border-section/30 bg-section/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-section">
                <Sparkles size={15} /> Rédiger avec l&apos;IA
              </span>
              <span className="text-[11px] text-ink3">
                {ai.remaining}/{ai.quota} générations restantes ce mois
              </span>
            </div>
            <textarea className={textareaCls} rows={2} value={aiInstructions}
              onChange={e => setAiInstructions(e.target.value)}
              placeholder="Consignes facultatives : ton, points à couvrir, longueur…" />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-ink3">
                {form.kind === "rapport"
                  ? "Pour un rapport, des chiffres agrégés de votre organisation (CA, factures, adhérents…) sont transmis à l'IA."
                  : "L'objet, le destinataire et vos consignes sont transmis à l'IA. Le texte proposé reste modifiable."}
              </p>
              <button type="button" onClick={generate} disabled={aiLoading || ai.remaining <= 0}
                className="shrink-0 px-3 h-9 inline-flex items-center gap-1.5 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
                <Sparkles size={14} /> {aiLoading ? "Rédaction…" : form.body.trim() ? "Régénérer" : "Proposer un jet"}
              </button>
            </div>
          </div>
        )}

        <FormField label="Corps du courrier">
          <textarea className={textareaCls} rows={10} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="Séparez les paragraphes par une ligne vide. Utilisez « Rédiger avec l'IA » ci-dessus pour un premier jet." />
          {aiUsed && <p className="mt-1 text-[11px] text-section inline-flex items-center gap-1"><Sparkles size={11} /> Premier jet proposé par l&apos;IA — relisez et ajustez avant d&apos;enregistrer.</p>}
        </FormField>
        <FormField label="Signataire" hint="Nom et fonction.">
          <input className={inputCls} value={form.signatory} onChange={e => setForm(f => ({ ...f, signatory: e.target.value }))} />
        </FormField>

        <div className="flex justify-between items-center pt-3 border-t border-line">
          {id
            ? <a href={`/api/courriers/${id}/pdf`} target="_blank" rel="noopener" className="text-sm text-section hover:underline inline-flex items-center gap-1.5"><Download size={15} /> Aperçu PDF</a>
            : <span className="text-xs text-ink3">Enregistrez pour générer le PDF.</span>}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Fermer</button>
            <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
