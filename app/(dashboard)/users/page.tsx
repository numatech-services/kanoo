"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UserPlus, KeyRound, LogOut, ShieldCheck, Copy, Check, Link2,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { Avatar, Pill, Inset, FilterChips } from "@/components/ui/Primitives";
import { ROLE_UI, ASSIGNABLE_BY_TENANT, isTenantAdmin } from "@/lib/roles-ui";
import { MIN_LENGTH } from "@/lib/password-policy";
import type { UserRole } from "@/types";
import { AccessEditor, accessPayload, accessChip, emptyAccess, type Access, type Level } from "@/components/users/AccessEditor";

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roles?: string[];
  roleLevels?: Record<string, string>;
  siteIds?: string[];
  accessUntil?: string;
  isActive: boolean;
  lastLoginAt?: string;
  mustChangePassword?: boolean;
}

interface Employee { _id: string; firstName: string; lastName: string; code?: string; userId?: string }

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenantType, setTenantType] = useState("pme");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reset, setReset] = useState<{ user: User; password: string } | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, me] = await Promise.all([
        fetch(`/api/users?page=${page}&limit=${LIMIT}`, { credentials: "include" }).then(r => r.json()),
        fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).catch(() => null),
      ]);
      setUsers(u.data?.items || []);
      setTotal(u.data?.pagination?.total || 0);
      // /api/auth/me renvoie le type sous tenant.type (tenantType n'existe pas) :
      // sans cela, une association se voyait proposer les rôles d'une PME.
      const type = me?.data?.tenant?.type ?? me?.data?.tenantType;
      if (type) setTenantType(type);
      setError(null);
    } catch {
      setError("Lecture des comptes impossible.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/employees?limit=300", { credentials: "include" })
      .then(r => r.json())
      .then(d => setEmployees(d.data?.items || []))
      .catch(() => { /* le rattachement reste facultatif */ });
  }, []);

  async function patch(user: User, body: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/users/${user._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Modification refusée");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    }
  }

  async function resetPassword(user: User) {
    if (!window.confirm(
      `Réinitialiser le mot de passe de ${user.firstName} ${user.lastName} ?\n\n`
      + `Un mot de passe temporaire sera généré et toutes ses sessions seront fermées.`
    )) return;
    setError(null);
    try {
      const res = await fetch(`/api/users/${user._id}/password`, {
        method: "POST",
        headers: { "x-csrf-token": await csrf() },
        credentials: "include",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Réinitialisation refusée");
      setReset({ user, password: d.data.temporaryPassword });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Réinitialisation impossible");
    }
  }

  async function revoke(user: User) {
    if (!window.confirm(`Fermer les sessions de ${user.firstName} ${user.lastName} ?`)) return;
    try {
      const res = await fetch(`/api/users/${user._id}/revoke-session`, {
        method: "POST",
        headers: { "x-csrf-token": await csrf() },
        credentials: "include",
      });
      const d = await res.json();
      setNotice(res.ok ? (d.data?.message || "Sessions fermées.") : null);
      if (!res.ok) setError(d.error || "Révocation refusée");
    } catch {
      setError("Révocation impossible.");
    }
  }

  async function linkEmployee(user: User, employeeId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({ userId: employeeId ? user._id : null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Rattachement refusé");
      setNotice("Compte rattaché à la fiche salarié : ses notes de frais lui seront remboursées.");
      fetch("/api/employees?limit=300", { credentials: "include" })
        .then(r => r.json()).then(d => setEmployees(d.data?.items || []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rattachement impossible");
    }
  }

  const roles = ASSIGNABLE_BY_TENANT[tenantType] ?? ASSIGNABLE_BY_TENANT.pme;
  const groups = [...new Set(roles.map(r => ROLE_UI[r]?.group).filter(Boolean))] as string[];
  const rolesOf = (u: User) => (u.roles?.length ? u.roles : [u.role]);
  const isLegacyUser = (u: User) => rolesOf(u).some(r => ROLE_UI[r as UserRole]?.legacy);
  const legacyCount = users.filter(u => u.isActive && isLegacyUser(u)).length;
  const shown = group === "__legacy"
    ? users.filter(isLegacyUser)
    : group ? users.filter(u => rolesOf(u).some(r => ROLE_UI[r as UserRole]?.group === group)) : users;
  const activeAdmins = users.filter(u => u.isActive && isTenantAdmin(u.role)).length;

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink">Comptes &amp; droits</h1>
          <p className="text-sm text-ink2">
            {total} compte{total > 1 ? "s" : ""} · {activeAdmins} administrateur{activeAdmins > 1 ? "s" : ""} actif{activeAdmins > 1 ? "s" : ""}
          </p>
        </div>
        <button onClick={() => setInviteOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <UserPlus size={16} /> Nouveau compte
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {activeAdmins === 1 && (
        <Inset tone="warn">
          Un seul administrateur actif. S&apos;il perd son accès, plus personne ne pourra
          créer de compte ni modifier un rôle — la reprise demanderait une intervention
          en base. Désignez-en un second.
        </Inset>
      )}

      {legacyCount > 0 && (
        <Inset tone="warn">
          {legacyCount} compte{legacyCount > 1 ? "s portent" : " porte"} encore un ancien rôle. Attribuez-leur un service
          avec « Modifier l&apos;accès » puis retirez l&apos;ancien rôle : certains donnent encore accès aux finances.
        </Inset>
      )}

      <FilterChips
        options={[
          ...groups.map(g => ({
            key: g, label: g,
            count: users.filter(u => rolesOf(u).some(r => ROLE_UI[r as UserRole]?.group === g)).length,
          })),
          ...(legacyCount ? [{ key: "__legacy", label: "Anciens rôles", count: users.filter(isLegacyUser).length }] : []),
        ]}
        value={group}
        onChange={setGroup}
      />

      {loading ? (
        <div className="surface-card p-6 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-surface2 animate-pulse" />)}
        </div>
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[62rem]">
              <thead>
                <tr>
                  <th>Personne</th><th>Rôle</th><th>Fiche salarié</th>
                  <th>Dernière connexion</th><th>État</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-ink3">Aucun compte.</td></tr>
                )}
                {shown.map(user => {
                  const linked = employees.find(e => e.userId === user._id);
                  return (
                    <tr key={user._id}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                          <span>
                            <span className="block text-ink font-medium">
                              {user.firstName} {user.lastName}
                            </span>
                            <span className="block text-[11px] text-ink3">{user.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {/* Services cumulés, chacun avec son niveau ; l'édition se fait
                            dans une fenêtre dédiée (niveaux, sites, fin de stage). */}
                        <span className="flex flex-wrap gap-1 mb-1 max-w-[17rem]">
                          {rolesOf(user).map(r => (
                            <span key={r} className={`pill ${ROLE_UI[r as UserRole]?.legacy ? "pill-warn" : "pill-section"}`}>
                              {accessChip(r, user.roleLevels?.[r])}
                            </span>
                          ))}
                        </span>
                        {user.accessUntil && (
                          <span className={`block text-[11px] ${new Date(user.accessUntil) < new Date() ? "text-neg" : "text-ink3"}`}>
                            Accès jusqu&apos;au {new Date(user.accessUntil).toLocaleDateString("fr-FR")}
                          </span>
                        )}
                        <button onClick={() => setEditing(user)} className="text-xs text-section hover:underline">
                          Modifier l&apos;accès
                        </button>
                      </td>
                      <td>
                        {/* Sans ce rattachement, « mes notes de frais » ne sait pas
                            de qui il s'agit, et un remboursement ne sait pas à qui
                            il est dû. */}
                        <select
                          value={linked?._id ?? ""}
                          onChange={e => e.target.value && linkEmployee(user, e.target.value)}
                          className="h-8 px-2 rounded border border-line2 bg-surface text-xs text-ink2 max-w-[11rem]">
                          <option value="">— Non rattaché —</option>
                          {employees
                            .filter(e => !e.userId || e.userId === user._id)
                            .map(e => (
                              <option key={e._id} value={e._id}>
                                {e.firstName} {e.lastName}
                              </option>
                            ))}
                        </select>
                        {!linked && (
                          <p className="text-[11px] text-warn mt-1 flex items-center gap-1">
                            <Link2 size={10} /> Pas de remboursement possible
                          </p>
                        )}
                      </td>
                      <td className="text-ink2 text-xs whitespace-nowrap">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString("fr-FR")
                          : <span className="text-ink3">Jamais</span>}
                      </td>
                      <td>
                        <span className="flex flex-col gap-1 items-start">
                          <StatusBadge status={user.isActive ? "active" : "inactive"} />
                          {user.mustChangePassword && (
                            <Pill tone="warn">Mot de passe temporaire</Pill>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-1">
                          <button onClick={() => resetPassword(user)}
                            title="Réinitialiser le mot de passe"
                            className="p-1.5 rounded-lg text-ink3 hover:text-section hover:bg-section-soft">
                            <KeyRound size={14} />
                          </button>
                          <button onClick={() => revoke(user)}
                            title="Fermer ses sessions"
                            className="p-1.5 rounded-lg text-ink3 hover:text-warn hover:bg-warn-50">
                            <LogOut size={14} />
                          </button>
                          <button onClick={() => patch(user, { isActive: !user.isActive })}
                            title={user.isActive ? "Désactiver le compte" : "Réactiver le compte"}
                            className={`p-1.5 rounded-lg ${
                              user.isActive
                                ? "text-ink3 hover:text-neg hover:bg-neg-50"
                                : "text-pos hover:bg-pos-50"
                            }`}>
                            <ShieldCheck size={14} />
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

      <Pagination page={page} totalPages={Math.ceil(total / LIMIT) || 1}
        total={total} limit={LIMIT} onPage={setPage} />

      {editing && (
        <EditAccessDialog user={editing} roles={roles} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNotice("Accès mis à jour. Les sessions ouvertes de cette personne ont été fermées."); load(); }} />
      )}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)}
        roles={roles} onCreated={() => { setInviteOpen(false); load(); }} />

      {/* Le mot de passe temporaire n'est affiché qu'une fois. */}
      <Modal open={Boolean(reset)} onClose={() => setReset(null)} title="Mot de passe temporaire">
        {reset && <TemporaryPasswordPanel user={reset.user} password={reset.password} />}
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TemporaryPasswordPanel({ user, password }: { user: User; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink2">
        Pour <strong className="text-ink">{user.firstName} {user.lastName}</strong> ({user.email}).
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-4 py-3 rounded-lg bg-surface2 border border-line2 font-mono text-lg text-ink tracking-wide">
          {password}
        </code>
        <button
          onClick={() => { navigator.clipboard?.writeText(password); setCopied(true); }}
          className="p-3 rounded-lg border border-line2 text-ink2 hover:bg-surface2">
          {copied ? <Check size={16} className="text-pos" /> : <Copy size={16} />}
        </button>
      </div>
      <Inset tone="warn">
        Il ne sera plus affiché. Transmettez-le de vive voix ou par téléphone — les
        syllabes se dictent sans ambiguïté. Toutes les sessions de cette personne ont
        été fermées, et elle devra choisir un nouveau mot de passe dès sa connexion.
      </Inset>
    </div>
  );
}

function InviteDialog({
  open, onClose, roles, onCreated,
}: { open: boolean; onClose: () => void; roles: UserRole[]; onCreated: () => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [access, setAccess] = useState<Access>(emptyAccess());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (access.roles.length === 0) { setError("Choisissez au moins un service ou le rôle de gérant."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({ ...form, ...accessPayload(access) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création refusée");
      setForm({ firstName: "", lastName: "", email: "", password: "" });
      setAccess(emptyAccess());
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau compte" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Prénom" required>
            <input className={inputCls} value={form.firstName} required
              onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
          </FormField>
          <FormField label="Nom" required>
            <input className={inputCls} value={form.lastName} required
              onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </FormField>
        </div>

        <FormField label="Adresse e-mail" required
          hint="Elle sert d'identifiant de connexion et doit être unique dans l'organisation.">
          <input type="email" className={inputCls} value={form.email} required
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </FormField>

        <FormField label="Accès" required
          hint="Cochez le ou les services de la personne et son niveau dans chacun. Le premier coché est le rôle principal.">
          <AccessEditor value={access} onChange={setAccess} assignable={roles} />
        </FormField>

        <FormField label="Mot de passe initial" required
          hint={`${MIN_LENGTH} caractères au minimum. Une phrase courte fait un bon mot de passe et se retient.`}>
          <input type="text" className={inputCls} value={form.password} required
            placeholder="le thé de 16h à Dosso"
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        </FormField>

        <p className="text-xs text-ink2">
          Le mot de passe est affiché en clair pendant la saisie&nbsp;: vous devez le
          transmettre, le masquer ne protégerait de personne et provoquerait des fautes
          de frappe. La personne pourra le changer depuis son profil.
        </p>

        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button type="button" onClick={onClose}
            className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            Annuler
          </button>
          <button type="submit" disabled={saving}
            className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Création…" : "Créer le compte"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditAccessDialog({ user, roles, onClose, onSaved }: {
  user: User; roles: UserRole[]; onClose: () => void; onSaved: () => void;
}) {
  const [access, setAccess] = useState<Access>({
    roles: user.roles?.length ? user.roles : [user.role],
    roleLevels: (user.roleLevels ?? {}) as Record<string, Level>,
    siteIds: (user.siteIds ?? []).map(String),
    accessUntil: user.accessUntil ? String(user.accessUntil).slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (access.roles.length === 0) { setError("Au moins un rôle par collaborateur."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/users/${user._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(accessPayload(access)),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Modification refusée");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Accès de ${user.firstName} ${user.lastName}`} size="lg">
      <div className="space-y-4">
        <AccessEditor value={access} onChange={setAccess} assignable={roles} />
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Enregistrement…" : "Enregistrer l'accès"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
