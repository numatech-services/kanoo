/**
 * Suite de tests Kanoo
 * Usage: npm run test 
 */

import { config } from "dotenv";
config({ path: ".env.test" });
config({ path: ".env.local" });

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✅ ${name}`);
      passed++;
    })
    .catch((err: Error) => {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
      errors.push(`${name}: ${err.message}`);
    });
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── Tests Fiscalité Niger ────────────────────────────────────────────────────

async function testFiscalNiger() {
  console.log("\n📊 Tests fiscalité Niger:");
  const { calculerTVA, calculerTTC, calculerCNSS, calculerDTS,
    determineProcedureMarche, SEUILS_MARCHES } = await import("../lib/niger-fiscal");

  await test("TVA 19% standard", () => {
    assert(calculerTVA(100_000) === 19_000, "TVA 100k = 19k");
  });

  await test("TTC correct", () => {
    assert(calculerTTC(100_000) === 119_000, "TTC 100k = 119k");
  });

  await test("CNSS salarié 3.6%", () => {
    const { salarie } = calculerCNSS(200_000);
    assert(salarie === 7_200, `CNSS salarié 200k = 7200, got ${salarie}`);
  });

  await test("CNSS patronal 16.4%", () => {
    const { patronal } = calculerCNSS(200_000);
    assert(patronal === 32_800, `CNSS patronal 200k = 32800, got ${patronal}`);
  });

  await test("DTS 0 si < 10k XOF", () => {
    assert(calculerDTS(5_000) === 0, "Pas de DTS sous 10k");
  });

  await test("DTS 200 pour tranche 10k-100k", () => {
    assert(calculerDTS(50_000) === 200, "DTS = 200 XOF");
  });

  await test("Achat direct < 5M XOF", () => {
    assert(determineProcedureMarche(3_000_000) === "achat_direct", "Achat direct");
  });

  await test("Consultation restreinte 5M-30M XOF", () => {
    assert(determineProcedureMarche(15_000_000) === "consultation_restreinte", "Consultation restreinte");
  });

  await test("Appel d'offres ouvert 30M-100M XOF", () => {
    assert(determineProcedureMarche(60_000_000) === "appel_offres_ouvert", "AO ouvert");
  });

  await test("AO international > 100M XOF", () => {
    assert(determineProcedureMarche(150_000_000) === "appel_offres_international", "AO international");
  });
}

// ─── Tests Auth ───────────────────────────────────────────────────────────────

async function testAuth() {
  console.log("\n🔐 Tests authentification:");
  const { signToken, verifyToken, hashPassword, comparePassword } = await import("../lib/auth");

  await test("Signer et vérifier un token JWT", () => {
    const payload = {
      userId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      tenantType: "pme" as const,
      role: "pme_admin" as const,
      email: "test@demo.ne",
      subscriptionStatus: "active" as const,
      planModules: ["*"],
    };
    const token = signToken(payload);
    const decoded = verifyToken(token);
    assert(decoded.email === payload.email, "Email correspondant");
    assert(decoded.role === payload.role, "Rôle correspondant");
  });

  await test("Token invalide rejeté", () => {
    let threw = false;
    try { verifyToken("invalid.token.here"); } catch { threw = true; }
    assert(threw, "Token invalide doit lever une exception");
  });

  await test("Hash et vérification mot de passe", async () => {
    const hash = await hashPassword("motDePasseTest123");
    const valid = await comparePassword("motDePasseTest123", hash);
    const invalid = await comparePassword("mauvaisMotDePasse", hash);
    assert(valid, "Bon mot de passe accepté");
    assert(!invalid, "Mauvais mot de passe refusé");
  });
}

// ─── Tests RBAC ───────────────────────────────────────────────────────────────

async function testRBAC() {
  console.log("\n🛡️  Tests permissions RBAC:");
  const { canAccessResource, canPerformAction } = await import("../lib/role-resources");

  await test("pme_admin a accès à tout", () => {
    assert(canAccessResource("pme_admin", "invoices"), "pme_admin → invoices");
    assert(canAccessResource("pme_admin", "employees"), "pme_admin → employees");
    assert(canAccessResource("pme_admin", "auditLogs"), "pme_admin → auditLogs");
  });

  await test("pme_sales n'a pas accès aux employés", () => {
    assert(!canAccessResource("pme_sales", "employees"), "pme_sales ✗ employees");
  });

  await test("pme_approver ne peut que lire et mettre à jour les approbations", () => {
    assert(canPerformAction("pme_approver", "approbations", "read"), "approver peut lire");
    assert(canPerformAction("pme_approver", "approbations", "update"), "approver peut mettre à jour");
    assert(!canPerformAction("pme_approver", "approbations", "delete"), "approver ne peut pas supprimer");
    assert(!canPerformAction("pme_approver", "invoices", "create"), "approver ne peut pas créer des factures");
  });

  await test("superadmin a accès à tout", () => {
    assert(canAccessResource("superadmin", "anything"), "superadmin → n'importe quelle ressource");
    assert(canPerformAction("superadmin", "secret", "delete"), "superadmin peut tout faire");
  });

  await test("asso_treasurer a accès cotisations et dons", () => {
    assert(canAccessResource("asso_treasurer", "cotisations"), "trésorier → cotisations");
    assert(canAccessResource("asso_treasurer", "dons"), "trésorier → dons");
    assert(!canAccessResource("asso_treasurer", "assemblee"), "trésorier ✗ AG");
  });

  await test("admin_procurement_commission ne peut que dépouillement", () => {
    assert(canPerformAction("admin_procurement_commission", "publicTenders", "read"), "commission peut lire AO");
    assert(!canPerformAction("admin_procurement_commission", "publicTenders", "create"), "commission ne peut pas créer AO");
    assert(!canAccessResource("admin_procurement_commission", "budgetChapters"), "commission ✗ budget");
  });
}

// ─── Tests API helpers ────────────────────────────────────────────────────────

async function testApiHelpers() {
  console.log("\n🔧 Tests API helpers:");
  const { requireFields } = await import("../lib/api-helpers");

  await test("requireFields retourne null si tout est présent", () => {
    const res = requireFields({ name: "test", code: "T01" }, ["name", "code"]);
    assert(res === null, "Pas d'erreur si champs présents");
  });

  await test("requireFields retourne erreur si champ manquant", () => {
    const res = requireFields({ name: "test" }, ["name", "code"]);
    assert(res !== null && res.includes("code"), `Erreur attendue sur 'code', got: ${res}`);
  });

  await test("requireFields refuse valeur vide", () => {
    const res = requireFields({ name: "", code: "T01" }, ["name", "code"]);
    assert(res !== null, "Valeur vide doit déclencher une erreur");
  });
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log("🧪 Kanoo — Suite de tests\n");

  await testFiscalNiger();
  await testAuth();
  await testRBAC();
  await testApiHelpers();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 Résultats : ${passed} ✅ passés, ${failed} ❌ échoués`);

  if (errors.length > 0) {
    console.log("\n❌ Détail des échecs :");
    errors.forEach((e) => console.log(`   • ${e}`));
    process.exit(1);
  } else {
    console.log("\n🎉 Tous les tests sont passés !");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
