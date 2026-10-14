"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, FileWarning, CalendarClock, PlayCircle, CheckCircle2, Archive, Paperclip,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Pill, Inset, FilterChips, EmptyState } from "@/components/ui/Primitives";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { AttachmentPanel } from "@/components/shared/AttachmentPanel";
import {
  DOCUMENT_TYPES, STATUS_LABEL, STATUS_TONE, suggestedExpiry,
  type DocumentType, type DocumentStatus, type DocumentAlert,
} from "@/lib/admin-documents";

import { buttonClass } from "@/components/ui/button-class";
interface Row {
  _id: string;
  label: string;
  type: DocumentType;
  reference?: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
  leadTimeDays?: number;
  effectiveLeadTime: number;
  renewalStartDate?: string | null;
  renewalStartedAt?: string;
  status: DocumentStatus;
  notes?: string;
}

interface Payload {
  items: Row[];
  alerts: DocumentAlert[];
  summary: { total: number; valid: number; toRenew: number; late: number; expired: number };
}

const fr = (d?: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function DocumentsAdministratifsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [openDoc, setOpenDoc] = useState<Row | null>(null);

  const load = useCallback(() => {
    fetch("/api/documents-administratifs", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/documents-administratifs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Action refusée");
      if (d.data?.message) setNotice(d.data.message);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Veille indisponible."}
    </p>;
  }

  const { items, alerts, summary } = data;
  const critical = alerts.filter(a => a.level === "critical");
  const shown = filter ? items.filter(d => d.status === filter) : items;

  const statuses: DocumentStatus[] = ["renewal_late", "expired", "renewal_due", "in_progress", "valid", "perpetual"];

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Coffre administratif</h1>
          <p className="text-sm text-ink2">
            Ce qui compte n&apos;est pas la date d&apos;expiration, c&apos;est celle à
            laquelle il faut s&apos;y prendre.
          </p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Ajouter un document
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="À lancer maintenant" value={summary.toRenew}
          icon={<CalendarClock size={17} />} tone={summary.toRenew > 0 ? "pending" : "margin"}
          hint="Le délai d'instruction commence à courir" />
        <KpiCard label="Renouvellement en retard" value={summary.late}
          icon={<FileWarning size={17} />} tone={summary.late > 0 ? "neg" : "margin"}
          goodDirection="down" hint="La marge est entamée" />
        <KpiCard label="Périmés" value={summary.expired}
          tone={summary.expired > 0 ? "neg" : "margin"} goodDirection="down"
          hint={summary.expired > 0 ? "À régulariser sans délai" : "Aucun document périmé"} />
        <KpiCard label="Sous surveillance" value={summary.total} tone="parties"
          hint={`${summary.valid} à jour`} />
      </div>

      {critical.length > 0 && (
        <section className="surface-card border-neg/30 overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-neg flex items-center gap-2">
              <FileWarning size={16} /> {critical.length} urgence(s)
            </h2>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {critical.map(alert => (
              <li key={alert.documentId} className="px-5 py-3 flex items-start gap-3">
                <Pill tone="neg">{STATUS_LABEL[alert.status]}</Pill>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink font-medium">{alert.label}</span>
                  <span className="block text-xs text-ink2 mt-0.5">{alert.message}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FilterChips
        options={statuses
          .map(s => ({ key: s, label: STATUS_LABEL[s], count: items.filter(d => d.status === s).length }))
          .filter(o => (o.count ?? 0) > 0)}
        value={filter}
        onChange={setFilter}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={20} />}
          title={filter ? "Aucun document dans cet état" : "Aucun document sous surveillance"}
          hint="Attestation fiscale, CNSS, patente, agrément, assurance, bail, visite technique : tout ce dont l'absence bloque un jour une activité."
        />
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[62rem]">
              <thead>
                <tr>
                  <th>Document</th><th>Nature</th>
                  <th>Échéance</th><th>À lancer le</th><th>Délai</th>
                  <th>État</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(doc => {
                  const spec = DOCUMENT_TYPES[doc.type];
                  const engaged = Boolean(doc.renewalStartedAt);
                  return (
                    <tr key={doc._id}>
                      <td>
                        <button onClick={() => setOpenDoc(doc)}
                          className="text-left text-ink font-medium hover:text-section">
                          {doc.label}
                        </button>
                        {doc.reference && (
                          <p className="text-[11px] text-ink3 font-mono">{doc.reference}</p>
                        )}
                      </td>
                      <td className="text-ink2 text-xs">
                        {spec?.label}
                        {spec?.blocking && (
                          <span className="block text-[10px] text-warn">bloquant</span>
                        )}
                      </td>
                      <td className="text-ink2 text-xs whitespace-nowrap">{fr(doc.expiresAt)}</td>
                      <td className="whitespace-nowrap">
                        {/* La donnée du module : la date à laquelle commencer. */}
                        <span className={`text-xs font-medium ${
                          doc.status === "renewal_due" || doc.status === "renewal_late"
                            ? "text-neg" : "text-ink"
                        }`}>
                          {fr(doc.renewalStartDate)}
                        </span>
                      </td>
                      <td className="num text-xs text-ink3">{doc.effectiveLeadTime} j</td>
                      <td><Pill tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Pill></td>
                      <td>
                        <span className="flex items-center gap-1">
                          {!engaged && doc.status !== "perpetual" && doc.status !== "valid" && (
                            <button onClick={() => patch(doc._id, { renewalStarted: true })}
                              title="J'ai lancé la démarche"
                              className="p-1.5 rounded-lg text-ink3 hover:text-info hover:bg-info-50">
                              <PlayCircle size={14} />
                            </button>
                          )}
                          <button onClick={() => setOpenDoc(doc)}
                            title="Enregistrer le renouvellement, joindre le document"
                            className="p-1.5 rounded-lg text-ink3 hover:text-pos hover:bg-pos-50">
                            <CheckCircle2 size={14} />
                          </button>
                          <button onClick={() => patch(doc._id, { archived: true })}
                            title="Archiver"
                            className="p-1.5 rounded-lg text-ink3 hover:text-ink2 hover:bg-surface2">
                            <Archive size={14} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AddDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />

      <Modal open={Boolean(openDoc)} onClose={() => setOpenDoc(null)}
        title={openDoc?.label ?? "Document"} size="lg">
        {openDoc && (
          <DocumentPanel doc={openDoc} onAction={(body) => patch(openDoc._id, body)}
            onDone={() => setOpenDoc(null)} />
        )}
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DocumentPanel({
  doc, onAction, onDone,
}: { doc: Row; onAction: (body: Record<string, unknown>) => void; onDone: () => void }) {
  const [until, setUntil] = useState("");
  const spec = DOCUMENT_TYPES[doc.type];

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        {([
          ["Nature", spec?.label],
          ["Référence", doc.reference || "—"],
          ["Délivré par", doc.issuer || "—"],
          ["Délivré le", fr(doc.issuedAt)],
          ["Expire le", fr(doc.expiresAt)],
          ["À lancer le", fr(doc.renewalStartDate)],
          ["Délai d'instruction", `${doc.effectiveLeadTime} jours`],
          ["Démarche engagée", doc.renewalStartedAt ? fr(doc.renewalStartedAt) : "Non"],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div key={k} className="flex justify-between py-1.5 border-b border-line">
            <span className="text-ink2">{k}</span>
            <span className="text-ink font-medium">{v}</span>
          </div>
        ))}
      </div>

      {spec?.hint && <Inset tone="info">{spec.hint}</Inset>}

      {/* Enregistrer le renouvellement fait avancer l'échéance sur la même
          fiche : l'historique et les pièces jointes restent réunis. */}
      <div className="rounded-xl border border-line p-4 space-y-3">
        <h3 className="font-semibold text-ink text-sm">Le nouveau document est arrivé</h3>
        <FormField label="Nouvelle échéance" required>
          <input type="date" className={inputCls} value={until}
            onChange={e => setUntil(e.target.value)} />
        </FormField>
        <button
          disabled={!until}
          onClick={() => { onAction({ renewedUntil: until }); onDone(); }}
          className="px-4 h-10 rounded-lg bg-pos text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
          Enregistrer le renouvellement
        </button>
      </div>

      {doc.renewalStartedAt && (
        <button onClick={() => { onAction({ renewalStarted: false }); onDone(); }}
          className="text-xs text-ink2 hover:text-neg underline">
          Annuler la démarche engagée — l&apos;alerte reprendra
        </button>
      )}

      <div className="flex items-center gap-2 text-xs text-ink2">
        <Paperclip size={13} /> Le document lui-même, ses justificatifs, l&apos;accusé de dépôt.
      </div>
      <AttachmentPanel
        host="documents"
        hostId={doc._id}
        title="Pièces du dossier"
        categories={["contrat", "justificatif", "courrier", "autre"]}
        defaultCategory="justificatif"
      />
    </div>
  );
}

function AddDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    label: "", type: "arf" as DocumentType, reference: "", issuer: "",
    issuedAt: "", expiresAt: "", leadTimeDays: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = DOCUMENT_TYPES[form.type];

  // L'échéance se déduit dès que la nature et la date de délivrance sont
  // connues — on la propose, sans jamais l'imposer : une attestation peut
  // porter une durée particulière.
  function pickType(type: DocumentType) {
    setForm(f => {
      const expiresAt = f.issuedAt && !f.expiresAt
        ? suggestedExpiry(type, f.issuedAt)?.toISOString().slice(0, 10) ?? ""
        : f.expiresAt;
      return { ...f, type, expiresAt, label: f.label || DOCUMENT_TYPES[type].label };
    });
  }

  function pickIssued(value: string) {
    setForm(f => {
      const suggested = value ? suggestedExpiry(f.type, value) : null;
      return {
        ...f, issuedAt: value,
        expiresAt: !f.expiresAt && suggested ? suggested.toISOString().slice(0, 10) : f.expiresAt,
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/documents-administratifs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création refusée");
      setForm(f => ({ ...f, label: "", reference: "", issuedAt: "", expiresAt: "", notes: "" }));
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ajouter un document administratif" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Nature" required>
          <select className={selectCls} value={form.type}
            onChange={e => pickType(e.target.value as DocumentType)}>
            {Object.entries(DOCUMENT_TYPES).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
        </FormField>

        {spec.hint && <Inset tone="info">{spec.hint}</Inset>}

        <FormField label="Intitulé" required>
          <input className={inputCls} value={form.label} required
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </FormField>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Référence">
            <input className={inputCls} value={form.reference}
              onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
          </FormField>
          <FormField label="Délivré par" hint="C'est chez elle qu'il faudra retourner.">
            <input className={inputCls} value={form.issuer} placeholder="DGI, CNSS, mairie…"
              onChange={e => setForm(f => ({ ...f, issuer: e.target.value }))} />
          </FormField>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Délivré le">
            <input type="date" className={inputCls} value={form.issuedAt}
              onChange={e => pickIssued(e.target.value)} />
          </FormField>
          <FormField label="Expire le"
            hint={spec.validityDays ? `Proposé d'après une validité de ${spec.validityDays} jours.` : "Laisser vide si le document n'expire pas."}>
            <input type="date" className={inputCls} value={form.expiresAt}
              onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
          </FormField>
        </div>

        <FormField label="Délai d'instruction (jours)"
          hint={`Par défaut ${spec.leadTimeDays} jours pour cette nature. Corrigez-le d'après votre expérience réelle : c'est lui qui fixe la date d'alerte.`}>
          <input type="number" min={0} className={inputCls} value={form.leadTimeDays}
            placeholder={String(spec.leadTimeDays)}
            onChange={e => setForm(f => ({ ...f, leadTimeDays: e.target.value }))} />
        </FormField>

        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </FormField>

        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button type="button" onClick={onClose}
            className={buttonClass("secondary", "md")}>
            Annuler
          </button>
          <button type="submit" disabled={saving || !form.label.trim()}
            className={buttonClass("primary", "md")}>
            {saving ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
