"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Paperclip, Upload, Trash2, FileText, FileSpreadsheet, Image as ImageIcon,
  File as FileIcon, Download, Loader2,
} from "lucide-react";
import { Pill, EmptyState } from "@/components/ui/Primitives";

export type AttachmentHost =
  | "contracts" | "subscriptions" | "invoices" | "devis" | "commandes" | "marches"
  | "expenses" | "projects" | "employees" | "clients" | "suppliers" | "payslips"
  | "treasuryAccounts" | "documents";

export type AttachmentCategory =
  | "contrat" | "avenant" | "facture" | "justificatif" | "releve" | "courrier" | "autre";

interface Attachment {
  _id: string;
  filename: string;
  label?: string;
  mime: string;
  size: number;
  category: AttachmentCategory;
  createdAt: string;
  uploadedBy?: { firstName?: string; lastName?: string };
}

const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  contrat: "Contrat", avenant: "Avenant", facture: "Facture",
  justificatif: "Justificatif", releve: "Relevé", courrier: "Courrier", autre: "Autre",
};

/** L'icône dit le format avant que le nom ne soit lu. */
function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime === "application/pdf") return FileText;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime.includes("word") || mime === "text/plain") return FileText;
  return FileIcon;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt";

interface Props {
  host: AttachmentHost;
  hostId: string;
  title?: string;
  hint?: string;
  /** Natures proposées. Une seule valeur masque le sélecteur. */
  categories?: AttachmentCategory[];
  defaultCategory?: AttachmentCategory;
  readOnly?: boolean;
  /** Averti à chaque changement — utile pour recompter côté écran porteur. */
  onChange?: (count: number) => void;
}

/**
 * Les pièces jointes d'un document, en un panneau réutilisable.
 *
 * Le même composant sert un contrat, un abonnement, une facture ou une note de
 * frais : la seule chose qui change est le document porteur. Écrire un
 * téléversement par écran aurait produit huit règles de taille différentes et
 * sept messages d'erreur discordants.
 *
 * Les octets ne sont jamais servis en statique : chaque téléchargement passe
 * par `/api/attachments/:id`, qui vérifie l'organisation et le droit.
 */
export function AttachmentPanel({
  host, hostId, title = "Pièces jointes", hint,
  categories = ["contrat", "avenant", "facture", "justificatif", "releve", "courrier", "autre"],
  defaultCategory, readOnly = false, onChange,
}: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [category, setCategory] = useState<AttachmentCategory>(
    defaultCategory ?? categories[0] ?? "autre"
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/attachments?host=${host}&hostId=${hostId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setItems(d.data.items || []);
        onChange?.((d.data.items || []).length);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // `onChange` est volontairement hors dépendances : une fonction recréée à
    // chaque rendu par l'appelant relancerait la lecture en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, hostId]);

  useEffect(() => { load(); }, [load]);

  async function upload(files: FileList | File[]) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
    const messages: string[] = [];

    // Séquentiel, pas en parallèle : sur une connexion faible, quatre
    // téléversements simultanés se gênent et échouent tous plutôt qu'un seul.
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      body.append("host", host);
      body.append("hostId", hostId);
      body.append("category", category);

      try {
        const res = await fetch("/api/attachments", {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          credentials: "include",
          body,
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Téléversement refusé");
        if (d.data?.duplicate) messages.push(d.data.message);
      } catch (e) {
        messages.push(`${file.name} — ${e instanceof Error ? e.message : "échec"}`);
      }
    }

    if (messages.length > 0) setNotice(messages.join(" "));
    setBusy(false);
    load();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function destroy(id: string, filename: string) {
    if (!window.confirm(`Retirer « ${filename} » ? Le fichier sera supprimé.`)) return;
    setBusy(true);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      const res = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Suppression refusée");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="p-5 pb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink flex items-center gap-2">
            <Paperclip size={15} className="text-ink3" />
            {title}
            {items.length > 0 && <span className="num text-ink3 font-normal">({items.length})</span>}
          </h2>
          {hint && <p className="text-xs text-ink2 mt-0.5">{hint}</p>}
        </div>
        {!readOnly && categories.length > 1 && (
          <select value={category} onChange={e => setCategory(e.target.value as AttachmentCategory)}
            aria-label="Nature de la pièce"
            className="h-9 px-2 rounded-lg border border-line2 bg-surface text-xs text-ink2">
            {categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        )}
      </div>

      {!readOnly && (
        <div className="px-5 pb-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer
                        transition-colors ${dragging
                          ? "border-section bg-section-soft"
                          : "border-line2 hover:border-section/50 hover:bg-surface2/50"}`}
          >
            {busy ? (
              <p className="text-sm text-ink2 flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" /> Envoi en cours…
              </p>
            ) : (
              <>
                <Upload size={20} className="mx-auto text-ink3 mb-2" />
                <p className="text-sm text-ink">Déposez un fichier, ou cliquez pour choisir</p>
                <p className="text-xs text-ink3 mt-1">
                  PDF, images, Word, Excel, CSV — 15 Mo au maximum
                </p>
              </>
            )}
            <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={e => e.target.files?.length && upload(e.target.files)} />
          </div>
        </div>
      )}

      {error && (
        <p className="mx-5 mb-4 px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">
          {error}
        </p>
      )}
      {notice && (
        <p className="mx-5 mb-4 px-3 py-2 rounded-lg bg-warn-50 border border-warn/25 text-sm text-warn">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="px-5 pb-5 space-y-2">
          {[0, 1].map(i => <div key={i} className="h-12 rounded-lg bg-surface2 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        !readOnly ? null : (
          <div className="px-5 pb-5">
            <EmptyState title="Aucune pièce jointe"
              hint="Les documents rattachés apparaîtront ici." />
          </div>
        )
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map(item => {
            const Icon = iconFor(item.mime);
            const who = item.uploadedBy
              ? [item.uploadedBy.firstName, item.uploadedBy.lastName].filter(Boolean).join(" ")
              : null;
            return (
              <li key={item._id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface2/50">
                <span className="chip shrink-0"><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{item.label || item.filename}</p>
                  <p className="text-[11px] text-ink3">
                    {humanSize(item.size)} · {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                    {who && <> · {who}</>}
                  </p>
                </div>
                <Pill tone="mute">{CATEGORY_LABEL[item.category]}</Pill>
                <a href={`/api/attachments/${item._id}`}
                  className="p-1.5 rounded-lg text-ink3 hover:text-section hover:bg-section-soft"
                  title={`Télécharger ${item.filename}`}>
                  <Download size={15} />
                </a>
                {!readOnly && (
                  <button onClick={() => destroy(item._id, item.filename)} disabled={busy}
                    className="p-1.5 rounded-lg text-ink3 hover:text-neg hover:bg-neg-50 disabled:opacity-40"
                    title="Retirer">
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
