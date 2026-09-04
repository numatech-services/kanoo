"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, FileText, Trash2, Download } from "lucide-react";
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

  async function save() {
    if (!form.subject.trim()) { setError("L'objet est requis."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(id ? `/api/courriers/${id}` : "/api/courriers", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(form),
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
        <FormField label="Corps du courrier">
          <textarea className={textareaCls} rows={10} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="Séparez les paragraphes par une ligne vide. L'assistant IA pourra bientôt proposer un premier jet ici." />
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
