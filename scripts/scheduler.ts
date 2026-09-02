/**
 * Scheduler Kanoo — Tâches planifiées (cron)
 *
 * Les expressions cron sont interprétées dans le fuseau `Africa/Niamey`
 * (UTC+1) : les heures écrites ci-dessous sont donc des heures locales, pas des
 * heures UTC. Les commentaires d'origine annonçaient une heure de plus que
 * l'expression — ils décrivaient l'heure locale d'une expression qu'ils
 * croyaient en UTC.
 *
 * Usage: npm run scheduler
 */
import cron from "node-cron";
import mongoose from "mongoose";
import { config } from "dotenv";
import { NotificationModel } from "../models/Notification";
import { UserModel } from "../models/User";
import { InvoiceModel } from "../models/Invoice";
import { ProductModel } from "../models/Product";
import { ContractModel } from "../models/Contract";
import { EmployeeModel } from "../models/Employee";
import { RecurringExpenseModel } from "../models/RecurringExpense";
import { TenantModel } from "../models/Tenant";
import { CRMOpportunityModel } from "../models/CRMOpportunity";
import { SubscriptionPurchaseModel } from "../models/SubscriptionPurchase";
import { SubscriptionSaleModel } from "../models/SubscriptionSale";
import { buildAlerts, type PurchaseLike, type SaleLike } from "../lib/subscriptions";
import { resetYearlySequences } from "../lib/numbering";

config({ path: ".env.local" });
config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI absent — le scheduler ne peut pas démarrer.");
  process.exit(1);
}

const TZ = { timezone: "Africa/Niamey" } as const;

/** Identifiant Mongo, sous la forme rendue par `.lean()`. */
type Id = mongoose.Types.ObjectId;

async function connectDB() {
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI!);
}

async function notify(
  tenantId: Id, userId: Id, type: string, title: string, message: string,
  linkedTo?: string, linkedId?: Id
) {
  await NotificationModel.create({ tenantId, userId, type, title, message, linkedTo, linkedId })
    .catch((err: unknown) => console.error("[Scheduler] notification non créée:", err));
}

async function getAdmins(tenantId: Id, roles: string[]): Promise<Array<{ _id: Id }>> {
  return UserModel.find({ tenantId, role: { $in: roles }, isActive: true })
    .select("_id")
    .lean<Array<{ _id: Id }>>();
}

/** Enveloppe commune : connexion, capture d'erreur, compte-rendu. */
function job(label: string, run: () => Promise<string>) {
  return async () => {
    try {
      await connectDB();
      const summary = await run();
      console.log(`[Scheduler] ${label} — ${summary}`);
    } catch (err) {
      console.error(`[Scheduler] ${label} :`, err);
    }
  };
}

// ─── 06:30 — Factures en retard ──────────────────────────────────────────────
cron.schedule("30 6 * * *", job("Factures en retard", async () => {
  const overdue = await InvoiceModel.find({
    status: { $in: ["sent", "partial"] },
    dueDate: { $lt: new Date() },
  }).lean<Array<{ _id: Id; tenantId: Id; number: string; totalTTC: number }>>();

  for (const inv of overdue) {
    const admins = await getAdmins(inv.tenantId, ["pme_admin", "pme_accountant", "pme_manager"]);
    for (const admin of admins) {
      await notify(
        inv.tenantId, admin._id, "invoice_overdue", "Facture en retard",
        `Facture ${inv.number} — ${inv.totalTTC.toLocaleString("fr-FR")} XOF échue`,
        "invoices", inv._id
      );
    }
  }
  return `${overdue.length} facture(s) traitée(s)`;
}), TZ);

// ─── 07:00 — Alertes stock minimum ───────────────────────────────────────────
cron.schedule("0 7 * * *", job("Alertes stock", async () => {
  const products = await ProductModel.find({
    isActive: true,
    $expr: { $lte: ["$stockQty", "$stockMinAlert"] },
  }).lean<Array<{
    _id: Id; tenantId: Id; label: string; stockQty: number; unit: string; stockMinAlert: number;
  }>>();

  for (const product of products) {
    const admins = await getAdmins(product.tenantId, ["pme_admin", "pme_purchases", "pme_manager"]);
    for (const admin of admins) {
      await notify(
        product.tenantId, admin._id, "stock_alert", "Alerte stock",
        `Stock faible : ${product.label} — ${product.stockQty} ${product.unit} (seuil : ${product.stockMinAlert})`,
        "stock", product._id
      );
    }
  }
  return `${products.length} alerte(s) envoyée(s)`;
}), TZ);

// ─── 07:30 — Contrats expirant sous 30 jours ─────────────────────────────────
cron.schedule("30 7 * * *", job("Contrats expirant", async () => {
  const limit = new Date(Date.now() + 30 * 86400000);
  const expiring = await ContractModel.find({
    status: "active",
    endDate: { $lte: limit, $gte: new Date() },
  }).lean<Array<{ _id: Id; tenantId: Id; title: string; endDate: Date }>>();

  for (const contract of expiring) {
    const admins = await getAdmins(contract.tenantId, ["pme_admin", "pme_manager", "admin_ordonnateur"]);
    const daysLeft = Math.ceil((contract.endDate.getTime() - Date.now()) / 86400000);
    for (const admin of admins) {
      await notify(
        contract.tenantId, admin._id, "contract_expiry", "Contrat expirant bientôt",
        `Contrat "${contract.title}" expire dans ${daysLeft} jours (${contract.endDate.toLocaleDateString("fr-FR")})`,
        "contracts", contract._id
      );
    }
  }
  return `${expiring.length} contrat(s) notifié(s)`;
}), TZ);

// ─── 08:00 — Fins de contrat employé sous 30 jours ───────────────────────────
cron.schedule("0 8 * * *", job("Fins de contrat employé", async () => {
  const limit = new Date(Date.now() + 30 * 86400000);
  const expiring = await EmployeeModel.find({
    isActive: true,
    contractEndDate: { $lte: limit, $gte: new Date() },
  }).lean<Array<{ _id: Id; tenantId: Id; firstName: string; lastName: string; contractEndDate: Date }>>();

  for (const emp of expiring) {
    const admins = await getAdmins(emp.tenantId, ["pme_admin", "pme_hr"]);
    const daysLeft = Math.ceil((emp.contractEndDate.getTime() - Date.now()) / 86400000);
    for (const admin of admins) {
      await notify(
        emp.tenantId, admin._id, "employee_contract_expiry", "Fin de contrat imminente",
        `Contrat de ${emp.firstName} ${emp.lastName} expire dans ${daysLeft} jours`,
        "employees", emp._id
      );
    }
  }
  return `${expiring.length} fin(s) de contrat notifiée(s)`;
}), TZ);

// ─── 08:30 — Dépenses récurrentes échues ─────────────────────────────────────
cron.schedule("30 8 * * *", job("Dépenses récurrentes", async () => {
  const due = await RecurringExpenseModel.find({
    isActive: true,
    nextDueDate: { $lte: new Date() },
  }).lean<Array<{ _id: Id; tenantId: Id; label: string; amount: number }>>();

  for (const expense of due) {
    const admins = await getAdmins(expense.tenantId, ["pme_admin", "pme_accountant"]);
    for (const admin of admins) {
      await notify(
        expense.tenantId, admin._id, "expense_due", "Dépense récurrente à payer",
        `${expense.label} — ${expense.amount.toLocaleString("fr-FR")} XOF`,
        "recurring-expenses", expense._id
      );
    }
  }
  return `${due.length} dépense(s) notifiée(s)`;
}), TZ);

// ─── 09:00 — Relances CRM dues ───────────────────────────────────────────────
cron.schedule("0 9 * * *", job("Relances CRM", async () => {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const due = await CRMOpportunityModel.find({
    nextFollowUpDate: { $lt: tomorrow },
    stage: { $nin: ["won", "lost"] },
  }).lean<Array<{ _id: Id; tenantId: Id; title: string }>>();

  for (const opp of due) {
    // UserModel était utilisé ici sans être importé : le job levait
    // « UserModel is not defined » à chaque exécution.
    const admins = await getAdmins(opp.tenantId, ["pme_admin", "pme_manager"]);
    for (const admin of admins) {
      await notify(
        opp.tenantId, admin._id, "crm_followup", "Relance CRM",
        `Opportunité "${opp.title}" — relance due`,
        "crm", opp._id
      );
    }
  }
  return `${due.length} relance(s) notifiée(s)`;
}), TZ);

// ─── 09:30 — Échéances et écarts du portefeuille d'abonnements ───────────────
cron.schedule("30 9 * * *", job("Abonnements", async () => {
  // Les alertes sont recalculées par le même moteur que l'écran : une seule
  // définition de « contrat à renouveler » ou de « licences sur-vendues ».
  const [purchases, sales] = await Promise.all([
    SubscriptionPurchaseModel.find({ status: { $ne: "cancelled" } })
      .lean<Array<PurchaseLike & { tenantId: Id }>>(),
    SubscriptionSaleModel.find({ status: { $nin: ["cancelled", "draft"] } })
      .lean<Array<SaleLike & { tenantId: Id }>>(),
  ]);

  // Un tenant ne doit jamais recevoir l'alerte d'un autre : on segmente avant
  // de calculer, plutôt que de filtrer après.
  const tenants = new Set<string>([
    ...purchases.map(p => String(p.tenantId)),
    ...sales.map(s => String(s.tenantId)),
  ]);

  let sent = 0;
  for (const tenantId of tenants) {
    const scopedPurchases = purchases.filter(p => String(p.tenantId) === tenantId);
    const scopedSales = sales.filter(s => String(s.tenantId) === tenantId);

    // Seules les alertes qui appellent une décision partent en notification ;
    // les informatives restent consultables sur l'écran.
    const actionable = buildAlerts(scopedPurchases, scopedSales)
      .filter(a => a.level !== "info");
    if (actionable.length === 0) continue;

    const tenantObjectId = scopedPurchases[0]?.tenantId ?? scopedSales[0]?.tenantId;
    const admins = await getAdmins(tenantObjectId, ["pme_admin", "pme_manager", "pme_accountant"]);

    for (const admin of admins) {
      for (const alert of actionable.slice(0, 10)) {
        await notify(
          tenantObjectId, admin._id, "subscription_alert",
          alert.level === "critical" ? "Abonnement — action requise" : "Abonnement — échéance proche",
          alert.message, "abonnements"
        );
        sent++;
      }
    }
  }
  return `${sent} notification(s) pour ${tenants.size} organisation(s)`;
}), TZ);

// ─── 1er du mois, 01:00 — Rappels TVA et purge des jetons expirés ────────────
cron.schedule("0 1 1 * *", job("Rappels TVA et purge", async () => {
  const now = new Date();
  const tenants = await TenantModel.find({
    subscriptionStatus: { $in: ["active", "trial"] },
    type: { $in: ["pme", "administration"] },
  }).select("_id").lean<Array<{ _id: Id }>>();

  for (const tenant of tenants) {
    const admins = await getAdmins(tenant._id, ["pme_admin", "pme_accountant", "admin_daf"]);
    for (const admin of admins) {
      await notify(
        tenant._id, admin._id, "fiscal_reminder", "Rappel TVA",
        `Déclaration TVA ${now.getMonth() + 1}/${now.getFullYear()} à déposer avant le 20/${now.getMonth() + 1}/${now.getFullYear()}`,
        "fiscalite"
      );
    }
  }

  await TenantModel.updateMany(
    { activationTokenExpiry: { $lt: now } },
    { $unset: { activationToken: "", activationTokenExpiry: "" } }
  );
  await UserModel.updateMany(
    { passwordResetExpiry: { $lt: now } },
    { $unset: { passwordResetToken: "", passwordResetExpiry: "" } }
  );

  return `${tenants.length} organisation(s) relancée(s), jetons expirés purgés`;
}), TZ);

// ─── 06:00 — Contrats récurrents à facturer ──────────────────────────────────
cron.schedule("0 6 * * *", job("Contrats récurrents", async () => {
  const due = await ContractModel.find({
    isRecurring: true, autoGenerateInvoice: true, status: "active",
    nextBillingDate: { $lte: new Date() },
  }).select("_id").lean<Array<{ _id: Id }>>();

  // La génération elle-même passe par l'API (/api/contracts/:id/generate-invoice)
  // pour que la facture porte un auteur et une entrée d'audit. Ce job ne fait
  // que signaler le travail à faire.
  return `${due.length} contrat(s) à facturer`;
}), TZ);

// ─── 1er janvier, 00:01 — Remise à zéro des séquences ────────────────────────
cron.schedule("1 0 1 1 *", job("Remise à zéro de la numérotation", async () => {
  const count = await resetYearlySequences();
  return `${count} organisation(s) réinitialisée(s)`;
}), TZ);

console.log("⏰ Scheduler Kanoo démarré (heures locales Niamey, UTC+1)");
console.log("   06:00 — Contrats récurrents à facturer");
console.log("   06:30 — Factures en retard");
console.log("   07:00 — Alertes stock minimum");
console.log("   07:30 — Contrats expirant bientôt");
console.log("   08:00 — Fins de contrat employé");
console.log("   08:30 — Dépenses récurrentes échues");
console.log("   09:00 — Relances CRM");
console.log("   09:30 — Échéances des abonnements");
console.log("   1er du mois 01:00 — Rappels TVA et purge des jetons");
console.log("   1er janvier 00:01 — Remise à zéro de la numérotation");
