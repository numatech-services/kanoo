import { createHash } from "crypto";
import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { AuditLogModel } from "@/models/AuditLog";
import { PurchaseModel } from "@/models/Purchase";
import { UserModel } from "@/models/User";
import { ApiKeyModel } from "@/models/ApiKey";
import { TenantModel } from "@/models/Tenant";
import { AuditSealModel, AuditReportSnapshotModel } from "@/models/AuditSeal";
import { TENANT_ADMIN_ROLES } from "@/lib/roles-ui";
import { verifyTenantCached, isSerious, LATE_MS, signText, verifyText, type SealCheck } from "@/lib/audit-seal";
import { AccountingRestartModel } from "@/models/AccountingRestart";

/**
 * Rapport d'audit du mois : intégrité des écritures et du journal (sceaux),
 * opérations sensibles, séparation des tâches, revue des droits d'accès.
 * Les seuils sont des usages de contrôle interne, pas des règles légales.
 * Le mois est compté à l'heure de Niamey (UTC+1).
 */

export type Severity = "Critique" | "Majeur" | "À vérifier";
export type Finding = { severity: Severity; check: string; detail: string; count: number; items?: string[] };

const NIAMEY_MS = 3_600_000;
const DORMANT_DAYS = 90;
const BACKDATE_DAYS = 30;
const MAX_LIST = 10;
const local = (d: Date | string) => new Date(new Date(d).getTime() + NIAMEY_MS);
const day = (d: Date | string) => local(d).toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");
const createdOf = (id: Types.ObjectId) => id.getTimestamp();

export type AuditReport = {
  period: { year: number; month: number; from: Date; to: Date };
  generatedAt: Date;
  integrity: SealCheck[];
  heads: Array<{ kind: string; seq: number | null; hash: string | null }>;
  activity: { byAction: Record<string, number>; failedLogins: number; exports: number; deletions: number; entryUpdates: number; roleChanges: number; lockChanges: number };
  entries: { created: number; manual: number; reversals: number; backdated: number; restartBacklog: number; offHours: number };
  users: { total: number; active: number; admins: number; adminsWithout2fa: number; dormant: number; neverLogged: number; expiredInterns: number; apiKeys: number;
    keys: Array<{ name: string; scopes: string[]; lastUsedAt: Date | null; source: string | null }>;
    list: Array<{ email: string; name: string; roles: string[]; active: boolean; lastLoginAt: Date | null; twoFactor: boolean }> };
  findings: Finding[];
  counts: Record<Severity, number>;
};

export async function buildAuditReport(tenantId: string, year: number, month: number, now = new Date(), opts: { forceIntegrity?: boolean; minAgeMs?: number } = {}): Promise<AuditReport> {
  const tid = new Types.ObjectId(tenantId);
  const from = new Date(Date.UTC(year, month - 1, 1) - NIAMEY_MS);
  const to = new Date(Date.UTC(year, month, 1) - NIAMEY_MS - 1);
  const asOf = to < now ? to : now;
  const inMonth = { $gte: from, $lte: to };
  const idsInMonth = { $gte: Types.ObjectId.createFromTime(Math.floor(from.getTime() / 1000)), $lte: Types.ObjectId.createFromTime(Math.floor(to.getTime() / 1000)) };
  const findings: Finding[] = [];

  // 1. Intégrité
  const vopts = { force: opts.forceIntegrity, now, minAgeMs: opts.minAgeMs };
  const integrity = [await verifyTenantCached(tid, "entries", vopts), await verifyTenantCached(tid, "audit", vopts)];
  for (const c of integrity) {
    const what = c.kind === "entries" ? "des écritures" : "du journal d'audit";
    const critical = c.problems.filter(p => isSerious(p) && p.type !== "late");
    const late = c.problems.filter(p => p.type === "late" && p.seq > 1);
    const initial = c.problems.filter(p => p.type === "late" && p.seq === 1);
    const traced = c.problems.filter(p => !isSerious(p) && p.type === "modified");
    if (critical.length) findings.push({ severity: "Critique", check: `Intégrité ${what}`, count: critical.length,
      detail: "Pièces ou sceaux altérés hors de l'application : à examiner avec l'administrateur de la base.",
      items: critical.slice(0, MAX_LIST).map(p => `${p.detail}${p.id ? ` (${p.id})` : ""}`) });
    if (late.length) findings.push({ severity: "Majeur", check: `Scellement tardif ${what}`, count: late.length,
      detail: "Pièces scellées plus de 26 h après leur création : tâche de scellement interrompue, ou sceaux supprimés puis refaits. Comparez la chaîne à l'empreinte notée.", items: late.slice(0, MAX_LIST).map(p => p.detail) });
    if (initial.length) findings.push({ severity: "À vérifier", check: `Premier scellement ${what}`, count: 1, detail: initial[0].detail });
    if (traced.length) findings.push({ severity: "À vérifier", check: "Libellés ou références modifiés après scellement", count: traced.length,
      detail: "Modification par l'application, l'ancienne et la nouvelle valeur figurent au journal d'audit.", items: traced.slice(0, MAX_LIST).map(p => p.id!) });
    const stale = (c.lastSealAt && now.getTime() - new Date(c.lastSealAt).getTime() > LATE_MS && c.unsealed > 0)
      || (c.oldestUnsealedAt && now.getTime() - new Date(c.oldestUnsealedAt).getTime() > LATE_MS);
    if (stale) findings.push({ severity: "Majeur", check: `Scellement à l'arrêt ${what}`, count: c.unsealed,
      detail: `${c.unsealed} pièce(s) attendent un sceau depuis plus de 26 h : vérifiez la tâche planifiée et la clé AUDIT_SEAL_KEY.` });
  }
  // Chaîne comparée aux empreintes publiées dans les rapports précédents.
  const snaps = await AuditReportSnapshotModel.find({ tenantId: tid, generatedAt: { $lt: now } }).sort({ generatedAt: -1 }).limit(3)
    .select("year month hash kid sig report").lean<Array<{ year: number; month: number; hash: string; kid?: string; sig?: string; report?: { heads?: Array<{ kind: string; seq: number | null; hash: string | null }> } }>>();
  for (const sn of snaps) {
    const intact = !!sn.kid && !!sn.sig && verifyText(snapshotText(tenantId, sn.year, sn.month, sn.hash), sn.kid, sn.sig)
      && createHash("sha256").update(JSON.stringify(sn.report)).digest("hex") === sn.hash;
    if (!intact) findings.push({ severity: "Critique", check: "Rapport d'audit figé altéré", count: 1, detail: `Le rapport figé de ${String(sn.month).padStart(2, "0")}/${sn.year} ne correspond plus à sa signature : réécrit en base.` });
  }
  for (const sn of snaps) for (const h of sn.report?.heads ?? []) {
    if (!h.seq || !h.hash) continue;
    const s = await AuditSealModel.findOne({ tenantId: tid, kind: h.kind, seq: h.seq }).select("hash").lean<{ hash: string } | null>();
    if (!s || s.hash !== h.hash) findings.push({ severity: "Critique", check: "Chaîne différente de celle publiée", count: 1,
      detail: `Le sceau n° ${h.seq} (${h.kind === "entries" ? "écritures" : "journal"}) ne porte plus l'empreinte publiée au rapport de ${String(sn.month).padStart(2, "0")}/${sn.year} : chaîne refaite.` });
  }
  const heads = integrity.map(c => ({ kind: c.kind, seq: c.lastSeq, hash: c.lastHash }));

  // 2. Journal d'audit du mois
  const acts = await AuditLogModel.aggregate<{ _id: string; n: number }>([{ $match: { tenantId: tid, createdAt: inMonth } }, { $group: { _id: "$action", n: { $sum: 1 } } }]);
  const byAction = Object.fromEntries(acts.map(a => [a._id, a.n]));
  const deletions = await AuditLogModel.find({ tenantId: tid, createdAt: inMonth, action: "DELETE" }).sort({ createdAt: -1 }).limit(MAX_LIST)
    .select("userEmail resource resourceId createdAt").lean<Array<{ userEmail?: string; resource: string; resourceId?: unknown; createdAt: Date }>>();
  const entryUpdates = await AuditLogModel.countDocuments({ tenantId: tid, createdAt: inMonth, resource: "accountingEntries", action: "UPDATE", "metadata.lockedUntil": { $exists: false } });
  if (byAction.DELETE) findings.push({ severity: "À vérifier", check: "Suppressions", count: byAction.DELETE, detail: "Suppressions de pièces ou de fiches dans le mois.",
    items: deletions.map(d => `${day(d.createdAt)} — ${d.userEmail ?? "?"} — ${d.resource}${d.resourceId ? ` ${String(d.resourceId)}` : ""}`) });
  const failed = byAction.LOGIN_FAILED ?? 0;
  if (failed >= 10) {
    const top = await AuditLogModel.aggregate<{ _id: string; n: number }>([{ $match: { tenantId: tid, createdAt: inMonth, action: "LOGIN_FAILED" } }, { $group: { _id: "$userEmail", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]);
    findings.push({ severity: "À vérifier", check: "Connexions échouées", count: failed, detail: "Tentatives de connexion échouées dans le mois (comptes existants).", items: top.map(t => `${t._id ?? "?"} : ${t.n}`) });
  }
  const locks = await AuditLogModel.find({ tenantId: tid, createdAt: inMonth, resource: "accountingEntries", "metadata.lockedUntil": { $exists: true } })
    .select("userEmail metadata.lockedUntil createdAt").lean<Array<{ userEmail?: string; metadata?: { lockedUntil?: unknown }; createdAt: Date }>>();
  if (locks.length) findings.push({ severity: "Majeur", check: "Verrou de période modifié", count: locks.length,
    detail: "Clôture ou réouverture de période dans le mois : une réouverture permet de modifier des écritures déjà présentées.",
    items: locks.map(l => `${day(l.createdAt)} — ${l.userEmail ?? "?"} — verrou au ${l.metadata?.lockedUntil ? day(String(l.metadata.lockedUntil)) : "aucun (période rouverte)"}`) });
  const roleChanges = await AuditLogModel.find({ tenantId: tid, createdAt: inMonth, resource: "users",
    $or: [{ action: { $in: ["CREATE", "DELETE"] } }, { "metadata.access": true }, { "after.twoFactorEnabled": { $exists: true } }] })
    .sort({ createdAt: -1 }).limit(200).select("userEmail action resourceId before after createdAt").lean<Array<{ userEmail?: string; action: string; resourceId?: unknown; before?: Record<string, unknown>; after?: Record<string, unknown>; createdAt: Date }>>();
  const off2fa = roleChanges.filter(l => l.after?.twoFactorEnabled === false);
  if (off2fa.length) findings.push({ severity: "Majeur", check: "Double authentification désactivée", count: off2fa.length, detail: "Comptes qui ont retiré leur double authentification dans le mois.",
    items: off2fa.slice(0, MAX_LIST).map(l => `${day(l.createdAt)} — ${l.userEmail ?? "?"}`) });
  const describe = (l: typeof roleChanges[number]) => l.after?.twoFactorEnabled !== undefined ? `double authentification ${l.after.twoFactorEnabled ? "activée" : "désactivée"}`
    : l.action !== "UPDATE" ? l.action : `rôle ${String(l.before?.role ?? "?")} → ${String(l.after?.role ?? "?")}${l.before?.isActive !== l.after?.isActive ? `, ${l.after?.isActive === false ? "désactivé" : "réactivé"}` : ""}`;
  if (roleChanges.length) findings.push({ severity: "À vérifier", check: "Comptes et rôles modifiés", count: roleChanges.length, detail: "Créations, suppressions, changements de rôle ou d'activation de comptes dans le mois.",
    items: roleChanges.slice(0, MAX_LIST).map(l => `${day(l.createdAt)} — par ${l.userEmail ?? "?"} — compte ${l.resourceId ? String(l.resourceId) : "?"} : ${describe(l)}`) });
  const restarts = await AccountingRestartModel.find({ tenantId: tid, restartedAt: inMonth }).select("restartedAt restartDate deleted").lean<Array<{ restartedAt: Date; restartDate?: Date; deleted?: Record<string, number> }>>();
  if (restarts.length) findings.push({ severity: "Majeur", check: "Reprise de la comptabilité", count: restarts.length, detail: "Écritures effacées après archivage et verrou de période déplacé : vérifier l'autorisation et la conservation de l'archive.",
    items: restarts.map(x => `${day(x.restartedAt)} — reprise au ${x.restartDate ? day(x.restartDate) : "?"} — ${x.deleted?.accountingEntries ?? 0} écriture(s) effacée(s)`) });

  // 3. Écritures créées dans le mois (date de création lue dans l'identifiant, non modifiable)
  type E = { _id: Types.ObjectId; entryDate: Date; reference: string; label: string; journalCode: string; linkedDocType?: string; reverses?: unknown; lines: Array<{ accountCode: string; debit: number; credit: number }> };
  const created = await AccountingEntryModel.find({ tenantId: tid, _id: idsInMonth }).select("entryDate reference label journalCode linkedDocType reverses lines.accountCode lines.debit lines.credit").lean<E[]>();
  const tenant = await TenantModel.findById(tid).select("accountingRestartDate accountingRestartAt").lean<{ accountingRestartDate?: Date; accountingRestartAt?: Date } | null>();
  const amount = (e: E) => e.lines.reduce((t, l) => t + (l.debit || 0), 0);
  const manual = created.filter(e => !e.linkedDocType || e.linkedDocType === "manual");
  const manualCash = manual.filter(e => e.lines.some(l => /^5[27]/.test(l.accountCode)));
  if (manualCash.length) findings.push({ severity: "À vérifier", check: "Saisies manuelles en caisse ou banque", count: manualCash.length,
    detail: "Écritures saisies à la main sur un compte 52 ou 57, sans pièce de gestion : vérifier le justificatif.",
    items: manualCash.slice(0, MAX_LIST).map(e => `${day(e.entryDate)} ${e.reference} — ${e.label} — ${fmt(amount(e))}`) });
  // Ressaisie après une reprise : écritures datées entre la date de reprise et le jour de la reprise, présentées à part.
  const restartFrom = tenant?.accountingRestartDate ? new Date(tenant.accountingRestartDate) : null, restartAt = tenant?.accountingRestartAt ? new Date(tenant.accountingRestartAt) : null;
  const backlog = (e: E) => !!restartFrom && !!restartAt && new Date(e.entryDate) >= restartFrom && new Date(e.entryDate) <= restartAt;
  const late = created.filter(e => createdOf(e._id).getTime() - new Date(e.entryDate).getTime() > BACKDATE_DAYS * 86_400_000
    && e.journalCode !== "AN" && !["closing", "result_allocation", "fixed_asset"].includes(e.linkedDocType ?? ""));
  const backdated = late.filter(e => !backlog(e)), restartBacklog = late.filter(backlog);
  const isManual = (e: E) => !e.linkedDocType || e.linkedDocType === "manual";
  const lateManual = backdated.filter(isManual), lateDocs = backdated.filter(e => !isManual(e));
  const lateItems = (xs: E[]) => xs.slice(0, MAX_LIST).map(e => `${e.reference} datée du ${day(e.entryDate)}, saisie le ${day(createdOf(e._id))}`);
  if (lateManual.length) findings.push({ severity: "Majeur", check: `Saisies manuelles antidatées de plus de ${BACKDATE_DAYS} jours`, count: lateManual.length,
    detail: "Écritures saisies à la main longtemps après leur date (hors ressaisie de la reprise) : risque de modifier une période déjà présentée.", items: lateItems(lateManual) });
  if (lateDocs.length) findings.push({ severity: "À vérifier", check: `Pièces comptabilisées plus de ${BACKDATE_DAYS} jours après leur date`, count: lateDocs.length,
    detail: "Factures fournisseurs reçues tard, échéances ou frais repris : normal en général, à rapprocher des pièces.", items: lateItems(lateDocs) });
  if (restartBacklog.length) findings.push({ severity: "À vérifier", check: "Ressaisie de la reprise", count: restartBacklog.length,
    detail: `Écritures de la période reprise (depuis le ${day(restartFrom!)}) saisies ce mois : contrôle par sondage contre les pièces.` });
  const offHours = manual.filter(e => {
    const l = local(createdOf(e._id));
    return l.getUTCHours() < 6 || l.getUTCHours() >= 22 || l.getUTCDay() === 0;
  });
  if (offHours.length) findings.push({ severity: "À vérifier", check: "Saisies manuelles de nuit ou le dimanche", count: offHours.length,
    detail: "Saisies entre 22 h et 6 h (heure de Niamey) ou le dimanche.", items: offHours.slice(0, MAX_LIST).map(e => `${e.reference} — ${local(createdOf(e._id)).toISOString().replace("T", " ").slice(0, 16)}`) });
  const reversals = created.filter(e => e.reverses).length;

  // 4. Séparation des tâches : achat saisi et validé par la même personne
  const sodFilter = { tenantId: tid, validatedAt: inMonth, $expr: { $eq: ["$createdBy", "$validatedBy"] } };
  const [sodCount, sod] = await Promise.all([
    PurchaseModel.countDocuments(sodFilter),
    PurchaseModel.find(sodFilter).select("number totalTTC").limit(MAX_LIST).lean<Array<{ number: string; totalTTC: number }>>(),
  ]);
  if (sodCount) findings.push({ severity: "Majeur", check: "Séparation des tâches (achats)", count: sodCount,
    detail: "Factures fournisseurs saisies et validées par la même personne.", items: sod.map(p => `${p.number} — ${fmt(p.totalTTC)}`) });

  // 5. Revue des droits, à la fin de la période
  type U = { email: string; firstName?: string; lastName?: string; role: string; roles?: string[]; isActive?: boolean; lastLoginAt?: Date; createdAt?: Date; accessUntil?: Date; twoFactorEnabled?: boolean };
  const users = await UserModel.find({ tenantId: tid }).select("email firstName lastName role roles isActive lastLoginAt createdAt accessUntil twoFactorEnabled").lean<U[]>();
  const rolesOf = (u: U) => (u.roles?.length ? u.roles : [u.role]);
  const active = users.filter(u => u.isActive !== false);
  const admins = active.filter(u => rolesOf(u).some(r => (TENANT_ADMIN_ROLES as string[]).includes(r)));
  const no2fa = admins.filter(u => !u.twoFactorEnabled);
  const dormant = active.filter(u => u.lastLoginAt && asOf.getTime() - new Date(u.lastLoginAt).getTime() > DORMANT_DAYS * 86_400_000);
  const never = active.filter(u => !u.lastLoginAt && u.createdAt && asOf.getTime() - new Date(u.createdAt).getTime() > 30 * 86_400_000);
  const expired = active.filter(u => u.accessUntil && new Date(u.accessUntil) < asOf);
  if (admins.length > 3) findings.push({ severity: "Majeur", check: "Trop d'administrateurs", count: admins.length, detail: "Plus de trois comptes actifs ont tous les droits.", items: admins.map(u => u.email) });
  if (no2fa.length) findings.push({ severity: "Majeur", check: "Administrateurs sans double authentification", count: no2fa.length, detail: "Un mot de passe volé suffit à prendre la main sur toute l'organisation.", items: no2fa.map(u => u.email) });
  if (expired.length) findings.push({ severity: "Majeur", check: "Accès temporaires échus encore ouverts", count: expired.length, detail: "Stagiaires ou accès limités dont la date de fin est passée.", items: expired.map(u => `${u.email} (fin le ${day(u.accessUntil!)})`) });
  if (dormant.length) findings.push({ severity: "Majeur", check: `Comptes inactifs depuis plus de ${DORMANT_DAYS} jours`, count: dormant.length, detail: "Comptes encore ouverts sans connexion récente : à désactiver s'ils ne servent plus.", items: dormant.map(u => `${u.email} (dernière connexion ${day(u.lastLoginAt!)})`) });
  if (never.length) findings.push({ severity: "À vérifier", check: "Comptes jamais utilisés", count: never.length, detail: "Comptes créés depuis plus de 30 jours, jamais connectés.", items: never.map(u => u.email) });
  const keys = await ApiKeyModel.find({ tenantId: tid, isActive: true, revokedAt: { $exists: false } }).select("name scopes lastUsedAt source").lean<Array<{ _id: Types.ObjectId; name: string; scopes?: string[]; lastUsedAt?: Date; source?: string }>>();
  const idleKeys = keys.filter(k => k.lastUsedAt ? asOf.getTime() - new Date(k.lastUsedAt).getTime() > DORMANT_DAYS * 86_400_000 : asOf.getTime() - k._id.getTimestamp().getTime() > 30 * 86_400_000);
  if (idleKeys.length) findings.push({ severity: "À vérifier", check: "Clés d'API inutilisées", count: idleKeys.length, detail: "Clés actives jamais utilisées (depuis plus de 30 jours) ou pas depuis 90 jours : à révoquer si l'intégration n'existe plus.", items: idleKeys.map(k => k.name) });
  const newKeys = keys.filter(k => k._id.getTimestamp() >= from && k._id.getTimestamp() <= to);
  if (newKeys.length) findings.push({ severity: "À vérifier", check: "Clés d'API créées dans le mois", count: newKeys.length, detail: "Nouveaux accès machine (EasyPay, ISIC…) : vérifier leur portée.", items: newKeys.map(k => `${k.name} (${(k.scopes ?? []).join(", ") || "sans portée"})`) });

  const counts = { Critique: 0, Majeur: 0, "À vérifier": 0 } as Record<Severity, number>;
  for (const f of findings) counts[f.severity]++;
  const order = { Critique: 0, Majeur: 1, "À vérifier": 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    period: { year, month, from, to }, generatedAt: now, integrity, heads,
    activity: { byAction, failedLogins: failed, exports: byAction.EXPORT ?? 0, deletions: byAction.DELETE ?? 0, entryUpdates, roleChanges: roleChanges.length, lockChanges: locks.length },
    entries: { created: created.length, manual: manual.length, reversals, backdated: backdated.length, restartBacklog: restartBacklog.length, offHours: offHours.length },
    users: { total: users.length, active: active.length, admins: admins.length, adminsWithout2fa: no2fa.length, dormant: dormant.length, neverLogged: never.length, expiredInterns: expired.length, apiKeys: keys.length,
      keys: keys.map(k => ({ name: k.name, scopes: k.scopes ?? [], lastUsedAt: k.lastUsedAt ?? null, source: k.source ?? null })),
      list: users.map(u => ({ email: u.email, name: [u.firstName, u.lastName].filter(Boolean).join(" "), roles: rolesOf(u), active: u.isActive !== false, lastLoginAt: u.lastLoginAt ?? null, twoFactor: !!u.twoFactorEnabled })) },
    findings, counts,
  };
}

const snapshotText = (tenantId: string, y: number, m: number, hash: string) => `audit-report|${tenantId}|${y}|${m}|${hash}`;

/** Rapport figé : conservé avec son empreinte signée (une seule fois par mois). */
export async function snapshotAuditReport(tenantId: string, r: AuditReport) {
  const report = JSON.parse(JSON.stringify(r));
  const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const { kid, sig } = signText(snapshotText(tenantId, r.period.year, r.period.month, hash));
  await AuditReportSnapshotModel.updateOne({ tenantId: new Types.ObjectId(tenantId), year: r.period.year, month: r.period.month },
    { $setOnInsert: { generatedAt: r.generatedAt, report, hash, kid, sig } }, { upsert: true });
  const saved = await AuditReportSnapshotModel.findOne({ tenantId: new Types.ObjectId(tenantId), year: r.period.year, month: r.period.month }).select("hash generatedAt").lean<{ hash: string; generatedAt: Date }>();
  return saved!;
}

/** Texte de la notification et du courriel mensuels : l'empreinte complète, à conserver hors de l'application. */
export function auditSummary(r: AuditReport, reportHash?: string): string {
  const head = r.counts.Critique ? `${r.counts.Critique} constat(s) critique(s), ` : "";
  const anchors = r.heads.filter(h => h.hash).map(h => `${h.kind === "entries" ? "écritures" : "journal"} n° ${h.seq} : ${h.hash}`).join(" ; ");
  return `${head}${r.counts.Majeur} majeur(s), ${r.counts["À vérifier"]} à vérifier. ${r.entries.created} écriture(s) passée(s), dont ${r.entries.manual} à la main. `
    + `${r.users.active} compte(s) actif(s), ${r.users.admins} administrateur(s).`
    + (anchors ? ` Empreintes de la chaîne (à conserver hors de l'application) — ${anchors}.` : "")
    + (reportHash ? ` Empreinte du rapport : ${reportHash}.` : "");
}
