import { Types } from "mongoose";
import type { CronJob } from "@/lib/cron-jobs";
import { notify, getAdmins, getRecipients, actAs, liveTenants, type Id, type ActingUser } from "@/lib/cron-helpers";
import { loadAutomationSettings, claimOnce, claimEvery, releaseClaim, PLATFORM_TENANT } from "@/lib/automation-store";
import {
  niameyDate, dayKey, dateLabel, isSendDay, payrollReminderDue, isLastDayOfMonth, packetPeriodDue,
  consumption, crossedThresholds, treasuryBreach, briefText, briefHtml, MONTHS_FR, type AutomationSettings,
} from "@/lib/automations";
import { authCan } from "@/lib/role-resources";
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
          const res = await sendWhatsApp({ to: actor.user.phone, text: briefText(opts) });
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
      const employees = await EmployeeModel.find({ tenantId: tenant._id, isActive: true, startDate: { $lte: periodEnd } }).lean<PayrollEmployee[]>();
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
        if (!actor) { errors.push(`${tenant.name} : aucun gestionnaire de paie habilité`); continue; }
        let n = 0; const skipped: string[] = [];
        for (const e of fixed) {
          try {
            await withTransaction(session => generatePayslip(actor.auth as never, e, { month, year }, session));
            n++;
          } catch (err) {
            if (err instanceof PayrollError) skipped.push(`${e.firstName} ${e.lastName} : ${err.message}`);
            else throw err;
          }
        }
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
        if (channels.includes("whatsapp") && member.phone && (await sendWhatsApp({ to: member.phone, text })).sent) whatsapps++;
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
];

/** Pour les tests et le déclenchement manuel à une date donnée. */
export const AUTOMATION_RUNNERS = {
  runDepreciation, runMorningBrief, runTreasuryAlert, runPayroll, runAccountantPacket,
  runApprovalReminders, runBudgetAlerts, runCotisationReminders, runDailyBackup,
};
