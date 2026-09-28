import mongoose from "mongoose";
import { NotificationModel } from "@/models/Notification";
import { UserModel } from "@/models/User";
import { InvoiceModel } from "@/models/Invoice";
import { ProductModel } from "@/models/Product";
import { ContractModel } from "@/models/Contract";
import { EmployeeModel } from "@/models/Employee";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { TenantModel } from "@/models/Tenant";
import { CRMOpportunityModel } from "@/models/CRMOpportunity";
import { SubscriptionPurchaseModel } from "@/models/SubscriptionPurchase";
import { SubscriptionSaleModel } from "@/models/SubscriptionSale";
import { AdminDocumentModel } from "@/models/AdminDocument";
import { LetterModel } from "@/models/Letter";
import { courrierReminderPlan, courrierReminderEmail, DUE_SOON_DAYS, type ReminderCandidate } from "@/lib/courriers";
import { sendEmail } from "@/lib/email";
import { buildAlerts, type PurchaseLike, type SaleLike } from "@/lib/subscriptions";
import { buildAlerts as buildDocumentAlerts } from "@/lib/admin-documents";
import { resetYearlySequences } from "@/lib/numbering";
import { planForTenant } from "@/lib/dunning-context";
import { executeAction } from "@/lib/dunning-send";

/** Rôles qui reçoivent les relances de courriers entrants. */
const COURRIER_ROLES = ["pme_admin", "pme_manager", "pme_accountant", "asso_president", "asso_secretary", "admin_ordonnateur"];

/**
 * Les tâches planifiées de Kanoo, en un seul endroit.
 *
 * Elles étaient définies inline dans `scripts/scheduler.ts`, un processus
 * permanent (node-cron) — impossible sur l'hébergement Next.js managé de
 * Hostinger, qui ne fait tourner que l'application web. Extraites ici, elles
 * servent DEUX déclencheurs sans se dupliquer :
 *   • le script scheduler (pour un VPS avec worker permanent) ;
 *   • l'endpoint /api/cron, appelé par une tâche cron Hostinger.
 *
 * Chaque tâche porte sa `cadence` : la tâche cron de l'hébergeur appelle
 * l'endpoint avec `?group=daily` chaque matin, `?group=monthly` le 1er du mois,
 * `?group=yearly` le 1er janvier. L'heure exacte est décidée par l'ordonnanceur
 * de l'hébergeur, plus par une expression cron interne.
 */

type Id = mongoose.Types.ObjectId;
export type Cadence = "daily" | "monthly" | "yearly";

export interface CronJob {
  id: string;
  label: string;
  cadence: Cadence;
  /** Conservée pour le scheduler VPS ; ignorée par l'endpoint. */
  schedule: string;
  run: () => Promise<string>;
}

async function notify(
  tenantId: Id, userId: Id, type: string, title: string, message: string,
  linkedTo?: string, linkedId?: Id
) {
  await NotificationModel.create({ tenantId, userId, type, title, message, linkedTo, linkedId })
    .catch((err: unknown) => console.error("[Cron] notification non créée:", err));
}

async function getAdmins(tenantId: Id, roles: string[]): Promise<Array<{ _id: Id }>> {
  return UserModel.find({ tenantId, role: { $in: roles }, isActive: true })
    .select("_id").lean<Array<{ _id: Id }>>();
}

export const CRON_JOBS: CronJob[] = [
  {
    id: "recurring-contracts", label: "Contrats récurrents à facturer",
    cadence: "daily", schedule: "0 6 * * *",
    run: async () => {
      const due = await ContractModel.find({
        isRecurring: true, autoGenerateInvoice: true, status: "active",
        nextBillingDate: { $lte: new Date() },
      }).select("_id").lean<Array<{ _id: Id }>>();
      // La génération passe par l'API (auteur + audit). Ce job signale le travail.
      return `${due.length} contrat(s) à facturer`;
    },
  },
  {
    id: "overdue-invoices", label: "Factures en retard",
    cadence: "daily", schedule: "30 6 * * *",
    run: async () => {
      const overdue = await InvoiceModel.find({
        status: { $in: ["sent", "partial"] }, dueDate: { $lt: new Date() },
      }).lean<Array<{ _id: Id; tenantId: Id; number: string; totalTTC: number }>>();
      for (const inv of overdue) {
        const admins = await getAdmins(inv.tenantId, ["pme_admin", "pme_accountant", "pme_manager"]);
        for (const admin of admins) {
          await notify(inv.tenantId, admin._id, "invoice_overdue", "Facture en retard",
            `Facture ${inv.number} — ${inv.totalTTC.toLocaleString("fr-FR")} XOF échue`, "invoices", inv._id);
        }
      }
      return `${overdue.length} facture(s) traitée(s)`;
    },
  },
  {
    id: "stock-alerts", label: "Alertes stock minimum",
    cadence: "daily", schedule: "0 7 * * *",
    run: async () => {
      const products = await ProductModel.find({
        isActive: true, $expr: { $lte: ["$stockQty", "$stockMinAlert"] },
      }).lean<Array<{ _id: Id; tenantId: Id; label: string; stockQty: number; unit: string; stockMinAlert: number }>>();
      for (const product of products) {
        const admins = await getAdmins(product.tenantId, ["pme_admin", "pme_purchases", "pme_manager"]);
        for (const admin of admins) {
          await notify(product.tenantId, admin._id, "stock_alert", "Alerte stock",
            `Stock faible : ${product.label} — ${product.stockQty} ${product.unit} (seuil : ${product.stockMinAlert})`,
            "stock", product._id);
        }
      }
      return `${products.length} alerte(s) envoyée(s)`;
    },
  },
  {
    id: "courriers-echus", label: "Courriers entrants à répondre (relance e-mail)",
    cadence: "daily", schedule: "45 7 * * *",
    run: async () => {
      // Candidats larges côté base, règles fines (pré-relance J-2, espacement
      // 3 jours) dans courrierReminderPlan — testée unitairement.
      const horizon = new Date(Date.now() + DUE_SOON_DAYS * 86_400_000);
      const letters = await LetterModel.find({
        direction: "incoming", handled: { $ne: true }, archived: { $ne: true },
        dueDate: { $lte: horizon },
      }).select("_id tenantId reference subject dueDate direction handled archived lastReminderAt")
        .lean<Array<ReminderCandidate & { _id: Id; tenantId: Id }>>();
      const plan = courrierReminderPlan(letters);
      const due = [...plan.overdue, ...plan.dueSoon];
      if (due.length === 0) return "0 courrier à relancer";

      const byTenant = new Map<string, typeof due>();
      for (const l of due) {
        const k = String(l.tenantId);
        byTenant.set(k, [...(byTenant.get(k) ?? []), l]);
      }
      const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
      let mails = 0;
      for (const [, scoped] of byTenant) {
        const tenantId = scoped[0].tenantId;
        const recipients = await UserModel.find({
          tenantId, isActive: true,
          $or: [{ role: { $in: COURRIER_ROLES } }, { roles: { $in: COURRIER_ROLES } }],
        }).select("_id email firstName").lean<Array<{ _id: Id; email?: string; firstName?: string }>>();
        const scopedPlan = {
          overdue: plan.overdue.filter(l => String(l.tenantId) === String(tenantId)),
          dueSoon: plan.dueSoon.filter(l => String(l.tenantId) === String(tenantId)),
        };
        for (const u of recipients) {
          for (const l of scoped) {
            const late = scopedPlan.overdue.includes(l);
            await notify(tenantId, u._id, "courrier_due", late ? "Courrier en retard de réponse" : "Courrier à répondre bientôt",
              `Courrier ${l.reference || ""} « ${l.subject} » — échéance ${new Date(l.dueDate!).toLocaleDateString("fr-FR")}.`, "documents", l._id as Id);
          }
          if (u.email) {
            const mail = courrierReminderEmail(u.firstName, scopedPlan, baseUrl);
            const r = await sendEmail({ to: u.email, ...mail });
            if (r.sent) mails++;
          }
        }
        await LetterModel.updateMany({ _id: { $in: scoped.map(l => l._id) } }, { $set: { lastReminderAt: new Date() } });
      }
      return `${due.length} courrier(s) relancé(s), ${mails} e-mail(s) envoyé(s)`;
    },
  },
  {
    id: "admin-documents", label: "Documents administratifs à renouveler",
    cadence: "daily", schedule: "15 7 * * *",
    run: async () => {
      const documents = await AdminDocumentModel.find({ archivedAt: { $exists: false } })
        .lean<Array<{ _id: Id; tenantId: Id; label: string; type: string }>>();
      const byTenant = new Map<string, typeof documents>();
      for (const doc of documents) {
        const key = String(doc.tenantId);
        const list = byTenant.get(key);
        if (list) list.push(doc); else byTenant.set(key, [doc]);
      }
      let sent = 0;
      for (const [, scoped] of byTenant) {
        const actionable = buildDocumentAlerts(scoped as never).filter(a => a.level !== "info");
        if (actionable.length === 0) continue;
        const tenantId = scoped[0].tenantId;
        const admins = await getAdmins(tenantId, [
          "pme_admin", "pme_manager", "asso_president", "asso_secretary", "admin_ordonnateur",
        ]);
        for (const admin of admins) {
          for (const alert of actionable.slice(0, 10)) {
            await notify(tenantId, admin._id, "admin_document",
              alert.level === "critical" ? "Document — action requise" : "Document à renouveler",
              `${alert.label} : ${alert.message}`, "documents-administratifs", alert.documentId as unknown as Id);
            sent++;
          }
        }
      }
      return `${sent} notification(s) pour ${byTenant.size} organisation(s)`;
    },
  },
  {
    id: "contracts-expiring", label: "Contrats expirant bientôt",
    cadence: "daily", schedule: "30 7 * * *",
    run: async () => {
      const limit = new Date(Date.now() + 30 * 86400000);
      const expiring = await ContractModel.find({
        status: "active", endDate: { $lte: limit, $gte: new Date() },
      }).lean<Array<{ _id: Id; tenantId: Id; title: string; endDate: Date }>>();
      for (const contract of expiring) {
        const admins = await getAdmins(contract.tenantId, ["pme_admin", "pme_manager", "admin_ordonnateur"]);
        const daysLeft = Math.ceil((contract.endDate.getTime() - Date.now()) / 86400000);
        for (const admin of admins) {
          await notify(contract.tenantId, admin._id, "contract_expiry", "Contrat expirant bientôt",
            `Contrat "${contract.title}" expire dans ${daysLeft} jours (${contract.endDate.toLocaleDateString("fr-FR")})`,
            "contracts", contract._id);
        }
      }
      return `${expiring.length} contrat(s) notifié(s)`;
    },
  },
  {
    id: "employee-contracts", label: "Fins de contrat employé",
    cadence: "daily", schedule: "0 8 * * *",
    run: async () => {
      const limit = new Date(Date.now() + 30 * 86400000);
      const expiring = await EmployeeModel.find({
        isActive: true, contractEndDate: { $lte: limit, $gte: new Date() },
      }).lean<Array<{ _id: Id; tenantId: Id; firstName: string; lastName: string; contractEndDate: Date }>>();
      for (const emp of expiring) {
        const admins = await getAdmins(emp.tenantId, ["pme_admin", "pme_hr"]);
        const daysLeft = Math.ceil((emp.contractEndDate.getTime() - Date.now()) / 86400000);
        for (const admin of admins) {
          await notify(emp.tenantId, admin._id, "employee_contract_expiry", "Fin de contrat imminente",
            `Contrat de ${emp.firstName} ${emp.lastName} expire dans ${daysLeft} jours`, "employees", emp._id);
        }
      }
      return `${expiring.length} fin(s) de contrat notifiée(s)`;
    },
  },
  {
    id: "recurring-expenses", label: "Dépenses récurrentes échues",
    cadence: "daily", schedule: "30 8 * * *",
    run: async () => {
      const due = await RecurringExpenseModel.find({
        isActive: true, nextDueDate: { $lte: new Date() },
      }).lean<Array<{ _id: Id; tenantId: Id; label: string; amount: number }>>();
      for (const expense of due) {
        const admins = await getAdmins(expense.tenantId, ["pme_admin", "pme_accountant"]);
        for (const admin of admins) {
          await notify(expense.tenantId, admin._id, "expense_due", "Dépense récurrente à payer",
            `${expense.label} — ${expense.amount.toLocaleString("fr-FR")} XOF`, "recurring-expenses", expense._id);
        }
      }
      return `${due.length} dépense(s) notifiée(s)`;
    },
  },
  {
    id: "crm-followups", label: "Relances CRM",
    cadence: "daily", schedule: "0 9 * * *",
    run: async () => {
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const due = await CRMOpportunityModel.find({
        nextFollowUpDate: { $lt: tomorrow }, stage: { $nin: ["won", "lost"] },
      }).lean<Array<{ _id: Id; tenantId: Id; title: string }>>();
      for (const opp of due) {
        const admins = await getAdmins(opp.tenantId, ["pme_admin", "pme_manager"]);
        for (const admin of admins) {
          await notify(opp.tenantId, admin._id, "crm_followup", "Relance CRM",
            `Opportunité "${opp.title}" — relance due`, "crm", opp._id);
        }
      }
      return `${due.length} relance(s) notifiée(s)`;
    },
  },
  {
    id: "subscriptions", label: "Échéances des abonnements",
    cadence: "daily", schedule: "30 9 * * *",
    run: async () => {
      const [purchases, sales] = await Promise.all([
        SubscriptionPurchaseModel.find({ status: { $ne: "cancelled" } })
          .lean<Array<PurchaseLike & { tenantId: Id }>>(),
        SubscriptionSaleModel.find({ status: { $nin: ["cancelled", "draft"] } })
          .lean<Array<SaleLike & { tenantId: Id }>>(),
      ]);
      const tenants = new Set<string>([
        ...purchases.map(p => String(p.tenantId)), ...sales.map(s => String(s.tenantId)),
      ]);
      let sent = 0;
      for (const tenantId of tenants) {
        const scopedPurchases = purchases.filter(p => String(p.tenantId) === tenantId);
        const scopedSales = sales.filter(s => String(s.tenantId) === tenantId);
        const actionable = buildAlerts(scopedPurchases, scopedSales).filter(a => a.level !== "info");
        if (actionable.length === 0) continue;
        const tenantObjectId = scopedPurchases[0]?.tenantId ?? scopedSales[0]?.tenantId;
        const admins = await getAdmins(tenantObjectId, ["pme_admin", "pme_manager", "pme_accountant"]);
        for (const admin of admins) {
          for (const alert of actionable.slice(0, 10)) {
            await notify(tenantObjectId, admin._id, "subscription_alert",
              alert.level === "critical" ? "Abonnement — action requise" : "Abonnement — échéance proche",
              alert.message, "abonnements");
            sent++;
          }
        }
      }
      return `${sent} notification(s) pour ${tenants.size} organisation(s)`;
    },
  },
  {
    id: "dunning", label: "Relances clients",
    cadence: "daily", schedule: "0 10 * * *",
    // Le seul job qui écrit à des tiers. Même moteur que l'écran d'aperçu ;
    // n'envoie jamais une mise en demeure (elle attend une validation humaine).
    run: async () => {
      const tenants = await TenantModel.find({ subscriptionStatus: { $in: ["active", "trial"] } })
        .select("_id name").lean<Array<{ _id: Id; name: string }>>();
      let sent = 0, failed = 0, held = 0, active = 0;
      for (const tenant of tenants) {
        const { plan, context, settings } = await planForTenant(String(tenant._id));
        if (!settings.enabled || plan.actions.length === 0) continue;
        active++;
        const invoiceById = new Map(context.invoices.map(i => [String(i._id), i]));
        for (const action of plan.actions) {
          if (action.needsApproval) { held++; continue; }
          const client = context.clients.get(action.clientId);
          const invoice = invoiceById.get(action.invoiceId);
          if (!client || !invoice?.dueDate) continue;
          const result = await executeAction(action,
            { email: client.email, phone: client.phone },
            { tenantId: String(tenant._id), tenantName: context.tenantName, settings, automatic: true, bccEmail: settings.bccEmail },
            new Date(invoice.dueDate));
          if (result.outcome === "sent" || result.outcome === "partial") sent++;
          else if (result.outcome === "failed") {
            failed++;
            console.error(`[Cron] Relance ${result.invoiceNumber} en échec : ${result.errors.join(" ; ")}`);
          }
        }
      }
      return `${sent} relance(s) pour ${active} organisation(s), ${held} en attente, ${failed} en échec`;
    },
  },
  {
    id: "vat-reminders", label: "Rappels TVA et purge des jetons",
    cadence: "monthly", schedule: "0 1 1 * *",
    run: async () => {
      const now = new Date();
      const tenants = await TenantModel.find({
        subscriptionStatus: { $in: ["active", "trial"] }, type: { $in: ["pme", "administration"] },
      }).select("_id").lean<Array<{ _id: Id }>>();
      for (const tenant of tenants) {
        const admins = await getAdmins(tenant._id, ["pme_admin", "pme_accountant", "admin_daf"]);
        for (const admin of admins) {
          await notify(tenant._id, admin._id, "fiscal_reminder", "Rappel TVA",
            `Déclaration TVA ${now.getMonth() + 1}/${now.getFullYear()} à déposer avant le 20/${now.getMonth() + 1}/${now.getFullYear()}`,
            "fiscalite");
        }
      }
      // Purge des jetons expirés — hygiène de sécurité.
      await TenantModel.updateMany({ activationTokenExpiry: { $lt: now } },
        { $unset: { activationToken: "", activationTokenExpiry: "" } });
      await UserModel.updateMany({ passwordResetExpiry: { $lt: now } },
        { $unset: { passwordResetToken: "", passwordResetExpiry: "" } });
      return `${tenants.length} organisation(s) relancée(s), jetons expirés purgés`;
    },
  },
  {
    id: "sequence-reset", label: "Remise à zéro de la numérotation",
    cadence: "yearly", schedule: "1 0 1 1 *",
    run: async () => {
      const count = await resetYearlySequences();
      return `${count} organisation(s) réinitialisée(s)`;
    },
  },
];

export interface JobResult { id: string; label: string; summary?: string; error?: string; ms: number }

/**
 * Exécute les tâches d'un groupe de cadence. Chacune est isolée : l'échec de
 * l'une n'empêche pas les suivantes, et son erreur est rapportée, jamais avalée.
 */
export async function runCronGroup(cadence: Cadence): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of CRON_JOBS.filter(j => j.cadence === cadence)) {
    const t0 = Date.now();
    try {
      const summary = await job.run();
      results.push({ id: job.id, label: job.label, summary, ms: Date.now() - t0 });
    } catch (err) {
      results.push({ id: job.id, label: job.label, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
    }
  }
  return results;
}

/** Exécute une tâche nommée (pour un déclenchement manuel ciblé). */
export async function runCronJob(id: string): Promise<JobResult | null> {
  const job = CRON_JOBS.find(j => j.id === id);
  if (!job) return null;
  const t0 = Date.now();
  try {
    return { id: job.id, label: job.label, summary: await job.run(), ms: Date.now() - t0 };
  } catch (err) {
    return { id: job.id, label: job.label, error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}
