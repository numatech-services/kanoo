"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Plus, FileText, Trash2, Download, Sparkles, Archive, ArchiveRestore, Paperclip, ArrowUpRight, ArrowDownLeft, CheckCircle2, Clock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken, apiJson, api, apiErrorMessage, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
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
  const csrfToken = await getCsrfToken();
  return csrfToken as string;
}

const noSubscribe = () => () => {};

export default function CourriersPage() {
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const canDelete = meCanDo(useMe(), "documents", "delete");
  const [editing, setEditing] = useState<Partial<Letter> & { body?: string; place?: string; signatory?: string } | null>(null);
  // Filtres de suivi : actifs / archivés, et sens (tous / entrant / sortant).
  const [showArchived, setShowArchived] = useState(false);
  const [direction, setDirection] = useState<"" | "outgoing" | "incoming">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const LIMIT = 50;
  useEffect(() => { const t = setTimeout(() => { setPage(1); setQuery(search.trim()); }, 300); return () => clearTimeout(t); }, [search]);
  // Recherche transmise par l'adresse (résultat de la recherche ⌘K), lue une
  // fois dans le navigateur.
  const urlSearch = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).get("q") ?? "", () => "");
  const [appliedUrlSearch, setAppliedUrlSearch] = useState("");
  if (urlSearch && urlSearch !== appliedUrlSearch) { setAppliedUrlSearch(urlSearch); setSearch(urlSearch); }

  const q = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
  if (showArchived) q.set("archived", "1");
  if (direction) q.set("direction", direction);
  if (query) q.set("q", query);
  // Une lecture refusée ou en erreur s'affiche : elle ne se fait plus passer pour « aucun courrier ».
  const list = useApi<{ items?: Letter[]; pagination?: { total?: number } } | null>(
    `/api/courriers?${q.toString()}`, d => (d.success === false ? null : d.data ?? null), null, { quiet: true },
  );
  const items = list.data?.items || [];
  const total = list.data?.pagination?.total ?? 0;
  const { loading, error, reload: load } = list;

  async function del(id: string) {
    if (!(await confirmDialog({ title: "Supprimer ce courrier ?", danger: true }))) return;
    await apiSend("DELETE", `/api/courriers/${id}`);
    load();
  }

  async function toggleArchive(l: Letter) {
    await apiSend("PATCH", `/api/courriers/${l._id}`, { archived: !l.archived });
    load();
  }

  // La liste ne porte que le nom de la pièce jointe : on charge le courrier
  // complet au moment du téléchargement.
  async function downloadAttachment(id: string) {
    const d = await apiJson(`/api/courriers/${id}`).catch(() => null);
    const att = d?.data?.attachment;
    if (!att?.dataUri) { showToast("Pièce jointe introuvable.", "error"); return; }
    const a = document.createElement("a");
    a.href = att.dataUri; a.download = att.name || "piece-jointe"; a.click();
  }

  async function toggleHandled(l: Letter) {
    try { await api.patch(`/api/courriers/${l._id}`, { handled: !l.handled }); }
    catch (e) { showToast(apiErrorMessage(e, "Mise à jour impossible."), "error"); }
    load();
  }

  const tabCls = (active: boolean) =>
    `px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-section text-onink" : "text-ink2 hover:bg-surface2 border border-line2"
    }`;

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Courriers & correspondances</h1>
          <p className="text-sm text-ink2">
            Numérotation automatique, sens entrant / sortant, import et archivage — au format et à la marque de votre organisation.
          </p>
        </div>
        <button onClick={() => setEditing({ kind: "courrier", subject: "" })}
          className={buttonClass("primary", "md")}>
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
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher : référence, objet, destinataire"
          aria-label="Rechercher un courrier" className="ml-auto h-9 px-3 rounded-lg border border-line2 bg-surface text-sm text-ink min-w-[16rem]" />
      </div>
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {loading ? (
        <div className="h-64 surface-card animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyState icon={<FileText size={20} />} title={query ? `Aucun courrier pour « ${query} »` : showArchived ? "Aucun courrier archivé" : "Aucun courrier"}
          hint={query || direction ? "Élargissez la recherche ou affichez « Tous »." : "Rédigez une lettre ou un rapport, ou importez un courrier reçu ; il sera classé et suivi ici."} />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Réf.</th><th>Objet</th><th>Sens</th><th>Type</th><th>Destinataire</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {items.map(l => (
                <tr key={l._id}>
                  <td className="text-ink2 font-mono text-xs whitespace-nowrap">{l.reference || "—"}</td>
                  <td>
                    <button onClick={() => apiJson(`/api/courriers/${l._id}`).then(d => setEditing(d.data))}
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
          </table></div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-line text-sm text-ink2">
              <span>{(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} sur {total}</span>
              <span className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 h-8 rounded-lg border border-line2 disabled:opacity-40">Précédent</button>
                <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)} className="px-3 h-8 rounded-lg border border-line2 disabled:opacity-40">Suivant</button>
              </span>
            </div>
          )}
        </div>
      )}

      {editing && <ComposeDialog letter={editing} onClose={() => setEditing(null)} onSaved={(saved) => {
        setEditing(null);
        // Le courrier enregistré doit se voir : on revient sur les actifs, tous sens, sans recherche.
        setShowArchived(false); setDirection(""); setSearch(""); setQuery(""); setPage(1);
        setNotice(saved?.reference ? `Courrier ${saved.reference} enregistré.` : "Courrier enregistré.");
        load();
      }} />}
    </div>
  );
}

function ComposeDialog({
  letter, onClose, onSaved,
}: { letter: Partial<Letter> & { body?: string; place?: string; signatory?: string }; onClose: () => void; onSaved: (saved?: { reference?: string }) => void }) {
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
    apiJson("/api/ai/redaction")
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
    if (form.body.trim() && !(await confirmDialog({ title: "Remplacer le corps actuel par le texte proposé par l'IA ?" }))) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await apiSend("POST", "/api/ai/redaction", {
          kind: form.kind, subject: form.subject, recipient: form.recipient,
          place: form.place, signatory: form.signatory, instructions: aiInstructions,
        });
      const d = res.data;
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
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(d?.error || (res.status === 413
          ? "Pièce jointe trop lourde pour le serveur : réduisez le PDF (ou relevez la limite d'envoi de l'hébergement)."
          : `Enregistrement refusé (erreur ${res.status}).`));
      }
      onSaved(d?.data);
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
                className={buttonClass("primary", "md", "shrink-0")}>
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
            <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button>
            <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
