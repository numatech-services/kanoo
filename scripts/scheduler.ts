/**
 * Scheduler Kanoo — Tâches planifiées (cron)
 * Fuseau horaire : Niamey (UTC+1)
 * Usage: npm run scheduler
 */
import cron from "node-cron";
import mongoose from "mongoose";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI!;

async function connectDB() {
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI);
}

async function notify(tenantId: unknown, userId: unknown, type: string, title: string, message: string, linkedTo?: string, linkedId?: unknown) {
  const { NotificationModel } = await import("../models/Notification");
  await NotificationModel.create({ tenantId, userId, type, title, message, linkedTo, linkedId }).catch(() => {});
}

async function getAdmins(tenantId: unknown, roles: string[]) {
  const { UserModel } = await import("../models/User");
  return UserModel.find({ tenantId, role: { $in: roles }, isActive: true }).lean();
}

// ─── Job 1 : Factures en retard (07:30 Niamey) ───────────────────────────────
cron.schedule("30 6 * * *", async () => {
  try {
    await connectDB();
    const { InvoiceModel } = await import("../models/Invoice");
    const overdueInvoices = await InvoiceModel.find({ status: { $in: ["sent","partial"] }, dueDate: { $lt: new Date() } }).lean();
    for (const inv of overdueInvoices) {
      const admins = await getAdmins(inv.tenantId, ["pme_admin","pme_accountant","pme_manager"]);
      for (const admin of admins) {
        await notify(inv.tenantId, admin._id, "invoice_overdue", "Facture en retard", `Facture ${(inv as {number:string}).number} — ${(inv as {totalTTC:number}).totalTTC.toLocaleString("fr-FR")} XOF échue`, "invoices", inv._id);
      }
    }
    console.log(`[Scheduler] ${overdueInvoices.length} factures en retard traitées`);
  } catch (err) { console.error("[Scheduler] Factures:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 2 : Alertes stock minimum (08:00 Niamey) ────────────────────────────
cron.schedule("0 7 * * *", async () => {
  try {
    await connectDB();
    const { ProductModel } = await import("../models/Product");
    const alertProducts = await ProductModel.find({
      isActive: true, $expr: { $lte: ["$stockQty", "$stockMinAlert"] }
    }).lean();
    for (const product of alertProducts) {
      const admins = await getAdmins((product as {tenantId:unknown}).tenantId, ["pme_admin","pme_purchases","pme_manager"]);
      for (const admin of admins) {
        await notify((product as {tenantId:unknown}).tenantId, admin._id, "stock_alert", "Alerte stock",
          `Stock faible : ${(product as {label:string}).label} — ${(product as {stockQty:number}).stockQty} ${(product as {unit:string}).unit} (seuil : ${(product as {stockMinAlert:number}).stockMinAlert})`,
          "stock", (product as {_id:unknown})._id);
      }
    }
    console.log(`[Scheduler] ${alertProducts.length} alertes stock envoyées`);
  } catch (err) { console.error("[Scheduler] Stock:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 3 : Contrats expirant dans 30 jours (08:30 Niamey) ─────────────────
cron.schedule("30 7 * * *", async () => {
  try {
    await connectDB();
    const { ContractModel } = await import("../models/Contract");
    const limit = new Date(Date.now() + 30 * 86400000);
    const expiring = await ContractModel.find({ status: "active", endDate: { $lte: limit, $gte: new Date() } }).lean();
    for (const contract of expiring) {
      const admins = await getAdmins((contract as {tenantId:unknown}).tenantId, ["pme_admin","pme_manager","admin_ordonnateur"]);
      const daysLeft = Math.ceil(((contract as {endDate:Date}).endDate.getTime() - Date.now()) / 86400000);
      for (const admin of admins) {
        await notify((contract as {tenantId:unknown}).tenantId, admin._id, "contract_expiry", "Contrat expirant bientôt",
          `Contrat "${(contract as {title:string}).title}" expire dans ${daysLeft} jours (${new Date((contract as {endDate:Date}).endDate).toLocaleDateString("fr-FR")})`,
          "contracts", (contract as {_id:unknown})._id);
      }
    }
    console.log(`[Scheduler] ${expiring.length} contrats expirant bientôt notifiés`);
  } catch (err) { console.error("[Scheduler] Contrats:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 4 : Fins de contrat employé dans 30 jours (09:00 Niamey) ────────────
cron.schedule("0 8 * * *", async () => {
  try {
    await connectDB();
    const { EmployeeModel } = await import("../models/Employee");
    const limit = new Date(Date.now() + 30 * 86400000);
    const expiring = await EmployeeModel.find({ isActive: true, contractEndDate: { $lte: limit, $gte: new Date() } }).lean();
    for (const emp of expiring) {
      const admins = await getAdmins((emp as {tenantId:unknown}).tenantId, ["pme_admin","pme_hr"]);
      const daysLeft = Math.ceil(((emp as {contractEndDate:Date}).contractEndDate!.getTime() - Date.now()) / 86400000);
      for (const admin of admins) {
        await notify((emp as {tenantId:unknown}).tenantId, admin._id, "employee_contract_expiry", "Fin de contrat imminente",
          `Contrat de ${(emp as {firstName:string}).firstName} ${(emp as {lastName:string}).lastName} expire dans ${daysLeft} jours`,
          "employees", (emp as {_id:unknown})._id);
      }
    }
    console.log(`[Scheduler] ${expiring.length} fins de contrat employé notifiées`);
  } catch (err) { console.error("[Scheduler] Employés:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 5 : Dépenses récurrentes dues aujourd'hui (09:30 Niamey) ────────────
cron.schedule("30 8 * * *", async () => {
  try {
    await connectDB();
    const { RecurringExpenseModel } = await import("../models/RecurringExpense");
    const dueTodayOrLate = await RecurringExpenseModel.find({ isActive: true, nextDueDate: { $lte: new Date() } }).lean();
    for (const expense of dueTodayOrLate) {
      const admins = await getAdmins((expense as {tenantId:unknown}).tenantId, ["pme_admin","pme_accountant"]);
      for (const admin of admins) {
        await notify((expense as {tenantId:unknown}).tenantId, admin._id, "expense_due", "Dépense récurrente à payer",
          `${(expense as {label:string}).label} — ${(expense as {amount:number}).amount.toLocaleString("fr-FR")} XOF`,
          "recurring-expenses", (expense as {_id:unknown})._id);
      }
    }
    console.log(`[Scheduler] ${dueTodayOrLate.length} dépenses dues notifiées`);
  } catch (err) { console.error("[Scheduler] Dépenses:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 6 : Alertes TVA + Nettoyage tokens (01:00 Niamey) ──────────────────
cron.schedule("0 1 1 * *", async () => {
  try {
    await connectDB();
    const { TenantModel } = await import("../models/Tenant");
    const { UserModel } = await import("../models/User");
    const now = new Date();
    const activeTenants = await TenantModel.find({ subscriptionStatus: { $in: ["active","trial"] }, type: { $in: ["pme","administration"] } }).lean();
    for (const tenant of activeTenants) {
      const admins = await UserModel.find({ tenantId: tenant._id, role: { $in: ["pme_admin","pme_accountant","admin_daf"] }, isActive: true }).lean();
      for (const admin of admins) {
        await notify(tenant._id, admin._id, "fiscal_reminder", "Rappel TVA", `Déclaration TVA ${now.getMonth()+1}/${now.getFullYear()} à déposer avant le 20/${now.getMonth()+1}/${now.getFullYear()}`, "fiscalite");
      }
    }
    // Nettoyage tokens expirés
    await TenantModel.updateMany({ activationTokenExpiry: { $lt: new Date() } }, { $unset: { activationToken: "", activationTokenExpiry: "" } });
    await UserModel.updateMany({ passwordResetExpiry: { $lt: new Date() } }, { $unset: { passwordResetToken: "", passwordResetExpiry: "" } });
    console.log("[Scheduler] Rappels TVA + nettoyage OK");
  } catch (err) { console.error("[Scheduler] TVA:", err); }
}, { timezone: "Africa/Niamey" });

// ─── Job 7 : Génération auto factures contrats récurrents (07:00 Niamey) ─────
cron.schedule("0 6 * * *", async () => {
  try {
    await connectDB();
    const { ContractModel } = await import("../models/Contract");
    const dueContracts = await ContractModel.find({
      isRecurring: true, autoGenerateInvoice: true, status: "active",
      nextBillingDate: { $lte: new Date() },
    }).lean();
    console.log(`[Scheduler] ${dueContracts.length} contrats récurrents à facturer`);
    // La génération effective est déclenchée via API pour traçabilité complète
    // En production : appeler fetch(`/api/contracts/${id}/generate-invoice`, { method: "POST" })
  } catch (err) { console.error("[Scheduler] Contrats récurrents:", err); }
}, { timezone: "Africa/Niamey" });

console.log("⏰ Scheduler Kanoo démarré (Niamey UTC+1)");
console.log("   06:00 — Génération factures contrats récurrents");
console.log("   06:30 — Alertes factures en retard");
console.log("   07:00 — Alertes stock minimum");
console.log("   07:30 — Contrats expirant bientôt");
console.log("   08:00 — Fins de contrat employés");
console.log("   08:30 — Dépenses récurrentes dues");
console.log("   01er du mois 02:00 — Rappels TVA + nettoyage tokens");

cron.schedule("0 9 * * *", async () => {
  try {
    await connectDB();
    const { CRMOpportunityModel } = await import("../models/CRMOpportunity");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dueRelances = await CRMOpportunityModel.find({
      nextFollowUpDate: { $lt: tomorrow },
      stage: { $nin: ["won", "lost"] },
    }).lean();

    for (const opp of dueRelances) {
      const admin = await UserModel.findOne({ tenantId: opp.tenantId, role: { $in: ["admin", "pme_admin", "pme_manager"] } });
      if (!admin) continue;
      await notify(
        opp.tenantId, admin._id,
        "crm_followup",
        "Relance CRM",
        `Opportunité "${(opp as {title:string}).title}" — relance due`,
        "crm",
        opp._id
      );
    }
    console.log(`[Scheduler] ${dueRelances.length} relances CRM notifiées`);
  } catch (err) { console.error("[Scheduler] CRM relances:", err); }
}, { timezone: "Africa/Niamey" });


// ─── Job 8 : Reset numérotation annuelle (1er janvier 00:01 Niamey) ──────────
cron.schedule("1 0 1 1 *", async () => {
  try {
    const { resetYearlySequences } = await import("../lib/numbering");
    const count = await resetYearlySequences();
    console.log(`[Scheduler] Reset numérotation annuelle — ${count} tenant(s) réinitialisés`);
  } catch (err) { console.error("[Scheduler] Reset numérotation:", err); }
}, { timezone: "Africa/Niamey" });
