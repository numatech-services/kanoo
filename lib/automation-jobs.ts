import { Types } from "mongoose";
import type { CronJob } from "@/lib/cron-jobs";
import { notify, getAdmins, getRecipients, actAs, liveTenants, type Id, type ActingUser } from "@/lib/cron-helpers";
import { openInventory } from "@/lib/restaurant-inventory";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { BusinessRuleError } from "@/lib/errors";
import { loadAutomationSettings, claimOnce, claimEvery, releaseClaim, PLATFORM_TENANT } from "@/lib/automation-store";
import {
  niameyDate, dayKey, dateLabel, isSendDay, payrollReminderDue, isLastDayOfMonth, packetPeriodDue,
  consumption, crossedThresholds, treasuryBreach, briefText, briefHtml, MONTHS_FR, fiscalRemindersDue, previousMonth, type AutomationSettings,
} from "@/lib/automations";
import { authCan, effectiveRoles } from "@/lib/role-resources";
import { withTransaction } from "@/lib/db";
import { sendEmail, emailWrapper } from "@/lib/email";
import { sendWhatsApp } from "@/lib/whatsapp";
import { sendSMS, smsCotisationRappel } from "@/lib/sms";
import { formatMoney } from "@/lib/format";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { FixedAssetModel } from "@/models/FixedAsset";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { ApprobationModel } from "@/models/Approbation";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { LeaveModel } from "@/models/Leave";
import { BudgetModel } from "@/models/Budget";
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { MembershipModel } from "@/models/Membership";
import { postDepreciation } from "@/lib/fixed-asset-posting";
import { computeForecast } from "@/lib/treasury-forecast";
import { dailyBrief } from "@/lib/daily-brief-server";
import { accountBalance } from "@/lib/treasury";
import { generatePayslip, PayrollError, type PayrollEmployee } from "@/lib/payroll-run";
import { buildAccountantPacket } from "@/lib/accountant-packet";
import { actualsByPrefix, type BudgetEntryRow, type BudgetLine } from "@/lib/budget";
import { runBackup } from "@/lib/backup";
import { ErrorEventModel } from "@/models/ErrorEvent";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ApiKeyModel } from "@/models/ApiKey";
import { AutomationLogModel } from "@/models/AutomationLog";
import { canSeeDeskCosts, deskScope } from "@/lib/comptoir";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { IntegrationEventModel } from "@/models/IntegrationEvent";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { productSales } from "@/lib/comptoir-session";
import { reorderPlan } from "@/lib/spot-server";
import { createReorderOrders } from "@/lib/comptoir-reorder";
import { easypayBalance } from "@/lib/easypay-server";
import { prepareFinancialExport } from "@/lib/financial-export";
import { supplierSchedule } from "@/lib/supplier-schedule";
import { vatFromEntries, VAT_LINES_MATCH } from "@/lib/vat";
import { vatCreditAt } from "@/lib/vat-settlement";

/**
 * Automatisations réglables par organisation (Réglages → Automatisations),
 * ajoutées aux tâches planifiées de lib/cron-jobs.ts.
 *
 * Trois règles communes :
 *  • rien ne part deux fois : chaque envoi est inscrit dans AutomationLog
 *    (claimOnce / claimEvery) avant de partir ;
 *  • une tâche qui agit (écriture comptable, bulletin) le fait AU NOM d'un
 *    utilisateur réel qui en a le droit (actAs) — tracée, et bornée à ses droits ;
 *  • une organisation en échec n'arrête pas les autres : l'erreur est comptée
 *    et rapportée dans le résumé.
 */

const DAY = 86_400_000;

/** Dirigeants : destinataires par défaut du brief. */
const LEADER_ROLES = ["pme_admin", "pme_manager", "asso_president", "admin_ordonnateur"];
/** Finances : trésorerie, budget, amortissements, dossier comptable. */
const FINANCE_ROLES = ["pme_admin", "pme_accountant", "svc_compta", "asso_treasurer", "asso_president", "admin_daf", "admin_ordonnateur", "admin_public_accountant"];
/** Paie. */
const PAYROLL_ROLES = ["pme_admin", "pme_hr", "pme_accountant", "svc_compta"];

const baseUrl = () => process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Organisations actives et leurs réglages, filtrées par une condition. */
async function tenantsWhere(pred: (s: AutomationSettings, t: { type: string }) => boolean) {
  const out: Array<{ tenant: { _id: Id; name: string; type: "pme" | "association" | "administration" }; settings: AutomationSettings }> = [];
  for (const tenant of await liveTenants()) {
    const settings = await loadAutomationSettings(tenant._id);
    if (pred(settings, tenant)) out.push({ tenant, settings });
  }
  return out;
}

/** Premier utilisateur des rôles donnés qui a effectivement le droit demandé. */
async function actorWith(tenantId: Id, roles: string[], resource: string, action: "create" | "read" | "update" | "delete"): Promise<ActingUser | null> {
  const users = await UserModel.find({ tenantId, isActive: true, $or: [{ role: { $in: roles } }, { roles: { $in: roles } }] })
    .sort({ createdAt: 1 }).select("_id role").lean<Array<{ _id: Id; role: string }>>();
  // Ordre des rôles respecté : le comptable avant le gérant pour une écriture.
  users.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role));
  for (const u of users) {
    const a = await actAs(u._id);
    if (a && authCan(a.auth, resource, action)) return a;
  }
  return null;
}

async function notifyAll(tenantId: Id, roles: string[], type: string, title: string, message: string, linkedTo?: string) {
  const users = await getAdmins(tenantId, roles);
  for (const u of users) await notify(tenantId, u._id, type, title, message, linkedTo);
  return users.length;
}

const mailBody = (title: string, paragraphs: string[], link?: { href: string; label: string }) => emailWrapper(
  `<p style="font-weight:600;font-size:16px;margin:0 0 12px;">${title}</p>`
  + paragraphs.map(p => `<p style="margin:0 0 12px;">${p}</p>`).join("")
  + (link ? `<p style="margin:16px 0 0;"><a href="${baseUrl()}${link.href}" style="display:inline-block;background:#2F59DF;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">${link.label}</a></p>` : ""),
);

function summary(parts: Array<[number, string]>, errors: string[]): string {
  const s = parts.filter(([n]) => n > 0).map(([n, l]) => `${n} ${l}`).join(", ") || "rien à faire";
  return errors.length ? `${s} ; ${errors.length} échec(s) : ${errors.slice(0, 3).join(" | ")}` : s;
}

// ─── 1. Amortissements de l'exercice écoulé ──────────────────────────────────

async function runDepreciation(now = new Date()): Promise<string> {
  const year = niameyDate(now).year - 1;
  let posted = 0, total = 0;
  const errors: string[] = [];
  for (const { tenant } of await tenantsWhere(s => s.depreciation.enabled)) {
    const t = await TenantModel.findById(tenant._id).select("closedFiscalYears accountingLockedUntil")
      .lean<{ closedFiscalYears?: number[]; accountingLockedUntil?: Date } | null>();
    // Exercice déjà clôturé ou période verrouillée : le comptable a la main.
    if (t?.closedFiscalYears?.includes(year)) continue;
    if (t?.accountingLockedUntil && new Date(t.accountingLockedUntil) >= new Date(year, 11, 31)) continue;
    const assets = await FixedAssetModel.find({
      tenantId: tenant._id, status: { $ne: "disposed" },
      depreciationSchedule: { $elemMatch: { year, posted: { $ne: true }, annuity: { $gt: 0 } } },
    }).select("_id name").lean<Array<{ _id: Id; name: string }>>();
    if (!assets.length) continue;
    const actor = await actorWith(tenant._id, ["pme_accountant", "svc_compta", "admin_public_accountant", "asso_treasurer", "pme_admin", "admin_daf", "asso_president"], "fixedAssets", "update");
    if (!actor) { errors.push(`${tenant.name} : aucun comptable habilité`); continue; }
    let amount = 0, n = 0;
    for (const a of assets) {
      try {
        const r = await withTransaction(session => postDepreciation(actor.auth, a._id, year, session));
        amount += r.annuity; n++;
      } catch (err) {
        errors.push(`${tenant.name} / ${a.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (n) {
      posted += n; total += amount;
      await notifyAll(tenant._id, FINANCE_ROLES, "depreciation_posted", `Amortissements ${year} comptabilisés`,
        `${n} dotation(s) passée(s) au 31/12/${year} pour ${formatMoney(amount)}, au nom de ${actor.user.firstName ?? actor.user.email}. À contrôler avant la clôture.`, "immobilisations");
    }
  }
  return summary([[posted, `dotation(s) ${year} passée(s) (${formatMoney(total)})`]], errors);
}

// ─── 2. Brief du matin par e-mail / WhatsApp ─────────────────────────────────

async function runMorningBrief(now = new Date()): Promise<string> {
  let mails = 0, whatsapps = 0;
  const errors: string[] = [];
  const day = dayKey(now);
  for (const { tenant, settings } of await tenantsWhere(s => s.morningBrief.enabled && isSendDay(now, s.morningBrief.days))) {
    const chosen = settings.morningBrief.recipientIds;
    const recipients = chosen.length
      ? await UserModel.find({ tenantId: tenant._id, isActive: true, _id: { $in: chosen.map(id => new Types.ObjectId(id)) } }).select("_id").lean<Array<{ _id: Id }>>()
      : await getAdmins(tenant._id, LEADER_ROLES);
    for (const r of recipients) {
      try {
        if (!(await claimOnce(tenant._id, `brief:${r._id}:${day}`))) continue;
        const actor = await actAs(r._id);
        if (!actor) continue;
        const can = (resource: string, action: "read" | "create" | "update" | "delete" = "read") => authCan(actor.auth, resource, action);
        const { items } = await dailyBrief({ ...actor.auth } as never, can, 5);
        let cash: number | null = null;
        if (can("treasuryAccounts")) {
          const accounts = await TreasuryAccountModel.find({ tenantId: tenant._id, isActive: true }).select("_id").lean<Array<{ _id: Id }>>();
          const balances = await Promise.all(accounts.map(a => accountBalance(String(tenant._id), String(a._id))));
          cash = balances.reduce((s, b) => s + (b?.balance ?? 0), 0);
        }
        const opts = { firstName: actor.user.firstName, tenantName: tenant.name, cash, items: items.map(i => ({ title: i.title, why: i.why, href: i.href })), baseUrl: baseUrl(), dateLabel: dateLabel(now) };
        if (settings.morningBrief.channels.includes("email") && actor.user.email) {
          const res = await sendEmail({ to: actor.user.email, subject: `Le point du jour — ${tenant.name}`, html: emailWrapper(briefHtml(opts)), text: briefText(opts) });
          if (res.sent) mails++; else errors.push(`${actor.user.email} : ${res.error}`);
        }
        if (settings.morningBrief.channels.includes("whatsapp") && actor.user.phone) {
          const res = await sendWhatsApp({
            to: actor.user.phone, text: briefText(opts),
            template: { kind: "brief", params: [
              actor.user.firstName ?? "", tenant.name, cash === null ? "non communiquée" : formatMoney(cash),
              opts.items.length ? opts.items.map((it, i) => `${i + 1}. ${it.title}`).join(" ; ") : "rien d'urgent",
            ] },
          });
          if (res.sent) whatsapps++; else errors.push(`WhatsApp ${actor.user.firstName ?? ""} : ${res.error}`);
        }
      } catch (err) {
        errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary([[mails, "brief(s) par e-mail"], [whatsapps, "brief(s) par WhatsApp"]], errors);
}

// ─── 3. Alerte de trésorerie prévisionnelle ──────────────────────────────────

async function runTreasuryAlert(now = new Date()): Promise<string> {
  let alerted = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.treasuryAlert.enabled)) {
    try {
      if (!(await TreasuryAccountModel.exists({ tenantId: tenant._id, isActive: true }))) continue;
      const { horizonDays, threshold } = settings.treasuryAlert;
      const forecast = await computeForecast(String(tenant._id), Math.ceil(horizonDays / 7) + 1, now);
      const breach = treasuryBreach(forecast.weeks, threshold, horizonDays, now);
      if (!breach) continue;
      // Une alerte par semaine au plus : l'écran de prévision détaille le reste.
      if (!(await claimEvery(tenant._id, "treasury:breach", 7 * DAY - 3_600_000, now))) continue;
      const when = breach.firstWeek.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
      const msg = `Le solde prévu passe à ${formatMoney(breach.balance)} la semaine du ${when}${threshold ? ` (seuil : ${formatMoney(threshold)})` : ""}, jusqu'à ${formatMoney(breach.lowest)} au plus bas. Relancez les encaissements ou décalez des paiements.`;
      await notifyAll(tenant._id, FINANCE_ROLES, "treasury_alert", "Découvert prévu", msg, "treasury/prevision");
      for (const u of await getRecipients(tenant._id, FINANCE_ROLES)) {
        if (u.email) await sendEmail({ to: u.email, subject: `Découvert prévu — ${tenant.name}`, html: mailBody("Découvert prévu", [msg], { href: "/treasury/prevision", label: "Voir la prévision" }), text: msg });
      }
      alerted++;
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[alerted, "alerte(s) de découvert"]], errors);
}

// ─── 4. Paie du mois : rappel et génération d'office ─────────────────────────

/** Bulletin générable sans saisie (salaire fixe, indemnité mensuelle ou forfaitaire). */
function isFixedPay(e: PayrollEmployee): boolean {
  const type = e.employeeType ?? "employee";
  if (type === "employee") return (e.grossSalary ?? 0) > 0;
  return (e.indemnity ?? 0) > 0 && e.indemnityPeriod !== "daily" && e.indemnityPeriod !== "hourly";
}

async function runPayroll(now = new Date()): Promise<string> {
  let reminders = 0, generated = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.payroll.enabled)) {
    try {
      const due = payrollReminderDue(now, settings.payroll.reminderDay);
      if (!due) continue;
      const { year, month } = due;
      const periodEnd = new Date(year, month, 0);
      // Contrat échu avant le mois payé (CDD terminé, sortie) : plus de paie.
      const periodStart = new Date(year, month - 1, 1);
      const employees = await EmployeeModel.find({
        tenantId: tenant._id, isActive: true, startDate: { $lte: periodEnd },
        $and: [
          { $or: [{ contractEndDate: { $exists: false } }, { contractEndDate: null }, { contractEndDate: { $gte: periodStart } }] },
          { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: periodStart } }] },
        ],
      }).lean<PayrollEmployee[]>();
      if (!employees.length) continue;
      const done = new Set((await PayslipModel.find({ tenantId: tenant._id, month, year }).select("employeeId").lean<Array<{ employeeId: unknown }>>()).map(p => String(p.employeeId)));
      const todo = employees.filter(e => !done.has(String(e._id)));
      if (!todo.length) continue;
      const fixed = todo.filter(isFixedPay);
      const toComplete = todo.filter(e => !isFixedPay(e));
      const gross = fixed.reduce((s, e) => s + ((e.employeeType ?? "employee") === "employee" ? e.grossSalary ?? 0 : e.indemnity ?? 0), 0);
      const label = `${MONTHS_FR[month - 1]} ${year}`;

      if (await claimOnce(tenant._id, `payroll:reminder:${year}-${month}`)) {
        const msg = `Paie de ${label} à préparer : ${todo.length} bulletin(s), masse brute estimée ${formatMoney(gross)}.`
          + (toComplete.length ? ` À compléter avant de lancer : ${toComplete.slice(0, 5).map(e => `${e.firstName} ${e.lastName}`).join(", ")}${toComplete.length > 5 ? "…" : ""} (salaire manquant, ou jours / heures du mois à saisir).` : "")
          + " Saisissez les primes et retenues du mois, puis lancez la paie.";
        await notifyAll(tenant._id, PAYROLL_ROLES, "payroll_reminder", `Paie de ${label}`, msg, "payslips");
        for (const u of await getRecipients(tenant._id, PAYROLL_ROLES)) {
          if (u.email) await sendEmail({ to: u.email, subject: `Paie de ${label} à préparer — ${tenant.name}`, html: mailBody(`Paie de ${label}`, [msg], { href: "/payslips", label: "Préparer la paie" }), text: msg });
        }
        reminders++;
      }

      // Génération d'office (option) : le dernier jour du mois, bulletins à
      // salaire fixe seulement — les variables du mois ont eu jusque-là pour être saisies.
      if (settings.payroll.autoGenerate && isLastDayOfMonth(now) && fixed.length && await claimOnce(tenant._id, `payroll:auto:${year}-${month}`)) {
        const actor = await actorWith(tenant._id, ["pme_hr", "pme_accountant", "svc_compta", "pme_admin"], "payslips", "create");
        // Sans gestionnaire habilité, la réservation est rendue : la génération
        // se refera dès qu'un gestionnaire existera (même jour, appel suivant).
        if (!actor) { await releaseClaim(tenant._id, `payroll:auto:${year}-${month}`); errors.push(`${tenant.name} : aucun gestionnaire de paie habilité`); continue; }
        // Chaque bulletin est indépendant : une erreur (même technique) sur un
        // salarié n'abandonne plus la paie des autres pour le mois.
        let n = 0; const skipped: string[] = []; let technical = 0;
        for (const e of fixed) {
          try {
            await withTransaction(session => generatePayslip(actor.auth as never, e, { month, year }, session));
            n++;
          } catch (err) {
            if (!(err instanceof PayrollError)) { technical++; console.error(`[Paie] ${tenant.name} — ${e.firstName} ${e.lastName} :`, err); }
            skipped.push(`${e.firstName} ${e.lastName} : ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Erreur technique : la réservation est rendue, l'appel suivant
        // complète les bulletins manquants (ceux déjà faits sont sautés).
        if (technical) await releaseClaim(tenant._id, `payroll:auto:${year}-${month}`);
        generated += n;
        await notifyAll(tenant._id, PAYROLL_ROLES, "payroll_generated", `Paie de ${label} générée`,
          `${n} bulletin(s) généré(s) d'office au nom de ${actor.user.firstName ?? actor.user.email}.${skipped.length ? ` Non générés : ${skipped.join(" ; ")}.` : ""} Vérifiez-les avant de payer.`, "payslips");
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[reminders, "rappel(s) de paie"], [generated, "bulletin(s) généré(s)"]], errors);
}

// ─── 5. Dossier mensuel du comptable ─────────────────────────────────────────

async function runAccountantPacket(now = new Date()): Promise<string> {
  let sent = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.accountantPacket.enabled && s.accountantPacket.emails.length > 0)) {
    const period = packetPeriodDue(now, settings.accountantPacket.day);
    if (!period) continue;
    const key = `packet:${period.year}-${period.month}`;
    if (!(await claimOnce(tenant._id, key))) continue;
    try {
      const p = await buildAccountantPacket(String(tenant._id), period.year, period.month);
      const text = `Bonjour,\n\nVeuillez trouver ci-joint le dossier comptable de ${p.tenantName} pour ${p.period} : balance du mois, balance cumulée, journal des écritures (${p.entryCount} écriture(s)) et états financiers provisoires.\n\nEnvoi automatique depuis Kanoo.`;
      const res = await sendEmail({
        to: settings.accountantPacket.emails,
        subject: `Dossier comptable ${p.period} — ${p.tenantName}`,
        html: mailBody(`Dossier comptable — ${p.period}`, [
          `Veuillez trouver ci-joint le dossier comptable de <strong>${p.tenantName}</strong> pour ${p.period} :`,
          `balance du mois, balance cumulée de l'exercice, journal des écritures (${p.entryCount} écriture(s)) et états financiers provisoires arrêtés à la fin du mois.`,
        ]),
        text, attachments: p.attachments,
      });
      if (!res.sent) { await releaseClaim(tenant._id, key); errors.push(`${tenant.name} : ${res.error}`); continue; }
      sent++;
      await notifyAll(tenant._id, FINANCE_ROLES, "accountant_packet", `Dossier comptable ${p.period} envoyé`,
        `Envoyé à ${settings.accountantPacket.emails.join(", ")}.`, "accounting");
    } catch (err) {
      await releaseClaim(tenant._id, key);
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[sent, "dossier(s) comptable(s) envoyé(s)"]], errors);
}

// ─── 6. Validations en attente ───────────────────────────────────────────────

async function runApprovalReminders(now = new Date()): Promise<string> {
  let reminded = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.approvalReminders.enabled)) {
    try {
      const before = new Date(now.getTime() - settings.approvalReminders.afterHours * 3_600_000);
      // Personne → ce qui l'attend.
      const waiting = new Map<string, { id: Id; lines: string[] }>();
      const add = (userId: Id, line: string) => {
        const k = String(userId);
        const w = waiting.get(k) ?? { id: userId, lines: [] };
        w.lines.push(line); waiting.set(k, w);
      };
      const approvals = await ApprobationModel.find({ tenantId: tenant._id, status: "pending", createdAt: { $lt: before } })
        .select("amount currentLevel approvers resource").lean<Array<{ amount?: number; currentLevel?: number; resource: string; approvers: Array<{ userId: Id; level?: number; status: string }> }>>();
      for (const a of approvals) {
        for (const x of a.approvers.filter(x => x.status === "pending" && (x.level ?? 1) === (a.currentLevel ?? 1))) {
          add(x.userId, `demande d'approbation${a.amount ? ` de ${formatMoney(a.amount)}` : ""}`);
        }
      }
      const reports = await ExpenseReportModel.countDocuments({ tenantId: tenant._id, status: "submitted", submittedAt: { $lt: before } });
      if (reports) for (const u of await getAdmins(tenant._id, ["pme_admin", "pme_accountant", "svc_compta", "pme_manager"])) add(u._id, `${reports} note(s) de frais à valider`);
      const leaves = await LeaveModel.countDocuments({ tenantId: tenant._id, status: "pending", createdAt: { $lt: before } });
      if (leaves) for (const u of await getAdmins(tenant._id, ["pme_admin", "pme_hr", "svc_admin"])) add(u._id, `${leaves} demande(s) de congé à décider`);

      for (const w of waiting.values()) {
        // Une relance par personne tous les deux jours, quel que soit le nombre de demandes.
        if (!(await claimEvery(tenant._id, `approvals:${w.id}`, 2 * DAY - 3_600_000, now))) continue;
        const msg = `En attente de votre décision depuis plus de ${settings.approvalReminders.afterHours} h : ${w.lines.slice(0, 6).join(" ; ")}${w.lines.length > 6 ? "…" : ""}.`;
        await notify(tenant._id, w.id, "approval_reminder", "Décisions en attente", msg, "approbations");
        const u = await UserModel.findById(w.id).select("email").lean<{ email?: string } | null>();
        if (u?.email) await sendEmail({ to: u.email, subject: `Décisions en attente — ${tenant.name}`, html: mailBody("Décisions en attente", [msg], { href: "/approbations", label: "Décider" }), text: msg });
        reminded++;
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[reminded, "relance(s) de validation"]], errors);
}

// ─── 7. Dépassements budgétaires ─────────────────────────────────────────────

async function runBudgetAlerts(now = new Date()): Promise<string> {
  let alerts = 0;
  const errors: string[] = [];
  const year = niameyDate(now).year;
  for (const { tenant, settings } of await tenantsWhere(s => s.budgetAlerts.enabled)) {
    try {
      const thresholds = settings.budgetAlerts.thresholds;
      // Budget prévisionnel (PME, associations) : réalisé tiré des écritures.
      // Le budget de l'exercice, quel que soit son statut (l'écran n'en fait
      // pas approuver) — sauf clôturé.
      const budget = await BudgetModel.findOne({ tenantId: tenant._id, year, status: { $ne: "closed" } })
        .lean<{ _id: Id; lines: Array<BudgetLine & { _id: Id }> } | null>();
      if (budget?.lines.length) {
        const entries = await AccountingEntryModel.find({ tenantId: tenant._id, entryDate: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) } })
          .select("entryDate lines").limit(50_000).lean<BudgetEntryRow[]>();
        const actuals = actualsByPrefix(entries, budget.lines);
        for (const line of budget.lines.filter(l => l.nature === "expense")) {
          const used = (actuals.get(line.accountPrefix) ?? []).reduce((s, v) => s + v, 0);
          const pct = consumption(used, line.annualAmount);
          const top = crossedThresholds(pct, thresholds)[0];
          if (top === undefined || !(await claimOnce(tenant._id, `budget:${budget._id}:${line._id}:${top}`))) continue;
          const msg = `Ligne « ${line.label} » (${line.accountPrefix}) : ${formatMoney(used)} engagés sur ${formatMoney(line.annualAmount)} prévus pour ${year}, soit ${pct} %.`;
          await notifyAll(tenant._id, FINANCE_ROLES, "budget_alert", top >= 100 ? "Budget dépassé" : `Budget consommé à ${top} %`, msg, "budget-previsionnel");
          alerts++;
        }
      }
      // Exécution budgétaire publique (administrations) : engagements sur crédits ouverts.
      const chapters = await BudgetChapterModel.find({ tenantId: tenant._id, year, allocatedAmount: { $gt: 0 } })
        .select("_id code label allocatedAmount engagedAmount").lean<Array<{ _id: Id; code: string; label: string; allocatedAmount: number; engagedAmount: number }>>();
      for (const c of chapters) {
        const pct = consumption(c.engagedAmount, c.allocatedAmount);
        const top = crossedThresholds(pct, thresholds)[0];
        if (top === undefined || !(await claimOnce(tenant._id, `chapter:${c._id}:${top}`))) continue;
        const msg = `Chapitre ${c.code} « ${c.label} » : ${formatMoney(c.engagedAmount)} engagés sur ${formatMoney(c.allocatedAmount)} de crédits ouverts (${pct} %).`;
        await notifyAll(tenant._id, ["admin_ordonnateur", "admin_daf", "admin_public_accountant"], "budget_alert",
          top >= 100 ? "Crédits épuisés" : `Crédits engagés à ${top} %`, msg, "budget");
        alerts++;
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[alerts, "alerte(s) budgétaire(s)"]], errors);
}

// ─── 8. Cotisations impayées (associations) ──────────────────────────────────

async function runCotisationReminders(now = new Date()): Promise<string> {
  let mails = 0, sms = 0, whatsapps = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere((s, t) => s.cotisationReminders.enabled && t.type === "association")) {
    try {
      const { channels, intervalDays } = settings.cotisationReminders;
      const unpaid = await MembershipModel.find({ tenantId: tenant._id, paidAt: null, year: { $lte: niameyDate(now).year } })
        .populate("memberId", "firstName lastName email phone status")
        .select("_id year amount memberId").limit(2000)
        .lean<Array<{ _id: Id; year: number; amount: number; memberId?: { firstName: string; lastName: string; email?: string; phone?: string; status?: string } }>>();
      for (const m of unpaid) {
        const member = m.memberId;
        if (!member || member.status !== "active" || !(m.amount > 0)) continue;
        if (!member.email && !member.phone) continue;
        if (!(await claimEvery(tenant._id, `cotisation:${m._id}`, intervalDays * DAY - 3_600_000, now))) continue;
        const text = `Bonjour ${member.firstName}, votre cotisation ${m.year} à ${tenant.name} (${formatMoney(m.amount)}) reste à régler. Merci de votre soutien.`;
        if (channels.includes("email") && member.email) {
          const r = await sendEmail({ to: member.email, subject: `Cotisation ${m.year} — ${tenant.name}`,
            html: mailBody(`Cotisation ${m.year}`, [`Bonjour ${member.firstName},`, `Votre cotisation ${m.year} à <strong>${tenant.name}</strong>, d'un montant de ${formatMoney(m.amount)}, reste à régler.`, "Si vous l'avez déjà réglée, merci de ne pas tenir compte de ce message. Merci de votre soutien."]), text });
          if (r.sent) mails++;
        }
        if (channels.includes("sms") && member.phone && await sendSMS({ to: member.phone, message: smsCotisationRappel(m.year, m.amount) })) sms++;
        if (channels.includes("whatsapp") && member.phone && (await sendWhatsApp({
          to: member.phone, text,
          template: { kind: "cotisation", params: [member.firstName, String(m.year), tenant.name, formatMoney(m.amount)] },
        })).sent) whatsapps++;
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[mails, "relance(s) par e-mail"], [sms, "par SMS"], [whatsapps, "par WhatsApp"]], errors);
}

// ─── 9. Sauvegarde de la base ────────────────────────────────────────────────

async function runDailyBackup(now = new Date()): Promise<string> {
  const key = `backup:${dayKey(now)}`;
  if (!(await claimOnce(PLATFORM_TENANT, key))) return "déjà faite aujourd'hui";
  try {
    return await runBackup(now);
  } catch (err) {
    await releaseClaim(PLATFORM_TENANT, key);
    throw err;
  }
}

// ─── 10. Résumé quotidien des erreurs (super-administrateurs) ─────────────────

async function runErrorDigest(now = new Date()): Promise<string> {
  const since = new Date(now.getTime() - DAY);
  const errors = await ErrorEventModel.find({ lastAt: { $gte: since }, resolvedAt: { $exists: false } })
    .sort({ count: -1 }).limit(20).select("source message count firstAt url").lean<Array<{ source: string; message: string; count: number; firstAt: Date; url?: string }>>();
  if (!errors.length) return "aucune erreur en 24 h";
  if (!(await claimOnce(PLATFORM_TENANT, `errors:${dayKey(now)}`))) return "résumé déjà envoyé aujourd'hui";
  const admins = await UserModel.find({ role: "superadmin", isActive: true }).select("email").lean<Array<{ email?: string }>>();
  const fresh = errors.filter(e => new Date(e.firstAt) >= since).length;
  const rows = errors.map(e => `<li style="margin-bottom:6px;"><strong>${e.count}×</strong> [${e.source}] ${e.message.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}${e.url ? ` <span style="color:#6B7280;">(${e.url})</span>` : ""}</li>`).join("");
  let sent = 0;
  for (const a of admins) {
    if (!a.email) continue;
    const r = await sendEmail({
      to: a.email, subject: `Kanoo — ${errors.length} erreur(s) en 24 h${fresh ? `, dont ${fresh} nouvelle(s)` : ""}`,
      html: mailBody("Erreurs des dernières 24 heures", [`${errors.length} groupe(s) d'erreurs non résolues${fresh ? `, dont ${fresh} apparue(s) aujourd'hui` : ""} :`, `<ul style="padding-left:18px;margin:0;">${rows}</ul>`], { href: "/saas/erreurs", label: "Ouvrir le journal" }),
      text: errors.map(e => `${e.count}× [${e.source}] ${e.message}`).join("\n"),
    });
    if (r.sent) sent++;
  }
  return `${errors.length} groupe(s) d'erreurs, résumé envoyé à ${sent} super-administrateur(s)`;
}

// ─── 11. Comptoir : point du matin (marges, réassort, EasyPay) ──────────────

const fcfa = (n: number) => formatMoney(Math.round(n));
/** Écart à l'objectif sous lequel on ne dérange personne (bruit d'une vente isolée). */
const MARGIN_MATERIALITY = 1_000;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

interface DeskReader { _id: Id; costs: boolean; operate: boolean; scope: string[] | null }

/**
 * Lecteurs possibles des comptoirs d'une organisation, selon leurs droits
 * EFFECTIFS (rôles, niveaux, liste blanche, sites) et non le seul nom du rôle :
 * `costs` voit les coûts, les marges et EasyPay, `operate` gère le réassort
 * (gestionnaire d'activité, gérance). Un caissier n'a ni l'un ni l'autre.
 */
async function deskReaders(tenantId: Id): Promise<DeskReader[]> {
  const roles = [...FINANCE_ROLES, "pme_manager", "pme_activity_manager", "svc_spot"];
  const users = await UserModel.find({ tenantId, isActive: true, $or: [{ role: { $in: roles } }, { roles: { $in: roles } }] }).select("_id").lean<Array<{ _id: Id }>>();
  const out: DeskReader[] = [];
  for (const u of users) {
    const a = await actAs(u._id);
    if (!a || !authCan(a.auth, "comptoir", "read")) continue;
    const auth = a.auth as never;
    // Le réassort va aux gestionnaires (activité, gérance), pas au caissier qui a le droit
    // de modifier le comptoir pour encaisser.
    const manages = effectiveRoles(a.auth.role, a.auth.roles).some(r => r === "pme_activity_manager" || r === "pme_manager");
    const costs = canSeeDeskCosts(auth), operate = costs || (manages && authCan(a.auth, "comptoir", "update"));
    if (costs || operate) out.push({ _id: u._id, costs, operate, scope: deskScope(auth) });
  }
  return out;
}
const onDesk = (r: DeskReader, deskId: Id) => r.scope === null || r.scope.map(String).includes(String(deskId));

async function runComptoirMorning(now = new Date()): Promise<string> {
  let sent = 0, ordered = 0;
  const errors: string[] = [];
  const d = niameyDate(now);
  const y = new Date(Date.UTC(d.year, d.month - 1, d.day - 1));
  const day = `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, "0")}-${String(y.getUTCDate()).padStart(2, "0")}`;
  const dayLabel = y.toLocaleDateString("fr-FR", { timeZone: "UTC" });
  for (const { tenant, settings } of await tenantsWhere(s => s.comptoirMargins.enabled || s.comptoirReorder.enabled || s.easypayRecon.enabled)) {
    const desks = await ActivityDeskModel.find({ tenantId: tenant._id, archived: { $ne: true } }).select("name targetMarkup").lean<Array<{ _id: Id; name: string; targetMarkup?: number }>>();
    if (!desks.length) continue;
    let readers: DeskReader[] | null = null;
    for (const desk of desks) {
      // Une erreur sur un comptoir n'arrête pas les suivants.
      try {
        const key = `comptoir-morning:${desk._id}:${day}`;
        if (await AutomationLogModel.exists({ tenantId: tenant._id, key })) continue;
        const costParts: string[] = [], opsParts: string[] = [];
        let tab = "stock";

        if (settings.comptoirMargins.enabled) {
          const sold = await productSales(String(tenant._id), desk._id, day, day);
          if (sold.length) {
            const targets = new Map((await ActivityItemModel.find({ tenantId: tenant._id, deskId: desk._id }).select("targetMarkup").lean<Array<{ _id: Id; targetMarkup?: number }>>())
              .map(i => [String(i._id), i.targetMarkup ?? desk.targetMarkup ?? 0.3]));
            // Ventes une à une sous le coût (prix plancher) : chaque ligne de ticket, pas la moyenne du jour.
            const under = await ComptoirSaleModel.aggregate<{ _id: string; n: number; qty: number; loss: number }>([
              { $match: { tenantId: tenant._id, deskId: desk._id, status: "paid", date: { $gte: new Date(`${day}T00:00:00.000`), $lte: new Date(`${day}T23:59:59.999`) } } },
              { $unwind: "$lines" }, { $match: { "lines.marginHT": { $lt: 0 } } },
              { $group: { _id: "$lines.label", n: { $sum: 1 }, qty: { $sum: "$lines.quantity" }, loss: { $sum: "$lines.marginHT" } } }, { $sort: { loss: 1 } },
            ]);
            if (under.length) costParts.push(`Vendu sous le coût : ${under.slice(0, 5).map(u => `${u._id} × ${u.qty} (${fcfa(u.loss)})`).join(", ")}`);
            const below: string[] = [];
            for (const r of sold) {
              if (!(r.valuedHT > 0)) continue;
              const target = targets.get(r.itemId) ?? desk.targetMarkup ?? 0.3;
              const margin = r.valuedHT - r.valuedCost;
              // Les promotions sont voulues : elles ne comptent pas dans le manque à gagner signalé.
              const shortfall = r.valuedHT * target - margin + r.promoHT;
              if ((margin / r.valuedHT) * 100 < target * 100 - settings.comptoirMargins.tolerancePts && shortfall >= MARGIN_MATERIALITY) {
                below.push(`${r.label} (${Math.round((margin / r.valuedHT) * 100)} % pour ${Math.round(target * 100)} %, manque ${fcfa(shortfall)})`);
              }
            }
            if (below.length) costParts.push(`Sous l'objectif de marge : ${below.slice(0, 5).join(", ")}`);
            const unvalued = sold.filter(r => r.unvaluedQty > 0);
            if (unvalued.length) costParts.push(`${unvalued.length} article(s) vendu(s) sans coût, marge inconnue : ${unvalued.slice(0, 4).map(r => r.label).join(", ")} (renseigner le coût dans l'onglet Marges)`);
            if (costParts.length) tab = "rentabilite";
          }
        }

        if (settings.comptoirReorder.enabled) {
          const plan = await reorderPlan(String(tenant._id), String(desk._id));
          const urgent = plan.toOrder.filter(l => l.urgent);
          if (urgent.length) {
            let note = "";
            if (settings.comptoirReorder.autoOrder) {
              // Le plan déduit déjà les quantités en commande : pas de second bon pour la même rupture.
              const actor = await actorWith(tenant._id, ["pme_admin", "pme_manager", "pme_accountant", "svc_admin"], "commandes", "create");
              const lines = urgent.filter(l => l.linked).map(l => ({ itemId: l.itemId, quantity: l.quantity }));
              if (actor && lines.length) {
                const r = await createReorderOrders(actor.auth as never, String(desk._id), lines, { note: `Réassort automatique — ${desk.name}` });
                if ("error" in r) errors.push(`${tenant.name} / ${desk.name} : ${r.error}`);
                else {
                  ordered += r.orders.length;
                  if (r.orders.length) note += ` ${r.orders.length} bon(s) de commande brouillon préparé(s), à valider par l'acheteur ou le gérant (Achats & stock → Bons de commande).`;
                  if (r.noSupplier.length) note += ` Sans fournisseur habituel, non commandés : ${r.noSupplier.slice(0, 4).join(", ")}.`;
                }
              }
              const shopping = urgent.filter(l => !l.linked);
              if (shopping.length) note += ` Liste de courses (articles propres au comptoir) : ${shopping.slice(0, 4).map(l => `${l.name} ${l.quantity} ${l.unit}`).join(", ")}.`;
            }
            opsParts.push(`Réassort : ${urgent.length} article(s) en rupture avant le prochain approvisionnement — ${urgent.slice(0, 6).map(l => `${l.name} (${l.quantity} ${l.unit}${l.onOrder ? `, ${l.onOrder} déjà en commande` : ""})`).join(", ")}.${note}`);
          }
        }

        if (settings.easypayRecon.enabled) {
          const key = await ApiKeyModel.findOne({ tenantId: tenant._id, deskId: desk._id, isActive: true, revokedAt: { $exists: false } }).select("_id").lean();
          const hasEvents = await IntegrationEventModel.exists({ tenantId: tenant._id, deskId: desk._id, source: "easypay" });
          if (key || hasEvents) {
            // Tout ce qui reste à traiter, quelle que soit sa date.
            const open = await IntegrationEventModel.aggregate<{ n: number; oldest: Date }>([
              { $match: { tenantId: tenant._id, deskId: desk._id, source: "easypay", status: { $in: ["failed", "rejected"] } } },
              { $group: { _id: null, n: { $sum: 1 }, oldest: { $min: "$createdAt" } } },
            ]);
            if (open[0]?.n) opsParts.push(`EasyPay : ${open[0].n} événement(s) en attente de traitement, le plus ancien du ${new Date(open[0].oldest).toLocaleDateString("fr-FR")} (Comptoir → EasyPay : rejouer ou écarter)`);
            const unposted = await ComptoirSaleModel.aggregate<{ n: number; ttc: number }>([
              { $match: { tenantId: tenant._id, deskId: desk._id, status: "paid", entryId: { $exists: false }, "payments.method": "easypay" } },
              { $group: { _id: null, n: { $sum: 1 }, ttc: { $sum: "$totalTTC" } } },
            ]);
            if (unposted[0]?.n) opsParts.push(`EasyPay : ${unposted[0].n} ticket(s) payé(s) par carte hors comptabilité (${fcfa(unposted[0].ttc)}) : relier le comptoir à une caisse (Paramètres du comptoir)`);
            const last = await IntegrationEventModel.findOne({ tenantId: tenant._id, deskId: desk._id, source: "easypay" }).sort({ createdAt: -1 }).select("createdAt").lean<{ createdAt: Date } | null>();
            if (key && (!last || now.getTime() - new Date(last.createdAt).getTime() > DAY)) {
              opsParts.push(`EasyPay : aucune vente reçue de la caisse ${last ? `depuis le ${new Date(last.createdAt).toLocaleString("fr-FR")}` : "depuis la mise en service de la clé"} — vérifier la connexion de la caisse si le comptoir était ouvert`);
            }
            if (opsParts.some(p => p.startsWith("EasyPay")) && tab === "stock") tab = "easypay";
          }
        }

        if (!costParts.length && !opsParts.length) continue;
        if (!(await claimOnce(tenant._id, key))) continue;
        readers ??= await deskReaders(tenant._id);
        const title = `${desk.name} — point du matin (${dayLabel})`;
        const link = `/comptoir?desk=${desk._id}&tab=${tab}`;
        for (const r of readers.filter(x => onDesk(x, desk._id))) {
          // EasyPay (sommes dues, envois à rejouer) : seulement à ceux qui voient les coûts, seuls à pouvoir agir dans l'onglet.
          const parts = r.costs ? [...costParts, ...opsParts] : r.operate ? opsParts.filter(p => !p.startsWith("EasyPay")) : [];
          if (!parts.length) continue;
          // Sans linkedId : le point du lendemain ne doit pas être retenu parce que celui de la veille n'a pas été lu.
          await notify(tenant._id, r._id, "comptoir_morning", title, parts.join(" • "), r.costs ? link : `/comptoir?desk=${desk._id}&tab=stock`);
        }
        sent++;
      } catch (err) {
        errors.push(`${tenant.name} / ${desk.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary([[sent, "point(s) du matin de comptoir"], [ordered, "bon(s) de commande préparé(s)"]], errors);
}

// ─── 12. EasyPay : compte courant avec Numatech (hebdomadaire) ───────────────

async function runEasypayBalance(now = new Date()): Promise<string> {
  let alerted = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.easypayRecon.enabled && s.easypayRecon.threshold > 0)) {
    try {
      if (!(await IntegrationEventModel.exists({ tenantId: tenant._id, source: "easypay" }))) continue;
      const balance = await easypayBalance(String(tenant._id));
      if (Math.abs(balance) < settings.easypayRecon.threshold) continue;
      // Une fois par semaine au plus : c'est l'état normal entre deux reversements.
      if (!(await claimEvery(tenant._id, "easypay-balance", 7 * DAY - 3_600_000, now))) continue;
      const msg = balance > 0
        ? `Les ventes payées par carte EasyPay non encore reversées au comptoir atteignent ${fcfa(balance)} (compte courant 467100). Demander le reversement, puis l'enregistrer dans Comptoir → EasyPay.`
        : `Les recharges de cartes encaissées au comptoir et non encore reversées atteignent ${fcfa(-balance)} (compte courant 467100). Les reverser, puis l'enregistrer dans Comptoir → EasyPay.`;
      await notifyAll(tenant._id, FINANCE_ROLES, "easypay_balance", "EasyPay : reversement à faire", msg, "/comptoir?tab=easypay");
      alerted++;
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[alerted, "alerte(s) de reversement EasyPay"]], errors);
}

// ─── 14. Contrôles comptables du mois ────────────────────────────────────────

async function runAccountingChecks(now = new Date()): Promise<string> {
  let sent = 0;
  const errors: string[] = [];
  const d = niameyDate(now);
  // Calcul lourd (tout l'exercice) : trois organisations au plus par passage,
  // les suivantes au passage du lendemain (la clé du mois évite tout doublon).
  let budget = 3;
  for (const { tenant, settings } of await tenantsWhere((s, t) => s.accountingChecks.enabled && t.type !== "association")) {
    if (d.day < settings.accountingChecks.day || budget <= 0) continue;
    const period = previousMonth(d.year, d.month);
    const key = `checks:${period.year}-${period.month}`;
    try {
      if (!(await claimOnce(tenant._id, key))) continue;
      budget--;
      if (!(await AccountingEntryModel.exists({ tenantId: tenant._id }))) continue;
      const { anomalies, counts } = await prepareFinancialExport(String(tenant._id), period.year, { payroll: false });
      const serious = anomalies.filter(a => a.severity === "Critique" || a.severity === "Majeur");
      const label = `${MONTHS_FR[period.month - 1]} ${period.year}`;
      const msg = serious.length
        ? `${counts["Critique"]} constat(s) critique(s) et ${counts["Majeur"]} majeur(s) sur l'exercice ${period.year} : ${serious.slice(0, 3).map(a => `${a.check} (${a.piece})`).join(" ; ")}${serious.length > 3 ? "…" : ""}. Détail : Comptabilité → États comptables → Export de l'exercice, feuille « Contrôles ».`
        : `Aucun constat critique ni majeur sur l'exercice ${period.year}${counts["À vérifier"] ? ` (${counts["À vérifier"]} point(s) à vérifier)` : ""}.`;
      await notifyAll(tenant._id, FINANCE_ROLES, "accounting_checks", `Contrôles comptables après ${label}`, msg, "/accounting/etats");
      if (settings.accountingChecks.email && serious.length) {
        // Pièces et libellés saisis par les utilisateurs : échappés avant d'entrer dans le HTML.
        const items = serious.slice(0, 10).map(a => `<li><strong>${esc(a.severity)}</strong> — ${esc(a.check)} : ${esc(a.piece)}${a.amount ? ` (${esc(fcfa(a.amount))})` : ""}</li>`).join("");
        for (const u of await getRecipients(tenant._id, FINANCE_ROLES)) {
          if (u.email) await sendEmail({ to: u.email, subject: `Contrôles comptables — ${tenant.name}`, html: mailBody(`Contrôles comptables après ${label}`, [`${counts["Critique"]} constat(s) critique(s), ${counts["Majeur"]} majeur(s).`, `<ul style="margin:0;padding-left:18px;">${items}</ul>`], { href: "/accounting/etats", label: "Ouvrir les états comptables" }), text: msg });
        }
      }
      sent++;
    } catch (err) {
      await releaseClaim(tenant._id, key);
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[sent, "contrôle(s) comptable(s) mensuel(s)"]], errors);
}

// ─── 15. Calendrier fiscal (CGI 2026) ────────────────────────────────────────

async function runFiscalCalendar(now = new Date()): Promise<string> {
  let sent = 0;
  const errors: string[] = [];
  const due = fiscalRemindersDue(now);
  if (!due.length) return "rien à faire";
  const since = new Date(now.getTime() - 400 * DAY);
  for (const { tenant } of await tenantsWhere((s, t) => s.fiscalCalendar.enabled && (t.type === "pme" || t.type === "administration"))) {
    try {
      // Entreprise assujettie à la TVA : de la TVA en comptabilité depuis un an, ou une déclaration enregistrée.
      const liable = tenant.type === "administration" || !!(await AccountingEntryModel.exists({ tenantId: tenant._id, entryDate: { $gte: since }, "lines.accountCode": { $regex: "^44[35]" } }))
        || !!(await FiscalDeclarationModel.exists({ tenantId: tenant._id, type: "tva" }));
      for (const r of due) {
        if (await AutomationLogModel.exists({ tenantId: tenant._id, key: r.key })) continue;
        if (r.kind.startsWith("tva_") && !liable) continue;
        // Les administrations reversent la TVA retenue sur leurs fournisseurs ; acomptes d'IS et DSF ne les concernent pas.
        if (tenant.type === "administration" && !r.kind.startsWith("tva_")) continue;
        let message = tenant.type === "administration" ? r.message.replace("La déclaration de TVA", "Le reversement de la TVA retenue").replace("La TVA", "La TVA retenue") : r.message;
        let link = "/fiscalite";
        if (r.kind.startsWith("tva_")) {
          const done = await FiscalDeclarationModel.exists({ tenantId: tenant._id, type: "tva", "period.annee": r.period.year, "period.mois": r.period.month, status: { $in: ["submitted", "paid"] } });
          if (done) continue;
          link = `/fiscalite/tva?annee=${r.period.year}&mois=${r.period.month}`;
          if (r.kind === "tva_prepare" && tenant.type === "pme") {
            const start = new Date(r.period.year, r.period.month! - 1, 1);
            const entries = await AccountingEntryModel.find({ tenantId: tenant._id, entryDate: { $gte: start, $lte: new Date(r.period.year, r.period.month!, 0, 23, 59, 59, 999) }, ...VAT_LINES_MATCH })
              .select("journalCode lines.accountCode lines.debit lines.credit").lean<Array<{ journalCode?: string; lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>>();
            const v = vatFromEntries(entries);
            const credit = await vatCreditAt(String(tenant._id), start);
            const toPay = Math.max(0, v.net - credit);
            message += ` D'après la comptabilité : collectée ${fcfa(v.collected)}, déductible ${fcfa(v.deductible)}${credit ? `, crédit reporté ${fcfa(credit)}` : ""} : ${toPay ? `${fcfa(toPay)} à verser` : "rien à verser"}.`;
            // Brouillon de la déclaration du mois (jamais par-dessus une déclaration existante).
            await FiscalDeclarationModel.updateOne(
              { tenantId: tenant._id, type: "tva", "period.annee": r.period.year, "period.mois": r.period.month },
              { $setOnInsert: { status: "draft", amounts: { montant: v.collected, deductible: v.deductible, net: v.net } } },
              { upsert: true },
            );
          }
        }
        if (r.kind.startsWith("tva_")) {
          // Même échéance du 15 : ITS retenu sur les salaires et retenues à la source, soldes à fin de mois.
          // (La CNSS, due 30 jours après la période, n'est pas couverte par ce rappel.)
          const end = new Date(r.period.year, r.period.month!, 0, 23, 59, 59, 999);
          const bal = await AccountingEntryModel.aggregate<{ _id: string; v: number }>([
            { $match: { tenantId: tenant._id, entryDate: { $lte: end }, "lines.accountCode": { $regex: "^447[12]" } } },
            { $unwind: "$lines" },
            { $match: { "lines.accountCode": { $regex: "^447[12]" } } },
            { $group: { _id: { $substrCP: ["$lines.accountCode", 0, 4] }, v: { $sum: { $subtract: [{ $ifNull: ["$lines.credit", 0] }, { $ifNull: ["$lines.debit", 0] }] } } } },
          ]);
          const its = Math.round(bal.find(b => b._id === "4471")?.v ?? 0), wh = Math.round(bal.find(b => b._id === "4472")?.v ?? 0);
          const also = [its > 0 ? `ITS retenu sur les salaires ${fcfa(its)} (447100)` : "", wh > 0 ? `retenues à la source ${fcfa(wh)} (447200)` : ""].filter(Boolean);
          if (also.length) message += ` À reverser aussi avant le 15, d'après les soldes au ${end.toLocaleDateString("fr-FR")} : ${also.join(", ")}.`;
        }
        if (r.kind === "is_acompte") {
          link = "/fiscalite/isbic";
          const decl = await FiscalDeclarationModel.findOne({ tenantId: tenant._id, type: "isbic", "period.annee": r.period.year - 1, status: { $in: ["submitted", "paid"] } }).sort({ updatedAt: -1 })
            .lean<{ amounts?: { montant?: number } } | null>();
          message += decl?.amounts?.montant ? ` Montant : ${fcfa(decl.amounts.montant * 0.2)} (20 % de l'IS/IMF ${r.period.year - 1} enregistré).` : ` La déclaration IS/BIC ${r.period.year - 1} n'est pas enregistrée dans Kanoo : montant à calculer avec votre fiscaliste.`;
        }
        if (!(await claimOnce(tenant._id, r.key))) continue;
        await notifyAll(tenant._id, FINANCE_ROLES, "fiscal_reminder", tenant.type === "administration" ? r.title.replace("TVA", "TVA retenue") : r.title, message, link);
        sent++;
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[sent, "rappel(s) fiscal(aux)"]], errors);
}

// ─── 16. Factures fournisseurs à payer ───────────────────────────────────────

async function runSupplierPayments(now = new Date()): Promise<string> {
  let alerted = 0;
  const errors: string[] = [];
  // Page « Échéancier fournisseurs » : menu des entreprises.
  for (const { tenant, settings } of await tenantsWhere((s, t) => s.supplierPayments.enabled && t.type === "pme")) {
    try {
      const sched = await supplierSchedule(String(tenant._id), now);
      const limit = now.getTime() + settings.supplierPayments.horizonDays * DAY;
      const soon = sched.rows.filter(r => !r.bucket.startsWith("overdue") && r.dueDate && new Date(r.dueDate).getTime() <= limit);
      const late = sched.rows.filter(r => r.bucket.startsWith("overdue"));
      if (!soon.length && !late.length) continue;
      // Une alerte par semaine au plus : l'échéancier détaille le reste.
      if (!(await claimEvery(tenant._id, "suppliers:schedule", 7 * DAY - 3_600_000, now))) continue;
      const sum = (rs: typeof soon) => rs.reduce((t, r) => t + r.remaining, 0);
      const msg = [
        late.length ? `${late.length} facture(s) en retard pour ${fcfa(sum(late))}` : "",
        soon.length ? `${soon.length} à payer dans les ${settings.supplierPayments.horizonDays} jours pour ${fcfa(sum(soon))}` : "",
      ].filter(Boolean).join(" ; ");
      await notifyAll(tenant._id, FINANCE_ROLES, "supplier_payments", "Factures fournisseurs à payer", `${msg}. Voir Achats & stock → Échéancier fournisseurs.`, "/depenses/echeancier");
      alerted++;
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[alerted, "alerte(s) de paiement fournisseur"]], errors);
}

// ─── 18. Restauration : inventaire de fin de semaine ─────────────────────────

/**
 * Le jour choisi, à 15 h (après le service du midi), chaque comptoir reçoit son inventaire de fin de semaine
 * (comptoir, et réserve si demandé), ouvert d'office au nom d'un responsable
 * du comptoir : l'équipe compte au scanner avant la fermeture. Les deux jours
 * suivants, tant qu'il reste ouvert, le chef est relancé pour le valider.
 */
async function runWeeklyInventory(now = new Date()): Promise<string> {
  let opened = 0, reminded = 0;
  const errors: string[] = [];
  const d = niameyDate(now);
  const today = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const weekday = today.getUTCDay();
  const dayKey = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  for (const { tenant, settings } of await tenantsWhere(s => s.weeklyInventory.enabled)) {
    const cfg = settings.weeklyInventory;
    const since = (weekday - cfg.day + 7) % 7; // 0 = le jour même, 1-2 = jours de relance
    if (since > 2) continue;
    const desks = await ActivityDeskModel.find({ tenantId: tenant._id, archived: { $ne: true } }).select("name").lean<Array<{ _id: Id; name: string }>>();
    if (!desks.length) continue;
    const readers = await deskReaders(tenant._id);
    // Semaine repérée par le jour d'ouverture de l'inventaire.
    const opening = new Date(today.getTime() - since * DAY), weekKey = opening.toISOString().slice(0, 10);
    for (const desk of desks) {
      try {
        const mine = readers.filter(r => onDesk(r, desk._id));
        const chefs = mine.filter(r => r.costs);
        const link = `/comptoir?desk=${desk._id}&tab=stock`;
        if (since === 0) {
          if (!chefs.length || !(await claimOnce(tenant._id, `weekly-inventory:${desk._id}:${weekKey}`))) continue;
          const actor = await actAs(chefs[0]._id);
          if (!actor) continue;
          const levels: Array<"desk" | "reserve"> = cfg.level === "both" ? ["desk", "reserve"] : ["desk"];
          const done: string[] = [];
          for (const level of levels) {
            try { await openInventory(actor.auth as never, String(desk._id), level, undefined, false, true); done.push(level === "desk" ? "du comptoir" : "de la réserve"); }
            catch (e) { if (!(e instanceof BusinessRuleError)) throw e; }
          }
          if (!done.length) continue;
          for (const r of mine) await notify(tenant._id, r._id, "stock_alert", `${desk.name} — inventaire de fin de semaine`, `Inventaire ${done.join(" et ")} ouvert : comptez au scanner avant la fermeture (Stock → Inventaires), puis le chef le valide.`, link);
          opened++;
        } else {
          const open = await DeskInventoryModel.countDocuments({ tenantId: tenant._id, deskId: desk._id, status: "open", createdAt: { $gte: new Date(opening.getTime() - DAY) } });
          if (!open || !(await claimOnce(tenant._id, `weekly-inventory-reminder:${desk._id}:${dayKey}`))) continue;
          for (const r of chefs) await notify(tenant._id, r._id, "stock_alert", `${desk.name} — inventaire de la semaine à valider`, `${open} inventaire(s) de fin de semaine encore ouvert(s) : vérifiez les comptages et validez pour mettre le stock à jour.`, link);
          reminded++;
        }
      } catch (err) {
        errors.push(`${tenant.name} / ${desk.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary([[opened, "inventaire(s) de fin de semaine ouvert(s)"], [reminded, "relance(s) de validation"]], errors);
}

// ─── 17. Appels d'offres sans réponse ────────────────────────────────────────

async function runTenderFollowup(now = new Date()): Promise<string> {
  let sent = 0;
  const errors: string[] = [];
  for (const { tenant, settings } of await tenantsWhere(s => s.tenderFollowup.enabled)) {
    try {
      const after = settings.tenderFollowup.afterDays;
      const cutoff = new Date(now.getTime() - after * DAY);
      const stale = await AppelCandidatureModel.find({ tenantId: tenant._id, status: { $in: ["submitted", "evaluation"] } })
        .select("title organism ownerId stageChangedAt updatedAt status result.submittedAt").lean<Array<{ _id: Id; title: string; organism?: string; ownerId?: Id; stageChangedAt?: Date; updatedAt?: Date; status: string; result?: { submittedAt?: Date } }>>();
      for (const a of stale) {
        // Depuis le dépôt de l'offre : le passage en évaluation ne remet pas le compteur à zéro.
        const ref = new Date(a.result?.submittedAt ?? a.stageChangedAt ?? a.updatedAt ?? now);
        if (ref > cutoff) continue;
        const since = Math.floor((now.getTime() - ref.getTime()) / DAY);
        // Au-delà de six mois, le dossier est à clore à la main : plus de relance automatique.
        if (since > 180) continue;
        if (!(await claimEvery(tenant._id, `tender:${a._id}`, after * DAY - 3_600_000, now))) continue;
        const msg = `« ${a.title} »${a.organism ? ` (${a.organism})` : ""} : offre déposée depuis ${since} jours, toujours sans résultat. Relancez l'acheteur, ou saisissez le résultat (obtenu ou non retenu) ; pensez à la date de fin de validité de l'offre.`;
        // Responsable du dossier ; à défaut (absent ou inactif), les dirigeants.
        const owner = a.ownerId ? await UserModel.exists({ _id: a.ownerId, tenantId: tenant._id, isActive: true }) : null;
        const to = owner ? [{ _id: a.ownerId! }] : await getAdmins(tenant._id, LEADER_ROLES);
        // Sans linkedId : une relance non lue ne doit pas bloquer la suivante.
        for (const u of to) await notify(tenant._id, u._id, "tender_followup", "Offre sans réponse", msg, `/appels/${a._id}`);
        sent++;
      }
    } catch (err) {
      errors.push(`${tenant.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary([[sent, "relance(s) d'offre"]], errors);
}

export const AUTOMATION_JOBS: CronJob[] = [
  { id: "auto-depreciation", label: "Amortissements de l'exercice écoulé", cadence: "monthly", schedule: "30 1 1 * *", run: () => runDepreciation() },
  { id: "morning-brief", label: "Brief du matin (e-mail / WhatsApp)", cadence: "daily", schedule: "0 6 * * *", run: () => runMorningBrief() },
  { id: "treasury-alert", label: "Alerte de découvert prévisionnel", cadence: "daily", schedule: "15 6 * * *", run: () => runTreasuryAlert() },
  { id: "payroll-prep", label: "Paie du mois (rappel, génération d'office)", cadence: "daily", schedule: "20 6 * * *", run: () => runPayroll() },
  { id: "accountant-packet", label: "Dossier mensuel du comptable", cadence: "daily", schedule: "25 6 * * *", run: () => runAccountantPacket() },
  { id: "approval-reminders", label: "Validations en attente", cadence: "daily", schedule: "0 9 * * *", run: () => runApprovalReminders() },
  { id: "budget-alerts", label: "Dépassements budgétaires", cadence: "daily", schedule: "10 7 * * *", run: () => runBudgetAlerts() },
  { id: "cotisation-reminders", label: "Cotisations impayées", cadence: "daily", schedule: "0 10 * * *", run: () => runCotisationReminders() },
  { id: "backup", label: "Sauvegarde chiffrée de la base", cadence: "daily", schedule: "0 2 * * *", run: () => runDailyBackup() },
  { id: "error-digest", label: "Résumé quotidien des erreurs", cadence: "daily", schedule: "45 6 * * *", run: () => runErrorDigest() },
  { id: "comptoir-morning", label: "Comptoir : point du matin (marges, réassort, EasyPay)", cadence: "daily", schedule: "35 6 * * *", run: () => runComptoirMorning() },
  { id: "easypay-balance", label: "EasyPay : reversement à faire", cadence: "daily", schedule: "40 6 * * *", run: () => runEasypayBalance() },
  { id: "accounting-checks", label: "Contrôles comptables du mois", cadence: "daily", schedule: "30 7 * * *", run: () => runAccountingChecks() },
  { id: "fiscal-calendar", label: "Calendrier fiscal (TVA, acomptes d'IS, DSF)", cadence: "daily", schedule: "5 7 * * *", run: () => runFiscalCalendar() },
  { id: "supplier-payments", label: "Factures fournisseurs à payer", cadence: "daily", schedule: "20 7 * * *", run: () => runSupplierPayments() },
  { id: "tender-followup", label: "Offres sans réponse", cadence: "daily", schedule: "40 7 * * *", run: () => runTenderFollowup() },
  { id: "weekly-inventory", label: "Restauration : inventaire de fin de semaine", cadence: "daily", schedule: "0 15 * * *", run: () => runWeeklyInventory() },
];

/** Pour les tests et le déclenchement manuel à une date donnée. */
export const AUTOMATION_RUNNERS = {
  runDepreciation, runMorningBrief, runTreasuryAlert, runPayroll, runAccountantPacket,
  runApprovalReminders, runBudgetAlerts, runCotisationReminders, runDailyBackup, runErrorDigest,
  runComptoirMorning, runEasypayBalance, runAccountingChecks, runFiscalCalendar, runSupplierPayments, runTenderFollowup, runWeeklyInventory,
};
