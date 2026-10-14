"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookUser, Users, RefreshCw, Hourglass, BadgeCheck, Upload, Download, Plus, Search, FileSpreadsheet, History, Send, Camera,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { Pagination } from "@/components/ui/Pagination";
import { academicYearOf, shiftAcademicYear } from "@/lib/isic-registry";
import { EnvoiIsic } from "@/components/isic/EnvoiIsic";
import { compressPhoto } from "@/components/isic/image";
import { useMe, meCanDo } from "@/lib/useMe";

import { showToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
interface SchoolRow { school: string; students: number; withNumber: number; withoutPhoto: number; covered: number; fresh: number; renewed: number; toRenew: number }
interface Stats {
  year: string;
  totals: { students: number; withNumber: number; withoutNumber: number; coveredWithoutNumber: number; coveredWithoutPhoto: number; covered: number; fresh: number; renewed: number; returning: number; toRenew: number };
  bySchool: SchoolRow[];
  years: string[];
}
interface Student {
  _id: string; fullName: string; firstName?: string; lastName?: string; matricule?: string; schoolName: string; className?: string;
  isicNumber?: string; email?: string; phone?: string; hasPhoto?: boolean; years: string[];
}
interface Report { rows: number; created: number; updated: number; numbersAssigned: number; licencesCreated: number; conflicts: { line: number; name: string; reason: string }[]; skipped: { line: number; reason: string }[] }

async function api<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE" = "POST", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json", "x-csrf-token": await getCsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Opération refusée");
  return d.data as T;
}
const n = (v: number) => v.toLocaleString("fr-FR");

export default function RegistrePage() {
  const [year, setYear] = useState(academicYearOf());
  const [tab, setTab] = useState<"dashboard" | "students" | "import" | "envoi">("dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [schoolFilter, setSchoolFilter] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("");

  const loadStats = useCallback(() => {
    fetch(`/api/isic/registry/stats?year=${year}`, { credentials: "include" })
      .then(r => r.json()).then(d => setStats(d.data ?? null)).catch(() => {});
  }, [year]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const tabCls = (on: boolean) => `px-4 h-10 inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
    on ? "bg-section text-white" : "text-ink2 hover:bg-surface2 border border-line2"}`;
  const openStudents = (school = "", coverage = "") => { setSchoolFilter(school); setCoverageFilter(coverage); setTab("students"); };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="page-head">
        <div>
          <Link href="/isic" className="text-xs text-ink2 hover:text-ink">← Cartes ISIC</Link>
          <h1 className="page-title flex items-center gap-2 mt-1"><BookUser size={22} /> Registre ISIC</h1>
          <p className="text-sm text-ink2">Une fiche par étudiant, son numéro ISIC (qu&apos;il garde d&apos;une année à l&apos;autre) et ses licences annuelles.</p>
        </div>
        <FormField label="Année académique">
          <select className={selectCls} value={year} onChange={e => setYear(e.target.value)}>
            {(stats?.years ?? [year]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </FormField>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={tabCls(tab === "dashboard")} onClick={() => setTab("dashboard")}><BadgeCheck size={16} /> Licences</button>
        <button className={tabCls(tab === "students")} onClick={() => openStudents()}><Users size={16} /> Étudiants</button>
        <button className={tabCls(tab === "import")} onClick={() => setTab("import")}><Upload size={16} /> Import / Export</button>
        <button className={tabCls(tab === "envoi")} onClick={() => setTab("envoi")}><Send size={16} /> Envoi ISIC</button>
      </div>

      {tab === "dashboard" && <Dashboard stats={stats} year={year} onChanged={loadStats} openStudents={openStudents} goImport={() => setTab("import")} />}
      {tab === "students" && <StudentsTab key={`${schoolFilter}|${coverageFilter}|${year}`} year={year} schools={stats?.bySchool.map(s => s.school) ?? []}
        initialSchool={schoolFilter} initialCoverage={coverageFilter} onChanged={loadStats} />}
      {tab === "import" && <ImportTab year={year} schools={stats?.bySchool.map(s => s.school) ?? []} onChanged={loadStats} />}
      {tab === "envoi" && <EnvoiIsic year={year} schools={stats?.bySchool.map(s => s.school) ?? []} onChanged={loadStats} />}
    </div>
  );
}

// ── Tableau de bord des licences ─────────────────────────────────────────────
function Dashboard({ stats, year, onChanged, openStudents, goImport }: {
  stats: Stats | null; year: string; onChanged: () => void; openStudents: (school?: string, coverage?: string) => void; goImport: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!stats) return <div className="h-48 surface-card animate-pulse" />;
  const t = stats.totals;
  const prev = shiftAcademicYear(year, -1);

  async function renewAll() {
    if (!(await confirmDialog({ title: `Ouvrir la licence ${year} pour les ${t.toRenew} étudiants couverts en ${prev} ?`, message: `Ils gardent leur numéro ISIC.` }))) return;
    setBusy(true);
    try {
      const r = await api<{ renewed: number }>("/api/isic/registry/renew", "POST", { toYear: year });
      showToast(`${r.renewed} licence(s) ${year} ouverte(s).`, "success");
      onChanged();
    } catch (e) { showToast(e instanceof Error ? e.message : "Renouvellement impossible", "error"); } finally { setBusy(false); }
  }

  if (t.students === 0) {
    return (
      <div className="space-y-3">
        <EmptyState icon={<BookUser size={20} />} title="Registre vide"
          hint="Commencez par reprendre vos étudiants existants avec leur numéro — par exemple les fichiers reçus d'ISIC des années passées (.xlsx)." />
        <div className="text-center"><button onClick={goImport} className={buttonClass("primary", "md")}>Importer les étudiants existants</button></div>
      </div>
    );
  }

  const Card = ({ icon, label, value, sub, tone, action }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone?: string; action?: React.ReactNode }) => (
    <div className="surface-card p-4 flex flex-col">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink2 inline-flex items-center gap-1.5">{icon} {label}</p>
      <p className={`mt-1.5 text-3xl font-bold ${tone ?? "text-ink"}`}>{n(value)}</p>
      {sub && <p className="text-xs text-ink2 mt-1">{sub}</p>}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <Card icon={<BadgeCheck size={14} />} label={`Licences ${year}`} value={t.covered} tone="text-section"
          sub={`${n(t.fresh)} nouveaux · ${n(t.renewed)} renouvelés${t.returning ? ` · ${n(t.returning)} retours` : ""}`}
          action={<button onClick={() => openStudents("", "covered")} className="text-xs font-semibold text-section hover:underline">Voir la liste →</button>} />
        <Card icon={<RefreshCw size={14} />} label="À renouveler" value={t.toRenew} tone={t.toRenew ? "text-warn" : undefined}
          sub={`Couverts en ${prev}, pas encore en ${year}`}
          action={t.toRenew > 0 && (
            <div className="flex gap-3 items-center">
              <button disabled={busy} onClick={renewAll} className={buttonClass("primary", "sm")}>Renouveler tous</button>
              <button onClick={() => openStudents("", "torenew")} className="text-xs font-semibold text-section hover:underline">Choisir →</button>
            </div>
          )} />
        <Card icon={<Hourglass size={14} />} label="En attente de numéro" value={t.coveredWithoutNumber} tone={t.coveredWithoutNumber ? "text-warn" : undefined}
          sub={`Couverts en ${year} sans numéro ISIC`}
          action={t.coveredWithoutNumber > 0 && (
            <a href={`/api/isic/registry/export?filter=pending&year=${year}`} className={buttonClass("secondary", "sm")}>
              <Download size={13} /> Liste à envoyer à ISIC
            </a>
          )} />
        <Card icon={<Camera size={14} />} label="Sans photo" value={t.coveredWithoutPhoto} tone={t.coveredWithoutPhoto ? "text-warn" : undefined}
          sub={`Licences ${year} sans photo : carte impossible`}
          action={t.coveredWithoutPhoto > 0 && <button onClick={() => openStudents("", "covered-nophoto")} className="text-xs font-semibold text-section hover:underline">Voir la liste →</button>} />
        <Card icon={<Users size={14} />} label="Étudiants au registre" value={t.students}
          sub={`${n(t.withNumber)} avec numéro · ${n(t.withoutNumber)} sans`} />
      </div>

      <div className="surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line"><h2 className="font-semibold text-ink">Par établissement — {year}</h2></div>
        <div className="overflow-x-auto">
        <table className="table-dense">
          <thead><tr><th>Établissement</th><th className="text-right">Étudiants</th><th className="text-right">Avec n°</th><th className="text-right">Licences {year}</th><th className="text-right">Nouveaux</th><th className="text-right">Renouvelés</th><th className="text-right">À renouveler</th><th className="text-right">Sans photo</th></tr></thead>
          <tbody>
            {stats.bySchool.map(s => (
              <tr key={s.school} className="cursor-pointer hover:bg-surface2/50" onClick={() => openStudents(s.school)}>
                <td className="text-ink font-medium">{s.school}</td>
                <td className="text-right font-mono">{n(s.students)}</td>
                <td className="text-right font-mono">{n(s.withNumber)}</td>
                <td className="text-right font-mono font-semibold text-section">{n(s.covered)}</td>
                <td className="text-right font-mono">{n(s.fresh)}</td>
                <td className="text-right font-mono">{n(s.renewed)}</td>
                <td className={`text-right font-mono ${s.toRenew ? "text-warn font-semibold" : ""}`}>{n(s.toRenew)}</td>
                <td className={`text-right font-mono ${s.withoutPhoto ? "text-warn font-semibold" : ""}`}>{n(s.withoutPhoto)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ── Liste des étudiants ─────────────────────────────────────────────────────
function StudentsTab({ year, schools, initialSchool, initialCoverage, onChanged }: {
  year: string; schools: string[]; initialSchool: string; initialCoverage: string; onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [school, setSchool] = useState(initialSchool);
  const [number, setNumber] = useState("");
  const [coverage, setCoverage] = useState(initialCoverage === "covered-nophoto" ? "covered" : initialCoverage);
  const [photo, setPhoto] = useState(initialCoverage === "covered-nophoto" ? "without" : "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Student[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const canPurge = meCanDo(useMe(), "isic", "delete");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const LIMIT = 50;

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (q.trim()) p.set("q", q.trim());
    if (school) p.set("school", school);
    if (number) p.set("number", number);
    if (coverage) { p.set("coverage", coverage); p.set("year", year); }
    if (photo) p.set("photo", photo);
    fetch(`/api/isic/registry/students?${p}`, { credentials: "include" }).then(r => r.json())
      .then(d => setData({ items: d.data?.items ?? [], total: d.data?.pagination?.total ?? 0 }))
      .finally(() => setLoading(false));
  }, [page, q, school, number, coverage, photo, year]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function purgeSelected() {
    if (!(await confirmDialog({ title: `Supprimer DÉFINITIVEMENT ${selected.size} fiche(s) saisie(s) par erreur ?`, message: `Fiches, photos et licences effacées ; les numéros ISIC redeviennent libres. Action irréversible.`, danger: true }))) return;
    try {
      const r = await api<{ deleted: number; licenses: number }>("/api/isic/registry/students/delete", "POST", { studentIds: [...selected] });
      setSelected(new Set());
      showToast(`${r.deleted} fiche(s) supprimée(s)${r.licenses ? `, ${r.licenses} licence(s) effacée(s)` : ""}.`, "success");
      load(); onChanged();
    } catch (e) { showToast(e instanceof Error ? e.message : "Suppression impossible", "error"); }
  }
  async function renewSelected() {
    if (!(await confirmDialog({ title: `Ouvrir la licence ${year} pour ${selected.size} étudiant(s) ?`, message: `Ils gardent leur numéro.` }))) return;
    try {
      const r = await api<{ renewed: number; alreadyCovered: number }>("/api/isic/registry/renew", "POST", { toYear: year, studentIds: [...selected] });
      showToast(`${r.renewed} licence(s) ouverte(s)${r.alreadyCovered ? `, ${r.alreadyCovered} déjà couvert(s)` : ""}.`, "success");
      setSelected(new Set()); load(); onChanged();
    } catch (e) { showToast(e instanceof Error ? e.message : "Renouvellement impossible", "error"); }
  }
  const toggle = (id: string) => setSelected(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input className={`${inputCls} pl-9`} placeholder="Nom, matricule ou numéro ISIC" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className={`${selectCls} w-auto`} value={school} onChange={e => { setSchool(e.target.value); setPage(1); }}>
          <option value="">Tous les établissements</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={`${selectCls} w-auto`} value={number} onChange={e => { setNumber(e.target.value); setPage(1); }}>
          <option value="">Avec ou sans numéro</option>
          <option value="with">Avec numéro</option>
          <option value="without">En attente de numéro</option>
        </select>
        <select className={`${selectCls} w-auto`} value={coverage} onChange={e => { setCoverage(e.target.value); setPage(1); }}>
          <option value="">Toutes licences</option>
          <option value="covered">Licence {year}</option>
          <option value="notcovered">Sans licence {year}</option>
          <option value="torenew">À renouveler ({year})</option>
        </select>
        <select className={`${selectCls} w-auto`} value={photo} onChange={e => { setPhoto(e.target.value); setPage(1); }}>
          <option value="">Avec ou sans photo</option>
          <option value="with">Avec photo</option>
          <option value="without">Sans photo</option>
        </select>
        <button onClick={() => setAdding(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Ajouter
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-section/5 border border-section/25 text-sm">
          <span>{selected.size} étudiant(s) sélectionné(s)</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="px-3 h-8 rounded-lg border border-line2 text-xs text-ink2">Désélectionner</button>
            {canPurge && <button onClick={purgeSelected} className="px-3 h-8 rounded-lg border border-neg/40 text-neg text-xs font-semibold hover:bg-neg-50">Supprimer</button>}
            <button onClick={renewSelected} className={buttonClass("primary", "sm")}>Ouvrir la licence {year}</button>
          </div>
        </div>
      )}

      {loading && data.items.length === 0 ? <div className="h-48 surface-card animate-pulse" /> : data.items.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title="Aucun étudiant" hint="Aucun étudiant ne correspond à ces critères." />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th className="w-8"></th><th>Étudiant</th><th>Personal ID</th><th>Établissement</th><th>N° ISIC</th><th>Photo</th><th>Licences</th></tr></thead>
            <tbody>
              {data.items.map(s => (
                <tr key={s._id} className="hover:bg-surface2/50">
                  <td><input type="checkbox" checked={selected.has(s._id)} onChange={() => toggle(s._id)} aria-label={`Sélectionner ${s.fullName}`} /></td>
                  <td><button onClick={() => setOpenId(s._id)} className="text-ink font-medium hover:text-section text-left">{s.fullName}</button></td>
                  <td className="font-mono text-xs text-ink2">{s.matricule || "—"}</td>
                  <td className="text-ink2">{s.schoolName}{s.className && <div className="text-[11px] text-ink3">{s.className}</div>}</td>
                  <td className="font-mono text-xs">{s.isicNumber || <Pill tone="warn">En attente</Pill>}</td>
                  <td>{s.hasPhoto ? <Pill tone="pos">Oui</Pill> : <Pill tone="neg">Non</Pill>}</td>
                  <td className="space-x-1">
                    {s.years.length === 0 ? <span className="text-xs text-ink3">—</span> : s.years.slice(0, 3).map(y =>
                      <Pill key={y} tone={y === year ? "pos" : "mute"}>{y}</Pill>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      <Pagination page={page} totalPages={Math.ceil(data.total / LIMIT)} total={data.total} limit={LIMIT} onPage={setPage} />

      {openId && <StudentDialog id={openId} year={year} onClose={() => setOpenId(null)} onSaved={() => { load(); onChanged(); }} />}
      {adding && <AddStudentDialog year={year} schools={schools} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); onChanged(); }} />}
    </div>
  );
}

function AddStudentDialog({ year, schools, onClose, onSaved }: { year: string; schools: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: "", matricule: "", schoolName: "", isicNumber: "", email: "", phone: "", licence: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await api<{ warning?: string }>("/api/isic/registry/students", "POST", {
        fullName: f.fullName, matricule: f.matricule, schoolName: f.schoolName, isicNumber: f.isicNumber,
        email: f.email, phone: f.phone, academicYear: f.licence ? year : undefined,
      });
      if (r?.warning) showToast(`Étudiant ajouté, mais le numéro a été refusé : ${r.warning}`, "warning");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Ajout impossible"); } finally { setSaving(false); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(x => ({ ...x, [k]: k === "licence" ? e.target.checked : e.target.value }));
  return (
    <Modal open onClose={onClose} title="Ajouter un étudiant" size="md">
      <div className="space-y-3">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Nom complet" required><input className={inputCls} value={f.fullName} onChange={set("fullName")} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Matricule"><input className={inputCls} value={f.matricule} onChange={set("matricule")} /></FormField>
          <FormField label="Établissement" required>
            <input className={inputCls} list="isic-schools" value={f.schoolName} onChange={set("schoolName")} />
            <datalist id="isic-schools">{schools.map(s => <option key={s} value={s} />)}</datalist>
          </FormField>
          <FormField label="Numéro ISIC" hint="Si l'étudiant en a déjà un"><input className={inputCls} value={f.isicNumber} onChange={set("isicNumber")} /></FormField>
          <FormField label="Téléphone"><input className={inputCls} value={f.phone} onChange={set("phone")} /></FormField>
        </div>
        <FormField label="Email"><input className={inputCls} type="email" value={f.email} onChange={set("email")} /></FormField>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.licence} onChange={set("licence")} /> Ouvrir la licence {year}</label>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Ajout…" : "Ajouter"}</button>
        </div>
      </div>
    </Modal>
  );
}

interface StudentDetail {
  student: Student & { notes?: string; dateOfBirth?: string; city?: string; nationality?: string; cardStatus?: string; numberHistory: { number: string; at: string; reason?: string }[] };
  licences: { _id: string; academicYear: string; status: string; validUntil: string; source: string }[];
  cards: { _id: string; status: string; batchId?: { _id: string; reference: string; academicYear?: string } }[];
}

function StudentDialog({ id, year, onClose, onSaved }: { id: string; year: string; onClose: () => void; onSaved: () => void }) {
  // Archivage réservé au chef de service et au gérant.
  const canArchive = meCanDo(useMe(), "isic", "delete");
  const [d, setD] = useState<StudentDetail | null>(null);
  const [f, setF] = useState({ firstName: "", lastName: "", fullName: "", matricule: "", schoolName: "", className: "", dateOfBirth: "", city: "", nationality: "", email: "", phone: "", notes: "", isicNumber: "", numberReason: "" });
  const [photoV, setPhotoV] = useState(0); // force le rechargement de la vignette
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/isic/registry/students/${id}`, { credentials: "include" }).then(r => r.json()).then(x => {
      const data: StudentDetail = x.data; setD(data);
      const s = data.student;
      setF({
        firstName: s.firstName ?? "", lastName: s.lastName ?? "", fullName: s.fullName, matricule: s.matricule ?? "", schoolName: s.schoolName,
        className: s.className ?? "", dateOfBirth: s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10) : "", city: s.city ?? "",
        nationality: s.nationality ?? "", email: s.email ?? "", phone: s.phone ?? "", notes: s.notes ?? "", isicNumber: s.isicNumber ?? "", numberReason: "",
      });
    });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const numberChanged = !!d && (f.isicNumber.toUpperCase().replace(/[\s\-_.]/g, "") !== (d.student.isicNumber ?? ""));
  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        firstName: f.firstName, lastName: f.lastName, matricule: f.matricule, schoolName: f.schoolName, className: f.className,
        dateOfBirth: f.dateOfBirth || null, city: f.city, nationality: f.nationality, email: f.email, phone: f.phone, notes: f.notes, ...extra,
      };
      // Sans prénom/nom séparés, on garde le nom complet saisi.
      if (!f.firstName && !f.lastName) body.fullName = f.fullName;
      if (numberChanged) { body.isicNumber = f.isicNumber; body.numberReason = f.numberReason; }
      await api(`/api/isic/registry/students/${id}`, "PATCH", body);
      onSaved(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); } finally { setSaving(false); }
  }
  async function archive() {
    if (!(await confirmDialog({ title: "Archiver cet étudiant ?", message: "Son numéro reste réservé et son historique conservé." }))) return;
    try { await api(`/api/isic/registry/students/${id}`, "DELETE"); onSaved(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Archivage impossible"); }
  }
  // Fiche saisie par erreur (doublon, mauvais import) : effacée pour de bon, avec photo et licences.
  async function purge() {
    if (!(await confirmDialog({ title: "Supprimer DÉFINITIVEMENT cette fiche (saisie par erreur) ?", message: "La fiche, sa photo et ses licences sont effacées ; le numéro ISIC redevient libre. Action irréversible.", danger: true }))) return;
    try { await api(`/api/isic/registry/students/${id}?purge=1`, "DELETE"); onSaved(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  async function uploadPhoto(file: File) {
    try {
      const dataUri = await compressPhoto(file);
      await api(`/api/isic/registry/students/${id}/photo`, "POST", { dataUri, fileName: file.name });
      setPhotoV(v => v + 1); onSaved(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Photo refusée"); }
  }
  async function removePhoto() {
    if (!(await confirmDialog({ title: "Retirer la photo ?", danger: true }))) return;
    try { await api(`/api/isic/registry/photos?studentId=${id}`, "DELETE"); setPhotoV(v => v + 1); onSaved(); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); }
  }
  const hasYear = d?.licences.some(l => l.academicYear === year && l.status === "active");

  return (
    <Modal open onClose={onClose} title={d?.student.fullName ?? "Étudiant"} size="lg">
      {!d ? <div className="h-40 animate-pulse" /> : (
        <div className="space-y-4">
          {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
          <div className="flex gap-4 items-start">
            <div className="shrink-0 w-28 text-center space-y-1.5">
              {d.student.hasPhoto
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/isic/registry/students/${id}/photo?v=${photoV}`} alt="Photo" className="w-28 h-36 object-cover rounded-lg border border-line" />
                : <div className="w-28 h-36 rounded-lg border border-dashed border-neg/40 bg-neg-50 grid place-items-center text-xs text-neg">Pas de photo</div>}
              <label className="block text-xs font-semibold text-section cursor-pointer hover:underline">
                {d.student.hasPhoto ? "Remplacer" : "Ajouter"}
                <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) uploadPhoto(fl); }} />
              </label>
              {d.student.hasPhoto && <button onClick={removePhoto} className="text-xs text-neg hover:underline">Retirer</button>}
            </div>
            <div className="flex-1 grid sm:grid-cols-2 gap-3">
              <FormField label="Prénom(s)" hint="« Cardholder's First Name »"><input className={inputCls} value={f.firstName} onChange={set("firstName")} /></FormField>
              <FormField label="Nom" hint="« Cardholder's Last Name »"><input className={inputCls} value={f.lastName} onChange={set("lastName")} /></FormField>
              {!f.firstName && !f.lastName && <FormField label="Nom complet" required><input className={inputCls} value={f.fullName} onChange={set("fullName")} /></FormField>}
              <FormField label="Personal ID (matricule)"><input className={`${inputCls} font-mono`} value={f.matricule} onChange={set("matricule")} /></FormField>
              <FormField label="Date de naissance"><input className={inputCls} type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} /></FormField>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="Établissement" required><input className={inputCls} value={f.schoolName} onChange={set("schoolName")} /></FormField>
            <FormField label="Filière (Class Name)"><input className={inputCls} value={f.className} onChange={set("className")} /></FormField>
            <FormField label="Ville"><input className={inputCls} value={f.city} onChange={set("city")} /></FormField>
            <FormField label="Nationalité" hint="Conservée sur la fiche, non envoyée à ISIC"><input className={inputCls} value={f.nationality} onChange={set("nationality")} /></FormField>
            <FormField label="Téléphone"><input className={inputCls} value={f.phone} onChange={set("phone")} /></FormField>
            <FormField label="Email"><input className={inputCls} value={f.email} onChange={set("email")} /></FormField>
            <FormField label="Numéro ISIC" hint="Il suit l'étudiant d'une année à l'autre">
              <input className={`${inputCls} font-mono`} value={f.isicNumber} onChange={set("isicNumber")} placeholder="En attente du retour ISIC" />
            </FormField>
          </div>
          {numberChanged && d.student.isicNumber && (
            <FormField label="Motif du changement de numéro" required hint="Conservé dans l'historique (carte perdue, erreur de saisie…)">
              <input className={inputCls} value={f.numberReason} onChange={set("numberReason")} />
            </FormField>
          )}
          <FormField label="Notes"><textarea className={textareaCls} rows={2} value={f.notes} onChange={set("notes")} /></FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">Licences</h3>
              <ul className="space-y-1.5 text-sm">
                {d.licences.length === 0 && <li className="text-ink3 text-xs">Aucune licence.</li>}
                {d.licences.map(l => (
                  <li key={l._id} className="flex items-center justify-between gap-2">
                    <span><Pill tone={l.status === "active" ? (l.academicYear === year ? "pos" : "mute") : "neg"}>{l.academicYear}</Pill>
                      <span className="text-xs text-ink3 ml-2">valable au {new Date(l.validUntil).toLocaleDateString("fr-FR")} · {l.source}</span></span>
                    {l.status === "active" && <button onClick={async () => { if (await confirmDialog({ title: `Annuler la licence ${l.academicYear} ?`, danger: true })) save({ cancelLicence: l.academicYear }); }} className="text-xs text-neg hover:underline">Annuler</button>}
                  </li>
                ))}
              </ul>
              {!hasYear && <button onClick={() => save({ addLicence: year })} disabled={saving} className="mt-2 px-3 h-8 rounded-lg border border-section/40 text-section text-xs font-semibold">Ouvrir la licence {year}</button>}
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink mb-2 inline-flex items-center gap-1.5"><History size={14} /> Historique du numéro</h3>
              <ul className="space-y-1 text-xs text-ink2">
                {d.student.numberHistory.length === 0 && <li className="text-ink3">Aucun changement.</li>}
                {d.student.numberHistory.slice().reverse().map((h, i) => (
                  <li key={i}>{new Date(h.at).toLocaleDateString("fr-FR")} — <span className="font-mono">{h.number}</span>{h.reason ? ` · ${h.reason}` : ""}</li>
                ))}
              </ul>
              {d.cards.length > 0 && (
                <>
                  <h3 className="text-sm font-bold text-ink mt-3 mb-1">Cartes produites</h3>
                  <ul className="space-y-1 text-xs">
                    {d.cards.map(c => c.batchId && <li key={c._id}><Link href={`/isic/${c.batchId._id}`} className="text-section hover:underline">{c.batchId.reference}</Link> {c.batchId.academicYear ? `· ${c.batchId.academicYear}` : ""} · {c.status}</li>)}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-line">
            {canArchive ? <span className="flex gap-4">
              <button onClick={archive} className="text-sm text-ink2 hover:underline">Archiver</button>
              <button onClick={purge} className="text-sm text-neg hover:underline">Supprimer (erreur)</button>
            </span> : <span />}
            <div className="flex gap-3">
              <button onClick={onClose} className={buttonClass("secondary", "md")}>Fermer</button>
              <button onClick={() => save()} disabled={saving || (numberChanged && !!d.student.isicNumber && !f.numberReason.trim())}
                className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Import / Export ─────────────────────────────────────────────────────────
const TEMPLATE = "Nom;Matricule;Établissement;Numéro ISIC;Email;Téléphone;Année académique\r\n";

function ImportTab({ year, schools, onChanged }: { year: string; schools: string[]; onChanged: () => void }) {
  const [school, setSchool] = useState("");
  const [withLicence, setWithLicence] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; r: Report } | null>(null);

  function run(mode: "reprise" | "students" | "numbers", title: string, file: File) {
    // .xlsx lu tel quel (vos fichiers ISIC) ; CSV lu comme texte.
    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(mode); setReport(null);
      try {
        const r = await api<Report>("/api/isic/registry/import", "POST", {
          mode, fileName: file.name,
          ...(isExcel ? { fileBase64: String(reader.result) } : { csv: String(reader.result) }),
          schoolName: school || undefined,
          academicYear: mode !== "numbers" && withLicence ? year : undefined,
        });
        setReport({ title: `${title} — ${file.name}`, r }); onChanged();
      } catch (e) { showToast(e instanceof Error ? e.message : "Import impossible", "error"); } finally { setBusy(null); }
    };
    if (isExcel) reader.readAsDataURL(file); else reader.readAsText(file, "utf-8");
  }
  function template() {
    const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "modele-registre-isic.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const Block = ({ mode, title, text, cols }: { mode: "reprise" | "students" | "numbers"; title: string; text: string; cols: string }) => (
    <div className="surface-card p-4 flex flex-col gap-2">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="text-sm text-ink2">{text}</p>
      <p className="text-xs text-ink3">Colonnes : {cols}</p>
      <label className={`mt-auto inline-flex items-center justify-center gap-2 px-3 h-10 rounded-lg text-sm font-semibold cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""} ${mode === "numbers" ? "border border-section/40 text-section hover:bg-section/5" : "bg-section text-white hover:brightness-95"}`}>
        <Upload size={15} /> {busy === mode ? "Import en cours…" : "Choisir le fichier (Excel ou CSV)"}
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) run(mode, title, file); }} />
      </label>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="surface-card p-4 flex flex-wrap items-end gap-4">
        <FormField label="Établissement par défaut" hint="Utilisé si le fichier n'a pas de colonne « Établissement »">
          <input className={inputCls} list="isic-schools-import" value={school} onChange={e => setSchool(e.target.value)} placeholder="Ex. Université Abdou Moumouni" />
          <datalist id="isic-schools-import">{schools.map(s => <option key={s} value={s} />)}</datalist>
        </FormField>
        <label className="flex items-center gap-2 text-sm text-ink pb-2"><input type="checkbox" checked={withLicence} onChange={e => setWithLicence(e.target.checked)} /> Ouvrir la licence {year} pour les étudiants importés</label>
        <button onClick={template} className={buttonClass("secondary", "md", "ml-auto mb-0.5")}>
          <FileSpreadsheet size={15} /> Modèle CSV simplifié
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Block mode="reprise" title="1. Reprise de l'existant" cols="Fichier reçu d'ISIC, ou : Nom, Personal ID, Établissement, Numéro ISIC…"
          text="Vos étudiants actuels avec leur numéro — idéalement les fichiers reçus d'ISIC des années passées (numéro et validité repris). Doublons détectés." />
        <Block mode="students" title="2. Nouveaux étudiants" cols="Fichier envoyé à ISIC (24 colonnes), ou : Prénom, Nom, Personal ID…"
          text="Ex. « Fichier ISIC Première vague 2026-2027 » : les étudiants passent « en attente de numéro » pour l'année choisie." />
        <Block mode="numbers" title="3. Retour d'ISIC" cols="Fichier reçu d'ISIC : Card Number, Personal ID, Valid from / to"
          text="Le fichier « … AVEC N° ISIC » : numéros, statut et validité réelle. Aucun étudiant créé ; un numéro déjà pris est refusé." />
      </div>

      <div className="surface-card p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink mr-2">Exports</span>
        <a href={`/api/isic/registry/export?filter=pending&year=${year}`} className={buttonClass("primary", "md")}><Download size={15} /> À numéroter par ISIC ({year})</a>
        <a href="/api/isic/registry/export?filter=pending" className={buttonClass("secondary", "md")}><Download size={15} /> Tous les étudiants sans numéro</a>
        <a href="/api/isic/registry/export?filter=all" className={buttonClass("secondary", "md")}><Download size={15} /> Registre complet</a>
      </div>

      {report && (
        <div className="surface-card p-4 space-y-2">
          <h3 className="font-semibold text-ink">Rapport — {report.title}</h3>
          <p className="text-sm text-ink2">
            {n(report.r.rows)} ligne(s) lue(s) · {n(report.r.created)} étudiant(s) créé(s) · {n(report.r.updated)} complété(s) ·{" "}
            {n(report.r.numbersAssigned)} numéro(s) attribué(s) · {n(report.r.licencesCreated)} licence(s) ouverte(s)
          </p>
          {report.r.conflicts.length + report.r.skipped.length === 0 ? (
            <p className="text-sm text-pos font-semibold">Aucune anomalie.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              <div className="overflow-x-auto">
              <table className="table-dense">
                <thead><tr><th>Ligne</th><th>Étudiant</th><th>Anomalie</th></tr></thead>
                <tbody>
                  {report.r.conflicts.map((c, i) => <tr key={`c${i}`}><td className="font-mono">{c.line}</td><td>{c.name}</td><td className="text-warn">{c.reason}</td></tr>)}
                  {report.r.skipped.map((c, i) => <tr key={`s${i}`}><td className="font-mono">{c.line}</td><td>—</td><td className="text-ink2">{c.reason}</td></tr>)}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
