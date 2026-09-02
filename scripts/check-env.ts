/**
 * Vérification des variables d'environnement au démarrage
 * Usage: npm run check  ou  node scripts/check-env.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const REQUIRED: string[] = ["MONGODB_URI", "JWT_SECRET"];

const OPTIONAL: Array<{ key: string; default: string; warning?: string }> = [
  { key: "APP_BASE_URL", default: "http://localhost:3000" },
  { key: "NODE_ENV", default: "development" },
  { key: "SMS_PROVIDER", default: "console" },
  { key: "EMAIL_PROVIDER", default: "console" },
  { key: "LOG_LEVEL", default: "info" },
  { key: "MONGO_NO_TRANSACTIONS", default: "false" },
  {
    key: "JWT_SECRET",
    default: "",
    warning: "JWT_SECRET trop court (< 32 caractères) — NON SÉCURISÉ pour la production",
  },
];

let hasErrors = false;
let hasWarnings = false;

console.log("\n🔍 Vérification des variables d'environnement Kanoo\n");

// Variables obligatoires
for (const key of REQUIRED) {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ MANQUANT: ${key} — obligatoire`);
    hasErrors = true;
  } else {
    console.log(`✅ ${key}`);
  }
}

// JWT_SECRET longueur
const jwtSecret = process.env.JWT_SECRET || "";
if (jwtSecret && jwtSecret.length < 32) {
  console.warn(`⚠️  JWT_SECRET trop court (${jwtSecret.length} chars, minimum 32)`);
  hasWarnings = true;
}
if (jwtSecret === "CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS") {
  console.warn("⚠️  JWT_SECRET utilise la valeur par défaut — À CHANGER EN PRODUCTION");
  hasWarnings = true;
}

// Variables optionnelles
console.log("\n📋 Variables optionnelles :");
for (const { key, default: def } of OPTIONAL) {
  const value = process.env[key];
  if (value) {
    console.log(`   ${key} = ${key.includes("SECRET") || key.includes("KEY") ? "***" : value}`);
  } else {
    console.log(`   ${key} (non défini, défaut: ${def || "—"})`);
  }
}

// Résumé
console.log("");
if (hasErrors) {
  console.error("❌ Variables obligatoires manquantes. Copiez .env.example en .env.local et renseignez les valeurs.\n");
  process.exit(1);
} else if (hasWarnings) {
  console.warn("⚠️  Vérification passée avec des avertissements.\n");
  process.exit(0);
} else {
  console.log("✅ Toutes les variables d'environnement sont correctement configurées.\n");
  process.exit(0);
}
