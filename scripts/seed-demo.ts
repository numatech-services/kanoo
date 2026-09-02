/**
 * Seed de démonstration — 3 tenants (PME, Association, Administration)
 * Usage: npm run seed:demo
 *        SEED_RESET=true npm run seed:demo
 */

import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) throw new Error("MONGODB_URI manquant");

// Import dynamique des modèles pour éviter les problèmes de registre Mongoose
async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connecté à MongoDB - seed-demo.ts:19");

  if (process.env.SEED_RESET === "true") {
    const collections = await mongoose.connection.db!.listCollections().toArray();
    for (const col of collections) {
      await mongoose.connection.db!.dropCollection(col.name);
    }
    console.log("🗑️  Base réinitialisée - seed-demo.ts:26");
  }

  // Import des modèles
  const { TenantModel } = await import("../models/Tenant");
  const { UserModel } = await import("../models/User");
  const { ClientModel } = await import("../models/Client");
  const { SupplierModel } = await import("../models/Supplier");
  const { InvoiceModel } = await import("../models/Invoice");
  const { EmployeeModel } = await import("../models/Employee");
  const { MemberModel } = await import("../models/Member");
  const { BudgetChapterModel } = await import("../models/BudgetChapter");

  // Remplacez ces deux lignes :
  const bcrypt = await import("bcryptjs");
  const passwordHash = await (bcrypt.default || bcrypt).hash("demo1234", 12);
  // ─── Tenant 1 : PME ──────────────────────────────────────────────────────────

  const pmeTenant = await TenantModel.create({
    type: "pme",
    name: "Numalex Demo SARL",
    slug: "numalex-demo",
    nif: "NI-2024-001",
    rccm: "NI-NIA-2020-B-1234",
    email: "contact@numalex.ne",
    phone: "+227 20 00 00 01",
    address: "Avenue de l'Indépendance, Niamey, Niger",
    plan: "pro",
    planModules: ["*"],
    subscriptionStatus: "active",
    activatedAt: new Date(),
  });

  // Utilisateurs PME
  const pmeUsers = await UserModel.insertMany([
    { tenantId: pmeTenant._id, email: "admin@demo.ne", passwordHash, firstName: "Moussa", lastName: "Diallo", role: "pme_admin", isActive: true },
    { tenantId: pmeTenant._id, email: "comptable@demo.ne", passwordHash, firstName: "Aminata", lastName: "Koné", role: "pme_accountant", isActive: true },
    { tenantId: pmeTenant._id, email: "chef@demo.ne", passwordHash, firstName: "Ibrahim", lastName: "Maïga", role: "pme_project_manager", isActive: true },
    { tenantId: pmeTenant._id, email: "employe@demo.ne", passwordHash, firstName: "Fatoumata", lastName: "Traoré", role: "pme_viewer", isActive: true },
    { tenantId: pmeTenant._id, email: "commercial@demo.ne", passwordHash, firstName: "Ousmane", lastName: "Barry", role: "pme_sales", isActive: true },
  ]);

  // Clients PME
  await ClientModel.insertMany([
    { tenantId: pmeTenant._id, code: "CLI-001", name: "Ministère de l'Éducation", type: "company", nif: "NI-MENAT-001", phone: "+227 20 72 41 50", address: "Niamey", creditLimit: 50_000_000, currentBalance: 12_500_000, paymentTermDays: 60, isActive: true },
    { tenantId: pmeTenant._id, code: "CLI-002", name: "Société Nigelec", type: "company", nif: "NI-NIGELEC-001", phone: "+227 20 72 21 06", address: "Niamey", creditLimit: 20_000_000, currentBalance: 3_200_000, paymentTermDays: 30, isActive: true },
    { tenantId: pmeTenant._id, code: "CLI-003", name: "Mairie de Niamey", type: "company", nif: "NI-MAIRIE-001", phone: "+227 20 73 33 33", address: "Niamey", creditLimit: 30_000_000, currentBalance: 0, paymentTermDays: 45, isActive: true },
    { tenantId: pmeTenant._id, code: "CLI-004", name: "Modibo Keïta", type: "individual", phone: "+227 96 10 20 30", address: "Niamey", creditLimit: 1_000_000, currentBalance: 150_000, paymentTermDays: 15, isActive: true },
    { tenantId: pmeTenant._id, code: "CLI-005", name: "SONIDEP", type: "company", nif: "NI-SONIDEP-001", phone: "+227 20 73 20 00", address: "Niamey", creditLimit: 100_000_000, currentBalance: 0, paymentTermDays: 60, isActive: true },
  ]);

  // Fournisseurs PME
  await SupplierModel.insertMany([
    { tenantId: pmeTenant._id, code: "FRN-001", name: "Bureau Plus Niamey", nif: "NI-BPN-001", phone: "+227 20 73 45 67", paymentTermDays: 30, isActive: true },
    { tenantId: pmeTenant._id, code: "FRN-002", name: "Sahel Informatique", nif: "NI-SI-001", phone: "+227 96 20 30 40", paymentTermDays: 15, isActive: true },
    { tenantId: pmeTenant._id, code: "FRN-003", name: "Imprimerie Nationale Niger", nif: "NI-INN-001", phone: "+227 20 73 11 22", paymentTermDays: 45, isActive: true },
  ]);

  // Employés PME
  await EmployeeModel.insertMany([
    { tenantId: pmeTenant._id, code: "EMP-001", firstName: "Moussa", lastName: "Diallo", position: "Directeur Général", department: "Direction", grossSalary: 800_000, startDate: new Date("2020-01-01"), cnssNumber: "NI-CNSS-001", isActive: true },
    { tenantId: pmeTenant._id, code: "EMP-002", firstName: "Aminata", lastName: "Koné", position: "Comptable", department: "Finance", grossSalary: 350_000, startDate: new Date("2021-03-15"), cnssNumber: "NI-CNSS-002", isActive: true },
    { tenantId: pmeTenant._id, code: "EMP-003", firstName: "Ibrahim", lastName: "Maïga", position: "Chef de Projet", department: "Opérations", grossSalary: 450_000, startDate: new Date("2021-06-01"), cnssNumber: "NI-CNSS-003", isActive: true },
    { tenantId: pmeTenant._id, code: "EMP-004", firstName: "Fatoumata", lastName: "Traoré", position: "Assistante", department: "Administration", grossSalary: 200_000, startDate: new Date("2022-01-15"), isActive: true },
  ]);

  console.log("✅ Tenant PME créé : - seed-demo.ts:92", pmeTenant.name);

  // ─── Tenant 2 : Association ───────────────────────────────────────────────────

  const assoTenant = await TenantModel.create({
    type: "association",
    name: "ONG Sahel Solidarité",
    slug: "ong-sahel-solidarite",
    email: "contact@sahel-solidarite.ne",
    phone: "+227 20 00 00 02",
    address: "Rue des ONG, Niamey, Niger",
    plan: "asso_pro",
    planModules: ["*"],
    subscriptionStatus: "active",
    activatedAt: new Date(),
  });

  await UserModel.insertMany([
    { tenantId: assoTenant._id, email: "president@asso.ne", passwordHash, firstName: "Aïssa", lastName: "Hamidou", role: "asso_president", isActive: true },
    { tenantId: assoTenant._id, email: "tresorier@asso.ne", passwordHash, firstName: "Sani", lastName: "Boubacar", role: "asso_treasurer", isActive: true },
    { tenantId: assoTenant._id, email: "secretaire@asso.ne", passwordHash, firstName: "Zara", lastName: "Issoufou", role: "asso_secretary", isActive: true },
  ]);

  await MemberModel.insertMany([
    { tenantId: assoTenant._id, code: "MBR-001", firstName: "Adamou", lastName: "Ali", membershipType: "membre_actif", joinDate: new Date("2020-01-15"), status: "active" },
    { tenantId: assoTenant._id, code: "MBR-002", firstName: "Rakia", lastName: "Moussa", membershipType: "membre_actif", joinDate: new Date("2020-03-10"), status: "active" },
    { tenantId: assoTenant._id, code: "MBR-003", firstName: "Souleymane", lastName: "Oumarou", membershipType: "membre_honoraire", joinDate: new Date("2019-06-01"), status: "active" },
    { tenantId: assoTenant._id, code: "MBR-004", firstName: "Hadiza", lastName: "Kané", membershipType: "bienfaiteur", joinDate: new Date("2021-01-01"), status: "active" },
  ]);

  console.log("✅ Tenant Association créé : - seed-demo.ts:122", assoTenant.name);

  // ─── Tenant 3 : Administration ────────────────────────────────────────────────

  const adminTenant = await TenantModel.create({
    type: "administration",
    name: "Commune de Dosso",
    slug: "commune-dosso",
    email: "contact@commune-dosso.ne",
    phone: "+227 20 00 00 03",
    address: "Hôtel de Ville, Dosso, Niger",
    plan: "admin",
    planModules: ["*"],
    subscriptionStatus: "active",
    activatedAt: new Date(),
  });

  await UserModel.insertMany([
    { tenantId: adminTenant._id, email: "maire@dosso.ne", passwordHash, firstName: "Boubacar", lastName: "Souley", role: "admin_ordonnateur", isActive: true },
    { tenantId: adminTenant._id, email: "daf@dosso.ne", passwordHash, firstName: "Mariama", lastName: "Issa", role: "admin_daf", isActive: true },
    { tenantId: adminTenant._id, email: "comptable@dosso.ne", passwordHash, firstName: "Mahamane", lastName: "Alio", role: "admin_public_accountant", isActive: true },
  ]);

  const year = new Date().getFullYear();
  await BudgetChapterModel.insertMany([
    { tenantId: adminTenant._id, code: "TITRE-1", label: "Budget de fonctionnement", year, allocatedAmount: 500_000_000, engagedAmount: 180_000_000, mandatedAmount: 120_000_000, paidAmount: 100_000_000, level: "titre" },
    { tenantId: adminTenant._id, code: "TITRE-2", label: "Budget d'investissement", year, allocatedAmount: 300_000_000, engagedAmount: 80_000_000, mandatedAmount: 40_000_000, paidAmount: 35_000_000, level: "titre" },
    { tenantId: adminTenant._id, code: "CHAP-11", label: "Personnel", year, allocatedAmount: 200_000_000, engagedAmount: 100_000_000, mandatedAmount: 80_000_000, paidAmount: 75_000_000, level: "chapitre" },
    { tenantId: adminTenant._id, code: "CHAP-12", label: "Fonctionnement courant", year, allocatedAmount: 150_000_000, engagedAmount: 55_000_000, mandatedAmount: 30_000_000, paidAmount: 25_000_000, level: "chapitre" },
    { tenantId: adminTenant._id, code: "CHAP-21", label: "Infrastructures", year, allocatedAmount: 200_000_000, engagedAmount: 60_000_000, mandatedAmount: 25_000_000, paidAmount: 20_000_000, level: "chapitre" },
  ]);

  console.log("✅ Tenant Administration créé : - seed-demo.ts:154", adminTenant.name);

  // ─── Superadmin ───────────────────────────────────────────────────────────────

  const superTenant = await TenantModel.create({
    type: "pme",
    name: "Kanoo Platform",
    slug: "kanoo-platform",
    email: "super@kanoo.ne",
    plan: "enterprise",
    planModules: ["*"],
    subscriptionStatus: "active",
  });

  await UserModel.create({
    tenantId: superTenant._id,
    email: "superadmin@demo.ne",
    passwordHash,
    firstName: "Super",
    lastName: "Admin",
    role: "superadmin",
    isActive: true,
  });

  console.log("\n🎉 Seed complet terminé ! - seed-demo.ts:178");
  console.log("\n📋 Identifiants de connexion : - seed-demo.ts:179");
  console.log("PME       : admin@demo.ne / demo1234 - seed-demo.ts:180");
  console.log("PME       : comptable@demo.ne / demo1234 - seed-demo.ts:181");
  console.log("PME       : commercial@demo.ne / demo1234 - seed-demo.ts:182");
  console.log("Asso      : president@asso.ne / demo1234 - seed-demo.ts:183");
  console.log("Admin     : maire@dosso.ne / demo1234 - seed-demo.ts:184");
  console.log("Superadmin: superadmin@demo.ne / demo1234 - seed-demo.ts:185");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erreur seed: - seed-demo.ts:192", err);
  process.exit(1);
});
