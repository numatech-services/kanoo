"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, FileText, Trash2, Download, Sparkles, Archive, ArchiveRestore, Paperclip, ArrowUpRight, ArrowDownLeft, CheckCircle2, Clock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { useMe, meCanDo } from "@/lib/useMe";

interface Letter {
  _id: string; reference?: string; kind: string; subject: string;
  recipient?: string; status: string; direction?: string; archived?: boolean;
  attachment?: { name?: string; dataUri?: string };
  dueDate?: string; handled?: boolean;
  aiAssisted?: boolean; createdAt: string;
}

// Un courrier entrant, avec une échéance dépassée et non traité, est « en retard ».
function overdue(l: Letter): boolean {
  return l.direction === "incoming" && !l.handled && !!l.dueDate && new Date(l.dueDate) < new Date();
}

const KIND_LABEL: Record<string, string> = {
  courrier: "Courrier", rapport: "Rapport", attestation: "Attestation",
  note: "Note", reponse_ao: "Réponse AO", autre: "Autre",
};

// Pièce jointe importée : limitée à ~2,5 Mo (stockage en data-URI, hébergement
// mutualisé sans disque persistant).
const MAX_ATTACHMENT = 2_500_000;

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function CourriersPage() {
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const canDelete = meCanDo(useMe(), "documents", "delete");
  const [items, setItems] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Letter> & { body?: string; place?: string; signatory?: string } | null>(null);
  // Filtres de suivi : actifs / archivés, et sens (tous / entrant / sortant).
  const [showArchived, setShowArchived] = useState(false);
  const [direction, setDirection] = useState<"" | "outgoing" | "incoming">("");

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ limit: "50" });
    if (showArchived) q.set("archived", "1");
    if (direction) q.set("direction", direction);
    fetch(`/api/courriers?${q.toString()}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setItems(d.data?.items || []))
      .catch(() => setError("Lecture impossible."))
      .finally(() => setLoading(false));
  }, [showArchived, direction]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string) {
    if (!confirm("Supprimer ce courrier ?")) return;
    await fetch(`/api/courriers/${id}`, {
      method: "DELETE", credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    load();
  }

  async function toggleArchive(l: Letter) {
    await fetch(`/api/courriers/${l._id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ archived: !l.archived }),
    });
    load();
  }

  // La liste ne porte que le nom de la pièce jointe : on charge le courrier
  // complet au moment du téléchargement.
  async function downloadAttachment(id: string) {
    const d = await fetch(`/api/courriers/${id}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    const att = d?.data?.attachment;
    if (!att?.dataUri) { alert("Pièce jointe introuvable."); return; }
    const a = document.createElement("a");
    a.href = att.dataUri; a.download = att.name || "piece-jointe"; a.click();
  }

  async function toggleHandled(l: Letter) {
    await fetch(`/api/courriers/${l._id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ handled: !l.handled }),
    });
    load();
  }

  const tabCls = (active: boolean) =>
    `px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-section text-white" : "text-ink2 hover:bg-surface2 border border-line2"
    }`;

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink">Courriers & correspondances</h1>
          <p className="text-sm text-ink2">
            Numérotation automatique, sens entrant / sortant, import et archivage — au format et à la marque de votre organisation.
          </p>
        </div>
        <button onClick={() => setEditing({ kind: "courrier", subject: "" })}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau courrier
        </button>
      </div>

      {/* Filtres de suivi */}
      <div className="flex flex-wrap items-center gap-2">
        <button className={tabCls(!showArchived)} onClick={() => setShowArchived(false)}>Actifs</button>
        <button className={tabCls(showArchived)} onClick={() => setShowArchived(true)}>Archivés</button>
        <span className="mx-1 h-6 w-px bg-line2" />
        <button className={tabCls(direction === "")} onClick={() => setDirection("")}>Tous</button>
        <button className={tabCls(direction === "outgoing")} onClick={() => setDirection("outgoing")}>
          <ArrowUpRight size={14} className="mr-1" /> Sortants
        </button>
        <button className={tabCls(direction === "incoming")} onClick={() => setDirection("incoming")}>
          <ArrowDownLeft size={14} className="mr-1" /> Entrants
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {loading ? (
        <div className="h-64 surface-card animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title={showArchived ? "Aucun courrier archivé" : "Aucun courrier"}
          hint="Rédigez une lettre ou un rapport, ou importez un courrier reçu ; il sera classé et suivi ici." />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="table-dense">
            <thead><tr><th>Réf.</th><th>Objet</th><th>Sens</th><th>Type</th><th>Destinataire</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {items.map(l => (
                <tr key={l._id}>
                  <td className="text-ink2 font-mono text-xs whitespace-nowrap">{l.reference || "—"}</td>
                  <td>
                    <button onClick={() => fetch(`/api/courriers/${l._id}`, { credentials: "include" }).then(r => r.json()).then(d => setEditing(d.data))}
                      className="text-ink font-medium hover:text-section text-left inline-flex items-center gap-1.5">
                      {l.subject}
                      {l.attachment?.name && <Paperclip size={12} className="text-ink3" />}
                    </button>
                    {l.aiAssisted && <span className="ml-2 text-[10px] text-section">IA</span>}
                  </td>
                  <td>
                    {l.direction === "incoming"
                      ? <Pill tone="warn"><ArrowDownLeft size={11} className="inline mr-0.5" /> Entrant</Pill>
                      : <Pill tone="info"><ArrowUpRight size={11} className="inline mr-0.5" /> Sortant</Pill>}
                    {overdue(l) && <span className="ml-1"><Pill tone="neg"><Clock size={11} className="inline mr-0.5" /> En retard</Pill></span>}
                    {l.direction === "incoming" && l.handled && <span className="ml-1"><Pill tone="pos">Traité</Pill></span>}
                    {l.direction === "incoming" && !l.handled && l.dueDate && !overdue(l) &&
                      <span className="ml-1 text-[11px] text-ink3 whitespace-nowrap">échéance {new Date(l.dueDate).toLocaleDateString("fr-FR")}</span>}
                  </td>
                  <td><Pill tone="mute">{KIND_LABEL[l.kind] ?? l.kind}</Pill></td>
                  <td className="text-ink2">{l.recipient || "—"}</td>
                  <td className="text-ink2 whitespace-nowrap">{new Date(l.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <span className="flex items-center gap-1 justify-end">
                      {l.attachment?.name && (
                        <button onClick={() => downloadAttachment(l._id)}
                          className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title={`Pièce jointe : ${l.attachment.name}`}>
                          <Paperclip size={15} />
                        </button>
                      )}
                      <a href={`/api/courriers/${l._id}/pdf`} target="_blank" rel="noopener"
                        className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2" title="PDF">
                        <Download size={15} />
                      </a>
                      {l.direction === "incoming" && (
                        <button onClick={() => toggleHandled(l)} title={l.handled ? "Rouvrir" : "Marquer traité"}
                          className={`p-1.5 rounded hover:bg-surface2 ${l.handled ? "text-pos" : "text-ink3 hover:text-pos"}`}>
                          <CheckCircle2 size={15} />
                        </button>
                      )}
                      <button onClick={() => toggleArchive(l)} title={l.archived ? "Désarchiver" : "Archiver"}
                        className="p-1.5 rounded text-ink3 hover:text-section hover:bg-surface2">
                        {l.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                      </button>
                      {canDelete && <button onClick={() => del(l._id)} title="Supprimer"
                        className="p-1.5 rounded text-ink3 hover:text-neg hover:bg-neg-50">
                        <Trash2 size={15} />
                      </button>}
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
    direction: (letter.direction as "outgoing" | "incoming") || "outgoing",
    reference: letter.reference || "",
    subject: letter.subject || "",
    recipient: letter.recipient || "",
    place: letter.place || "",
    body: letter.body || "",
    signatory: letter.signatory || "",
    dueDate: letter.dueDate ? String(letter.dueDate).split("T")[0] : "",
  });
  const [attachment, setAttachment] = useState<{ name?: string; dataUri?: string } | null>(letter.attachment || null);
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

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT) { setError("Pièce jointe trop lourde (2,5 Mo maximum)."); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ name: file.name, dataUri: String(reader.result) });
    reader.readAsDataURL(file);
  }

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
        // `attachment: null` explicite : retirer la pièce jointe doit être enregistré.
        body: JSON.stringify({ ...form, dueDate: form.dueDate || null, aiAssisted: aiUsed, attachment: attachment ?? null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Enregistrement refusé");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const incoming = form.direction === "incoming";

  return (
    <Modal open onClose={onClose} title={id ? "Modifier le courrier" : "Nouveau courrier"} size="xl">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        {/* Sens du courrier */}
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => setForm(f => ({ ...f, direction: "outgoing" }))}
            className={`px-3 h-11 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
              !incoming ? "border-section bg-section/10 text-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>
            <ArrowUpRight size={16} /> Sortant (émis)
          </button>
          <button type="button" onClick={() => setForm(f => ({ ...f, direction: "incoming" }))}
            className={`px-3 h-11 rounded-lg border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
              incoming ? "border-section bg-section/10 text-section" : "border-line2 text-ink2 hover:bg-surface2"}`}>
            <ArrowDownLeft size={16} /> Entrant (reçu)
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <FormField label="Type">
            <select className={selectCls} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
          <FormField label="Référence" hint="Auto si vide (CR-AAAA-NNNN)">
            <input className={inputCls} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Automatique" />
          </FormField>
          <FormField label="Lieu" hint="Ex. Niamey">
            <input className={inputCls} value={form.place} onChange={e => setForm(f => ({ ...f, place: e.target.value }))} />
          </FormField>
        </div>
        <FormField label="Objet" required>
          <input className={inputCls} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
        </FormField>
        <FormField label={incoming ? "Expéditeur" : "Destinataire"} hint="Bloc adresse — une ligne par retour à la ligne.">
          <textarea className={textareaCls} rows={2} value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} />
        </FormField>
        {incoming && (
          <FormField label="Échéance de réponse" hint="Laisser vide si aucun délai. Une alerte signale les retards.">
            <input className={inputCls} type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
          </FormField>
        )}

        {/* Import d'une pièce (scan d'un courrier reçu, PDF externe…) */}
        <FormField label="Pièce jointe" hint="Importer un scan ou un PDF (2,5 Mo max).">
          {attachment?.dataUri ? (
            <div className="flex items-center justify-between gap-2 px-3 h-11 rounded-lg border border-line2 bg-surface2/40">
              <span className="inline-flex items-center gap-2 text-sm text-ink truncate">
                <Paperclip size={15} className="text-section shrink-0" /> {attachment.name || "Pièce jointe"}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <a href={attachment.dataUri} download={attachment.name || "piece-jointe"} className="text-xs text-section hover:underline">Télécharger</a>
                <button type="button" onClick={() => setAttachment(null)} className="text-xs text-neg hover:underline">Retirer</button>
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2 px-3 h-11 rounded-lg border border-dashed border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
              <Paperclip size={15} /> Choisir un fichier…
              <input type="file" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            </label>
          )}
        </FormField>

        {/* Assistant IA rédactionnel — inutile pour un courrier reçu */}
        {!incoming && ai?.configured && (
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

        <FormField label={incoming ? "Notes / résumé" : "Corps du courrier"}>
          <textarea className={textareaCls} rows={10} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder={incoming
              ? "Résumé du courrier reçu, suites à donner, échéance…"
              : "Séparez les paragraphes par une ligne vide. Utilisez « Rédiger avec l'IA » ci-dessus pour un premier jet."} />
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
