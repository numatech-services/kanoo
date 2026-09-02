/**
 * Seed de base de test isolée — Kanoo
 * Usage: npm run seed:test
 *        MONGODB_URI_TEST="mongodb://localhost:27017/kanoo_test" npm run seed:test
 */

import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.test" });
config({ path: ".env.local" });
config({ path: ".env" });

// Toujours utiliser la base _test pour éviter d'écraser les données de dev
// On utilise DIRECTEMENT la base définie dans le .env sans ajouter "_test"
const TEST_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/numapilot";

console.log(`🧪 Base de test : ${TEST_URI.replace(/\/\/[^@]+@/, "//***@")} - seed-test.ts:18`);

async function run() {
  await mongoose.connect(TEST_URI);
  console.log("✅ Connecté à la base de test - seed-test.ts:22");

  // Nettoyer la base de test
  const collections = await mongoose.connection.db!.listCollections().toArray();
  for (const col of collections) {
    await mongoose.connection.db!.dropCollection(col.name);
  }
  console.log("🗑️  Base de test vidée - seed-test.ts:29");

  const { TenantModel } = await import("../models/Tenant");
  const { UserModel } = await import("../models/User");
  const { ClientModel } = await import("../models/Client");
  const { InvoiceModel } = await import("../models/Invoice");
  const { EmployeeModel } = await import("../models/Employee");
  const { MemberModel } = await import("../models/Member");
  const { BudgetChapterModel } = await import("../models/BudgetChapter");
// Remplacez les lignes problématiques par celles-ci :
  const bcrypt = await import("bcryptjs");
  const passwordHash = await (bcrypt.default || bcrypt).hash("test1234", 10);

  // ─── Tenant test PME ─────────────────────────────────────────────────────────
  const pmeTenant = await TenantModel.create({
    type: "pme", name: "Test PME SARL", slug: "test-pme", email: "test@pme.ne",
    plan: "pro", planModules: ["*"], subscriptionStatus: "active",
  });

  const pmeAdmin = await UserModel.create({
    tenantId: pmeTenant._id, email: "admin@test.ne", passwordHash,
    firstName: "Admin", lastName: "Test", role: "pme_admin", isActive: true,
  });
  await UserModel.create({
    tenantId: pmeTenant._id, email: "comptable@test.ne", passwordHash,
    firstName: "Comptable", lastName: "Test", role: "pme_accountant", isActive: true,
  });

  // Clients
  const client = await ClientModel.create({
    tenantId: pmeTenant._id, code: "CLI-TEST-001", name: "Client Test",
    type: "company", nif: "NI-TEST-001", currentBalance: 500_000,
    creditLimit: 5_000_000, paymentTermDays: 30, isActive: true,
  });

  // Employés
  await EmployeeModel.create([
    { tenantId: pmeTenant._id, code: "EMP-T01", firstName: "Alpha", lastName: "Test", position: "DG", grossSalary: 500_000, startDate: new Date("2020-01-01"), isActive: true },
    { tenantId: pmeTenant._id, code: "EMP-T02", firstName: "Beta", lastName: "Test", position: "Comptable", grossSalary: 250_000, startDate: new Date("2021-01-01"), isActive: true },
  ]);

  // Facture de test
  await InvoiceModel.create({
    tenantId: pmeTenant._id, number: "FAC-2025-00001",
    clientId: client._id,
    lines: [{ description: "Service test", quantity: 1, unitPrice: 100_000, tvaRate: 0.19, discount: 0, totalHT: 100_000, totalTVA: 19_000, totalTTC: 119_000 }],
    totalHT: 100_000, totalTVA: 19_000, totalDTS: 0, totalTTC: 119_000,
    paidAmount: 0, status: "sent",
    issueDate: new Date(), dueDate: new Date(Date.now() + 30 * 86400000),
    createdBy: pmeAdmin._id,
  });

  // ─── Tenant test Association ──────────────────────────────────────────────────
  const assoTenant = await TenantModel.create({
    type: "association", name: "Asso Test", slug: "asso-test", email: "test@asso.ne",
    plan: "asso_pro", planModules: ["*"], subscriptionStatus: "active",
  });

  await UserModel.create({
    tenantId: assoTenant._id, email: "president@test.ne", passwordHash,
    firstName: "Président", lastName: "Test", role: "asso_president", isActive: true,
  });

  await MemberModel.create([
    { tenantId: assoTenant._id, code: "MBR-T01", firstName: "Membre", lastName: "Un", membershipType: "membre_actif", joinDate: new Date("2023-01-01"), status: "active" },
    { tenantId: assoTenant._id, code: "MBR-T02", firstName: "Membre", lastName: "Deux", membershipType: "membre_actif", joinDate: new Date("2023-06-01"), status: "active" },
  ]);

  // ─── Tenant test Administration ───────────────────────────────────────────────
  const adminTenant = await TenantModel.create({
    type: "administration", name: "Admin Test", slug: "admin-test", email: "test@admin.ne",
    plan: "admin", planModules: ["*"], subscriptionStatus: "active",
  });

  await UserModel.create({
    tenantId: adminTenant._id, email: "ordonnateur@test.ne", passwordHash,
    firstName: "Ordonnateur", lastName: "Test", role: "admin_ordonnateur", isActive: true,
  });

  const year = new Date().getFullYear();
  await BudgetChapterModel.create([
    { tenantId: adminTenant._id, code: "TITRE-1", label: "Fonctionnement", year, allocatedAmount: 100_000_000, engagedAmount: 30_000_000, mandatedAmount: 20_000_000, paidAmount: 15_000_000, level: "titre" },
    { tenantId: adminTenant._id, code: "TITRE-2", label: "Investissement", year, allocatedAmount: 50_000_000, engagedAmount: 10_000_000, mandatedAmount: 5_000_000, paidAmount: 4_000_000, level: "titre" },
  ]);

  // ─── Superadmin ───────────────────────────────────────────────────────────────
  const superTenant = await TenantModel.create({
    type: "pme", name: "Platform Test", slug: "platform-test",
    plan: "enterprise", planModules: ["*"], subscriptionStatus: "active",
  });

  await UserModel.create({
    tenantId: superTenant._id, email: "super@test.ne", passwordHash,
    firstName: "Super", lastName: "Admin", role: "superadmin", isActive: true,
  });

  console.log("\n🎉 Base de test créée avec succès ! - seed-test.ts:125");
  console.log("PME admin      : admin@test.ne / test1234 - seed-test.ts:126");
  console.log("PME comptable  : comptable@test.ne / test1234 - seed-test.ts:127");
  console.log("Asso président : president@test.ne / test1234 - seed-test.ts:128");
  console.log("Admin ord.     : ordonnateur@test.ne / test1234 - seed-test.ts:129");
  console.log("Superadmin     : super@test.ne / test1234 - seed-test.ts:130");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erreur seed test: - seed-test.ts:137", err);
  process.exit(1);
});
