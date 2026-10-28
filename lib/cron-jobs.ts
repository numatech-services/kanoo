import { registrationDueDate } from "@/lib/registration";
import { UserModel } from "@/models/User";
import { InvoiceModel } from "@/models/Invoice";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { ContractModel } from "@/models/Contract";
import { EmployeeModel } from "@/models/Employee";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { TenantModel } from "@/models/Tenant";
import { CRMOpportunityModel } from "@/models/CRMOpportunity";
import { SubscriptionPurchaseModel } from "@/models/SubscriptionPurchase";
import { SubscriptionSaleModel } from "@/models/SubscriptionSale";
import { AdminDocumentModel } from "@/models/AdminDocument";
import { LetterModel } from "@/models/Letter";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { OPEN_APPEL_STATUSES, daysUntil, reminderDue, reminderMessage } from "@/lib/appels";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { GUARANTEE_TYPES, GUARANTEE_REMINDER_DAYS, daysToExpiry } from "@/lib/guarantees";
import { retentionState } from "@/lib/retention";
import { courrierReminderPlan, courrierReminderEmail, DUE_SOON_DAYS, type ReminderCandidate } from "@/lib/courriers";
import { sendEmail } from "@/lib/email";
import { buildAlerts, type PurchaseLike, type SaleLike } from "@/lib/subscriptions";
import { buildAlerts as buildDocumentAlerts } from "@/lib/admin-documents";
import { resetYearlySequences } from "@/lib/numbering";
import { planForTenant } from "@/lib/dunning-context";
import { executeAction } from "@/lib/dunning-send";
import { notify, getAdmins, actAs, purgeNotifications, type Id } from "@/lib/cron-helpers";
import { billContractPeriod } from "@/lib/contract-billing";
import { scheduleState, type Installment } from "@/lib/installments";
import { withTransaction } from "@/lib/db";
import { BusinessRuleError } from "@/lib/errors";
import { authCan } from "@/lib/role-resources";
import { AUTOMATION_JOBS } from "@/lib/automation-jobs";
import { CronRunModel } from "@/models/CronRun";
import { CashSessionModel } from "@/models/CashSession";
import { DeskCustomerModel } from "@/models/DeskCustomer";
import { periodReport, elapsedDays } from "@/lib/comptoir-session";
import { localDay } from "@/lib/comptoir-sale";
import { targetProgress } from "@/lib/spot";
import { dayKey } from "@/lib/automations";

/** Rôles qui reçoivent les relances de courriers entrants. */
const COURRIER_ROLES = ["pme_admin", "pme_manager", "pme_accountant", "svc_admin", "asso_president", "asso_secretary", "admin_ordonnateur"];

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

export type Cadence = "daily" | "monthly" | "yearly";

/** Premier utilisateur actif des rôles donnés (dans cet ordre) qui a le droit demandé. */
async function firstActorWith(tenantId: Id, roles: string[], resource: string, action: "create" | "read" | "update" | "delete") {
  const users = await UserModel.find({ tenantId, isActive: true, $or: [{ role: { $in: roles } }, { roles: { $in: roles } }] })
    .sort({ createdAt: 1 }).select("_id role").lean<Array<{ _id: Id; role: string }>>();
  users.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role));
  for (const u of users) {
    const a = await actAs(u._id);
    if (a && authCan(a.auth, resource, action)) return a;
  }
  return null;
}

export interface CronJob {
  id: string;
  label: string;
  cadence: Cadence;
  /** Conservée pour le scheduler VPS ; ignorée par l'endpoint. */
  schedule: string;
  run: () => Promise<string>;
}

export const CRON_JOBS: CronJob[] = [
  {
    id: "recurring-contracts", label: "Contrats récurrents à facturer",
    cadence: "daily", schedule: "0 6 * * *",
    // Les contrats en facturation automatique sont réellement facturés : une
    // facture brouillon par période échue (rattrapage borné à 12 périodes),
    // au nom d'un comptable habilité, puis notifiée. L'émission (numéro
    // définitif, écriture) reste un geste humain.
    run: async () => {
      const due = await ContractModel.find({
        isRecurring: true, autoGenerateInvoice: true, status: { $in: ["active", "renewed"] },
        nextBillingDate: { $lte: new Date() },
      }).select("_id tenantId reference").lean<Array<{ _id: Id; tenantId: Id; reference: string }>>();
      let made = 0;
      const errors: string[] = [];
      const actors = new Map<string, Awaited<ReturnType<typeof firstActorWith>>>();
      for (const c of due) {
        const key = String(c.tenantId);
        if (!actors.has(key)) actors.set(key, await firstActorWith(c.tenantId, ["pme_accountant", "svc_compta", "pme_admin", "pme_manager"], "invoices", "create"));
        const actor = actors.get(key);
        if (!actor) { errors.push(`${c.reference} : aucun comptable habilité`); continue; }
        const numbers: string[] = [];
        for (let i = 0; i < 12; i++) {
          try {
            const { invoice } = await withTransaction(session => billContractPeriod({ tenantId: key, userId: String(actor.user._id) }, c._id, {}, session));
            numbers.push(invoice.number); made++;
          } catch (err) {
            // Plus de période échue (ou contrat échu) : fin du rattrapage.
            if (err instanceof BusinessRuleError) { if (!numbers.length && !/déjà facturée/.test(err.message)) errors.push(`${c.reference} : ${err.message}`); break; }
            throw err;
          }
        }
        if (numbers.length) {
          for (const admin of await getAdmins(c.tenantId, ["pme_admin", "pme_accountant", "svc_compta"])) {
            await notify(c.tenantId, admin._id, "invoice_generated", "Facture de contrat à émettre",
              `Contrat ${c.reference} : ${numbers.length} facture(s) brouillon préparée(s). Vérifiez-les puis émettez-les.`, "contracts", c._id);
          }
        }
      }
      return `${made} facture(s) préparée(s) pour ${due.length} contrat(s)${errors.length ? ` — ${errors.length} en échec : ${errors.slice(0, 3).join(" ; ")}` : ""}`;
    },
  },
  {
    id: "desk-spot", label: "Comptoirs : objectifs de la semaine et ardoises",
    cadence: "daily", schedule: "0 9 * * *",
    // Objectif en retard (à partir du 3e jour de la caisse) et ardoises à
    // relancer (dette de plus de 14 jours, ou plafond dépassé).
    run: async () => {
      let behind = 0, debts = 0;
      const open = await CashSessionModel.find({ status: "open", "targets.revenue": { $gt: 0 } }).lean<Array<{ _id: Id; tenantId: Id; deskId: Id; openDay: string; openingFloat: number; targets: { revenue: number; margin?: number } }>>();
      for (const s of open) {
        const d = elapsedDays(s.openDay);
        if (d < 3 || d > 7) continue;
        const r = await periodReport(String(s.tenantId), s.deskId, s.openDay, localDay(new Date()), s.openingFloat);
        const p = targetProgress(r.sales.revenueTTC, s.targets.revenue, d);
        if (!p?.behind) continue;
        behind++;
        for (const a of await getAdmins(s.tenantId, ["pme_admin", "pme_manager", "svc_spot"])) {
          await notify(s.tenantId, a._id, "desk_target_behind", "Comptoir : objectif de la semaine en retard",
            `${r.sales.revenueTTC.toLocaleString("fr-FR")} FCFA réalisés sur ${s.targets.revenue.toLocaleString("fr-FR")} visés (jour ${d}/7, attendu ${p.expected.toLocaleString("fr-FR")}). Il faut ${(p.perDayNeeded ?? 0).toLocaleString("fr-FR")} FCFA par jour d'ici la fin.`, "comptoir", s._id);
        }
      }
      const limit = new Date(Date.now() - 14 * 86_400_000);
      const late = await DeskCustomerModel.find({ active: true, balance: { $gt: 0 }, $or: [{ oldestDebtAt: { $lte: limit } }, { $expr: { $gt: ["$balance", "$creditLimit"] } }] })
        .lean<Array<{ _id: Id; tenantId: Id; name: string; balance: number; creditLimit: number; phone?: string }>>();
      for (const c of late) {
        debts++;
        for (const a of await getAdmins(c.tenantId, ["pme_admin", "pme_manager", "svc_spot"])) {
          await notify(c.tenantId, a._id, "desk_credit_due", "Ardoise à relancer",
            `${c.name}${c.phone ? ` (${c.phone})` : ""} doit ${c.balance.toLocaleString("fr-FR")} FCFA${c.balance > c.creditLimit ? ", au-delà de son plafond" : " depuis plus de 14 jours"}.`, "comptoir", c._id);
        }
      }
      return `${behind} objectif(s) en retard, ${debts} ardoise(s) à relancer`;
    },
  },
  {
    id: "overdue-invoices", label: "Factures en retard",
    cadence: "daily", schedule: "30 6 * * *",
    run: async () => {
      const overdue = await InvoiceModel.find({
        // « overdue » compris (posé par l'annulation d'un encaissement) ; ni
        // les avoirs ni les factures en litige.
        status: { $in: ["sent", "partial", "overdue"] },
        // Échéancier : en retard dès qu'un versement échu reste impayé.
        $or: [{ dueDate: { $lt: new Date() } }, { "installments.dueDate": { $lt: new Date() } }],
        documentType: { $ne: "credit_note" }, disputedAt: { $exists: false },
      }).lean<Array<{ _id: Id; tenantId: Id; number: string; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status: string; dueDate?: Date; installments?: Installment[] }>>()
        .then(list => list.filter(i => scheduleState(i).dueNow > 0));
      for (const inv of overdue) {
        const admins = await getAdmins(inv.tenantId, ["pme_admin", "pme_accountant", "pme_manager", "svc_compta"]);
        for (const admin of admins) {
          await notify(inv.tenantId, admin._id, "invoice_overdue", "Facture en retard",
            `Facture ${inv.number} — ${inv.totalTTC.toLocaleString("fr-FR")} FCFA échue`, "invoices", inv._id);
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
        isActive: true, isService: { $ne: true }, stockMinAlert: { $gt: 0 }, $expr: { $lte: ["$stockQty", "$stockMinAlert"] },
      }).lean<Array<{ _id: Id; tenantId: Id; label: string; stockQty: number; unit: string; stockMinAlert: number }>>();
      for (const product of products) {
        const admins = await getAdmins(product.tenantId, ["pme_admin", "pme_purchases", "pme_manager", "svc_admin"]);
        for (const admin of admins) {
          await notify(product.tenantId, admin._id, "stock_alert", "Alerte stock",
            `Stock faible : ${product.label} — ${product.stockQty} ${product.unit} (seuil : ${product.stockMinAlert})`,
            "stock", product._id);
        }
      }
      // Seuils propres à un entrepôt (boutique, dépôt, réserve de comptoir).
      const rows = await ProductStockModel.find({ minAlert: { $gt: 0 }, $expr: { $lte: ["$qty", "$minAlert"] } })
        .populate("productId", "label unit isActive").populate("warehouseId", "name isActive")
        .lean<Array<{ tenantId: Id; qty: number; minAlert: number; productId?: { _id: Id; label: string; unit: string; isActive?: boolean }; warehouseId?: { name: string; isActive?: boolean } }>>();
      const live = rows.filter(r => r.productId?.isActive !== false && r.productId && r.warehouseId?.isActive !== false);
      for (const r of live) {
        const admins = await getAdmins(r.tenantId, ["pme_admin", "pme_purchases", "pme_manager", "svc_admin"]);
        for (const admin of admins) {
          await notify(r.tenantId, admin._id, "stock_alert", "Alerte stock",
            `Stock faible à ${r.warehouseId?.name ?? "l'entrepôt"} : ${r.productId!.label} — ${r.qty} ${r.productId!.unit} (seuil : ${r.minAlert})`,
            "stock", r.productId!._id);
        }
      }
      return `${products.length + live.length} alerte(s) envoyée(s)`;
    },
  },
  {
    id: "lots-peremption", label: "Lots périmés ou à péremption sous 30 jours",
    cadence: "daily", schedule: "10 7 * * *",
    run: async () => {
      // Un récapitulatif par organisation (pas une notification par lot).
      const horizon = new Date(Date.now() + 30 * 86_400_000);
      const rows = await StockLotModel.aggregate<{ _id: Id; expired: number; soon: number }>([
        { $match: { qty: { $gt: 0 }, expiryDate: { $ne: null, $lte: horizon } } },
        { $group: { _id: "$tenantId", expired: { $sum: { $cond: [{ $lt: ["$expiryDate", new Date()] }, 1, 0] } }, soon: { $sum: { $cond: [{ $gte: ["$expiryDate", new Date()] }, 1, 0] } } } },
      ]);
      for (const r of rows) {
        const admins = await getAdmins(r._id, ["pme_admin", "pme_purchases", "pme_manager", "svc_admin", "svc_spot"]);
        for (const admin of admins) {
          await notify(r._id, admin._id, "stock_alert", "Péremption",
            `${r.expired} lot(s) périmé(s) et ${r.soon} lot(s) à péremption sous 30 jours : à écouler ou sortir du stock.`,
            "stock_lots");
        }
      }
      return `${rows.length} organisation(s) alertée(s)`;
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
          "pme_admin", "pme_manager", "svc_admin", "asso_president", "asso_secretary", "admin_ordonnateur",
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
    id: "tender-deadlines", label: "Dates limites des appels d'offres",
    cadence: "daily", schedule: "45 7 * * *",
    run: async () => {
      const now = new Date();
      const open = await AppelCandidatureModel.find({ status: { $in: OPEN_APPEL_STATUSES }, "goNoGo.decision": { $ne: "no_go" },
        submissionDeadline: { $gte: new Date(new Date(now).setHours(0, 0, 0, 0)), $lte: new Date(now.getTime() + 8 * 86400000) } })
        .lean<Array<{ _id: Id; tenantId: Id; title: string; reference?: string; organism?: string; submissionDeadline: Date; requiredDocuments?: Array<{ provided: boolean }>; createdBy?: Id }>>();
      let sent = 0;
      for (const appel of open.filter(a => reminderDue(a.submissionDeadline, now))) {
        const left = daysUntil(appel.submissionDeadline, now);
        const admins = await getAdmins(appel.tenantId, ["pme_admin", "pme_manager", "svc_admin", "admin_ordonnateur"]);
        // Le responsable du dossier aussi, même s'il n'est pas dirigeant.
        const users = new Map(admins.map(a => [String(a._id), a._id]));
        if (appel.createdBy) users.set(String(appel.createdBy), appel.createdBy);
        for (const userId of users.values()) {
          await notify(appel.tenantId, userId, "tender_deadline", left === 0 ? "Appel d'offres — dépôt aujourd'hui" : "Appel d'offres — date limite proche",
            reminderMessage(appel, left), "appels", appel._id);
          sent++;
        }
      }
      return `${sent} rappel(s) d'appel d'offres`;
    },
  },
  {
    id: "bank-guarantees", label: "Cautions bancaires à échéance",
    cadence: "daily", schedule: "50 7 * * *",
    run: async () => {
      const now = new Date();
      const list = await BankGuaranteeModel.find({ status: "active", expiryDate: { $exists: true, $lte: new Date(now.getTime() + 31 * 86400000) } })
        .lean<Array<{ _id: Id; tenantId: Id; type: keyof typeof GUARANTEE_TYPES; amount: number; beneficiary: string; expiryDate: Date; createdBy?: Id }>>();
      let sent = 0;
      for (const g of list) {
        const left = daysToExpiry(g.expiryDate, now)!;
        if (!GUARANTEE_REMINDER_DAYS.includes(left)) continue;
        const users = new Map((await getAdmins(g.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_admin", "admin_ordonnateur"])).map(a => [String(a._id), a._id]));
        if (g.createdBy) users.set(String(g.createdBy), g.createdBy);
        const what = `${GUARANTEE_TYPES[g.type]} de ${g.amount.toLocaleString("fr-FR")} FCFA (${g.beneficiary})`;
        for (const userId of users.values()) {
          await notify(g.tenantId, userId, "guarantee_expiry", left < 0 ? "Caution échue — mainlevée à demander" : "Caution bientôt échue",
            left < 0 ? `${what} est échue depuis hier : demandez la mainlevée pour arrêter la commission et récupérer le dépôt.` : `${what} échoit dans ${left} jours : prorogez-la ou demandez la mainlevée.`,
            "cautions", g._id);
          sent++;
        }
      }
      return `${sent} rappel(s) de caution`;
    },
  },
  {
    id: "retentions-claimable", label: "Retenues de garantie à réclamer",
    cadence: "daily", schedule: "55 7 * * *",
    run: async () => {
      const now = new Date();
      const held = await InvoiceModel.aggregate<{ _id: Id; tenantId: Id; invoices: Array<{ retentionAmount: number; status: string }> }>([
        { $match: { documentType: "invoice", retentionAmount: { $gt: 0 }, status: { $ne: "cancelled" }, contractId: { $exists: true } } },
        { $group: { _id: "$contractId", tenantId: { $first: "$tenantId" }, invoices: { $push: { retentionAmount: "$retentionAmount", status: "$status" } } } },
      ]);
      let sent = 0;
      for (const h of held) {
        const c = await ContractModel.findById(h._id).select("reference retentionReleases receptionProvisoireDate receptionDefinitiveDate guaranteeMonths")
          .lean<{ _id: Id; reference: string; retentionReleases?: Array<{ amount: number }>; receptionProvisoireDate?: Date; receptionDefinitiveDate?: Date; guaranteeMonths?: number } | null>();
        if (!c) continue;
        const s = retentionState(h.invoices, c, now);
        // Le jour où elle devient réclamable, puis tous les 30 jours tant qu'elle n'est pas reversée.
        if (!s.claimable || daysUntil(s.releasableFrom!, now) % 30 !== 0) continue;
        for (const admin of await getAdmins(h.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta"])) {
          await notify(h.tenantId, admin._id, "retention_claimable", "Retenue de garantie à réclamer",
            `Marché ${c.reference} : ${s.outstanding.toLocaleString("fr-FR")} FCFA de retenue de garantie sont réclamables (délai de garantie écoulé).`, "contracts", c._id);
          sent++;
        }
      }
      return `${sent} rappel(s) de retenue`;
    },
  },
  {
    id: "registration-due", label: "Droits d'enregistrement des marchés",
    cadence: "daily", schedule: "58 7 * * *",
    run: async () => {
      // Délai d'un mois après l'approbation (CGI art. 481) : rappel à J-7, J-1
      // et le lendemain de l'échéance, tant que les droits ne sont pas payés.
      const now = new Date();
      const list = await ContractModel.find({
        type: "client", status: { $in: ["active", "renewed"] }, amount: { $gt: 0 },
        $or: [{ approvalDate: { $exists: true } }, { "registration.assessedAt": { $exists: true } }],
      }).select("tenantId reference approvalDate signedDate registration")
        .lean<Array<{ _id: Id; tenantId: Id; reference: string; approvalDate?: Date; signedDate?: Date; registration?: { assessedAt?: Date; assessed?: number; paid?: number; dueDate?: Date } }>>();
      let sent = 0;
      for (const c of list) {
        const due = c.registration?.dueDate ?? registrationDueDate(c.approvalDate, c.signedDate);
        if (!due) continue;
        const paid = c.registration?.assessedAt && (c.registration.paid ?? 0) >= (c.registration.assessed ?? 0);
        if (paid) continue;
        const d = daysUntil(due, now);
        if (![7, 1, -1].includes(d)) continue;
        for (const admin of await getAdmins(c.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta"])) {
          await notify(c.tenantId, admin._id, "registration_due", d < 0 ? "Enregistrement du marché en retard" : "Enregistrement du marché à faire",
            `Marché ${c.reference} : droits d'enregistrement à payer ${d < 0 ? "depuis le" : "avant le"} ${new Date(due).toLocaleDateString("fr-FR")}.`, "contracts", c._id);
          sent++;
        }
      }
      return `${sent} rappel(s) d'enregistrement`;
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
        const admins = await getAdmins(contract.tenantId, ["pme_admin", "pme_manager", "svc_admin", "admin_ordonnateur"]);
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
        const admins = await getAdmins(emp.tenantId, ["pme_admin", "pme_hr", "svc_admin"]);
        const daysLeft = Math.ceil((emp.contractEndDate.getTime() - Date.now()) / 86400000);
        for (const admin of admins) {
          await notify(emp.tenantId, admin._id, "employee_contract_expiry", "Fin de contrat imminente",
            `Contrat de ${emp.firstName} ${emp.lastName} expire dans ${daysLeft} jours`, "employees", emp._id);
        }
      }
      // Contrat échu, fiche toujours « en poste » : la paie automatique
      // l'écarte déjà ; à renouveler ou à sortir (solde de tout compte).
      const lapsed = await EmployeeModel.find({ isActive: true, contractEndDate: { $lt: new Date() } })
        .lean<Array<{ _id: Id; tenantId: Id; firstName: string; lastName: string; contractEndDate: Date }>>();
      for (const emp of lapsed) {
        for (const admin of await getAdmins(emp.tenantId, ["pme_admin", "pme_hr", "svc_admin"])) {
          await notify(emp.tenantId, admin._id, "employee_contract_lapsed", "Contrat échu",
            `Le contrat de ${emp.firstName} ${emp.lastName} a pris fin le ${new Date(emp.contractEndDate).toLocaleDateString("fr-FR")} : renouvelez-le ou enregistrez le départ (solde de tout compte). Plus de paie automatique d'ici là.`, "employees", emp._id);
        }
      }
      return `${expiring.length} fin(s) de contrat notifiée(s), ${lapsed.length} contrat(s) échu(s)`;
    },
  },
  {
    id: "recurring-expenses", label: "Charges récurrentes échues",
    cadence: "daily", schedule: "30 8 * * *",
    run: async () => {
      const due = await RecurringExpenseModel.find({
        isActive: true, nextDueDate: { $lte: new Date() },
      }).lean<Array<{ _id: Id; tenantId: Id; label: string; amount: number }>>();
      for (const expense of due) {
        const admins = await getAdmins(expense.tenantId, ["pme_admin", "pme_accountant", "svc_compta"]);
        for (const admin of admins) {
          await notify(expense.tenantId, admin._id, "expense_due", "Dépense récurrente à payer",
            `${expense.label} — ${expense.amount.toLocaleString("fr-FR")} FCFA`, "recurring-expenses", expense._id);
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
        const admins = await getAdmins(opp.tenantId, ["pme_admin", "pme_manager", "svc_prosp", "svc_comm"]);
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
        const admins = await getAdmins(tenantObjectId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta", "svc_dev"]);
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
        const admins = await getAdmins(tenant._id, ["pme_admin", "pme_accountant", "svc_compta", "admin_daf"]);
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
      const purged = await purgeNotifications(now);
      return `${tenants.length} organisation(s) relancée(s), jetons expirés purgés, ${purged} notification(s) ancienne(s) supprimée(s)`;
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
  // Automatisations réglables par organisation (Réglages → Automatisations).
  ...AUTOMATION_JOBS,
];

export interface JobResult { id: string; label: string; summary?: string; error?: string; skipped?: string; ms: number }

/** Clé de période d'une cadence, à l'heure de Niamey. */
export function periodKey(cadence: Cadence, now = new Date()): string {
  const day = dayKey(now);
  return cadence === "daily" ? day : cadence === "monthly" ? day.slice(0, 7) : day.slice(0, 4);
}

/** Au-delà, une tâche « en cours » est tenue pour interrompue (requête coupée). */
const STALE_RUN_MS = 10 * 60_000;
/** Une tâche en échec est retentée à chaque appel, trois fois au plus par période. */
const MAX_ATTEMPTS = 3;

/**
 * Exécute les tâches d'un groupe de cadence. Chacune est isolée : l'échec de
 * l'une n'empêche pas les suivantes, et son erreur est rapportée, jamais
 * avalée. Reprise : une tâche déjà terminée pour la période est sautée, une
 * tâche en échec ou interrompue est rejouée ; passé `budgetMs`, plus aucune
 * tâche ne démarre — l'appel suivant (cron répété) reprend la suite. La
 * sauvegarde passe en premier.
 */
export async function runCronGroup(cadence: Cadence, opts: { budgetMs?: number; force?: boolean; now?: Date } = {}): Promise<JobResult[]> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  const period = periodKey(cadence, opts.now);
  const jobs = CRON_JOBS.filter(j => j.cadence === cadence).sort((a, b) => Number(b.id === "backup") - Number(a.id === "backup"));
  const results: JobResult[] = [];
  for (const job of jobs) {
    if (Date.now() - started > budget) { results.push({ id: job.id, label: job.label, skipped: "reportée à l'appel suivant (temps écoulé)", ms: 0 }); continue; }
    // Réservation atomique de la tâche pour la période.
    const prev = await CronRunModel.findOne({ jobId: job.id, period }).lean<{ status: string; attempts: number; startedAt?: Date } | null>();
    if (!opts.force && prev) {
      if (prev.status === "done") { results.push({ id: job.id, label: job.label, skipped: "déjà faite", ms: 0 }); continue; }
      if (prev.status === "running" && prev.startedAt && Date.now() - new Date(prev.startedAt).getTime() < STALE_RUN_MS) { results.push({ id: job.id, label: job.label, skipped: "en cours", ms: 0 }); continue; }
      if (prev.attempts >= MAX_ATTEMPTS) { results.push({ id: job.id, label: job.label, skipped: `abandonnée après ${prev.attempts} tentatives`, ms: 0 }); continue; }
    }
    const claim = await CronRunModel.findOneAndUpdate(
      { jobId: job.id, period, ...(opts.force || !prev ? {} : { status: prev.status, attempts: prev.attempts }) },
      { $set: { status: "running", startedAt: new Date() }, $inc: { attempts: 1 }, $setOnInsert: { jobId: job.id, period } },
      { upsert: !prev || opts.force, new: true },
    ).catch(() => null);
    if (!claim) { results.push({ id: job.id, label: job.label, skipped: "prise par un autre appel", ms: 0 }); continue; }
    const t0 = Date.now();
    try {
      const summary = await job.run();
      await CronRunModel.updateOne({ jobId: job.id, period }, { $set: { status: "done", finishedAt: new Date(), summary: summary.slice(0, 1000) }, $unset: { error: 1 } });
      results.push({ id: job.id, label: job.label, summary, ms: Date.now() - t0 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await CronRunModel.updateOne({ jobId: job.id, period }, { $set: { status: "failed", finishedAt: new Date(), error: error.slice(0, 1000) } });
      results.push({ id: job.id, label: job.label, error, ms: Date.now() - t0 });
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
