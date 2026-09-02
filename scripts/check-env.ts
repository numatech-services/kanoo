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
  { key: "PORTAL_JWT_SECRET", default: "dérivé de JWT_SECRET" },
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

// Secrets : longueur minimale et refus des valeurs d'exemple.
// Le contrôle porte sur le préfixe, comme dans lib/auth.ts — une comparaison
// d'égalité exacte avait laissé passer la valeur de .env.example.
const PLACEHOLDER_SECRET_PREFIX = "CHANGE_ME";
const isProduction = process.env.NODE_ENV === "production";

const SECRETS: Array<{ key: string; required: boolean }> = [
  { key: "JWT_SECRET", required: true },
  { key: "PORTAL_JWT_SECRET", required: false },
  { key: "TICKET_SECRET", required: false },
  { key: "FIELD_ENCRYPTION_KEY", required: false },
];

for (const { key, required } of SECRETS) {
  const value = process.env[key] || "";
  if (!value) {
    if (required) { console.error(`❌ ${key} manquant`); hasErrors = true; }
    continue;
  }
  if (value.length < 32) {
    const msg = `${key} trop court (${value.length} caractères, minimum 32)`;
    if (isProduction) { console.error(`❌ ${msg}`); hasErrors = true; }
    else { console.warn(`⚠️  ${msg}`); hasWarnings = true; }
  }
  if (value.startsWith(PLACEHOLDER_SECRET_PREFIX)) {
    const msg = `${key} est resté à sa valeur d'exemple — la remplacer (openssl rand -hex 32)`;
    if (isProduction) { console.error(`❌ ${msg}`); hasErrors = true; }
    else { console.warn(`⚠️  ${msg}`); hasWarnings = true; }
  }
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
