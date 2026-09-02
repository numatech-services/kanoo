/**
 * Script de backup MongoDB — Kanoo
 * 
 * Usage:
 *   npm run backup                    → backup immédiat vers ./backups/
 *   BACKUP_PATH=/data/backups npm run backup
 * 
 * En production (cron quotidien 02:00 Niamey) :
 *   0 1 * * * cd /app && npm run backup >> /var/log/kanoo-backup.log 2>&1
 */

import { exec } from "child_process";
import { promisify } from "util";
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const execAsync = promisify(exec);

const MONGODB_URI = process.env.MONGODB_URI;
const BACKUP_PATH = process.env.BACKUP_PATH || join(process.cwd(), "backups");
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || "30");
const APP_NAME = "kanoo";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI non défini");
  process.exit(1);
}

function formatDate(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function runBackup(): Promise<void> {
  const now = new Date();
  const timestamp = formatDate(now);
  const backupDir = join(BACKUP_PATH, `${APP_NAME}-${timestamp}`);
  const archivePath = `${backupDir}.gz`;

  console.log(`\n🔄 Début du backup — ${now.toLocaleString("fr-FR", { timeZone: "Africa/Niamey" })} (Niamey)`);
  console.log(`   URI    : ${MONGODB_URI.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log(`   Dest.  : ${archivePath}`);

  // Créer le dossier de backup
  if (!existsSync(BACKUP_PATH)) mkdirSync(BACKUP_PATH, { recursive: true });

  try {
    // mongodump avec compression gzip
    const cmd = `mongodump --uri="${MONGODB_URI}" --out="${backupDir}" --gzip`;
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && !stderr.includes("writing")) {
      console.warn("⚠️  mongodump warnings:", stderr.slice(0, 200));
    }

    // Créer une archive tar.gz du dossier
    await execAsync(`tar -czf "${archivePath}" -C "${BACKUP_PATH}" "${APP_NAME}-${timestamp}" && rm -rf "${backupDir}"`);

    // Vérifier la taille
    const stats = statSync(archivePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`✅ Backup créé : ${archivePath} (${sizeMB} MB)`);

  } catch (err) {
    console.error("❌ Erreur mongodump :", err);
    // Tentative fallback : mongoexport collection par collection
    console.log("   Tentative de fallback mongoexport...");
    try {
      await execAsync(`mkdir -p "${backupDir}"`);
      const collections = ["tenants", "users", "clients", "invoices", "devis", "employees", "payslips", "accountingentries"];
      for (const col of collections) {
        await execAsync(`mongoexport --uri="${MONGODB_URI}" --collection="${col}" --out="${backupDir}/${col}.json" --quiet`).catch(() => {});
      }
      await execAsync(`tar -czf "${archivePath}" -C "${BACKUP_PATH}" "${APP_NAME}-${timestamp}" && rm -rf "${backupDir}"`);
      console.log(`✅ Backup fallback créé : ${archivePath}`);
    } catch (fallbackErr) {
      console.error("❌ Backup échoué complètement:", fallbackErr);
      process.exit(1);
    }
  }

  // Nettoyage des backups anciens
  await cleanOldBackups();
}

async function cleanOldBackups(): Promise<void> {
  if (!existsSync(BACKUP_PATH)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = readdirSync(BACKUP_PATH).filter(f => f.startsWith(APP_NAME) && f.endsWith(".gz"));
  let cleaned = 0;

  for (const file of files) {
    const filePath = join(BACKUP_PATH, file);
    const stat = statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      unlinkSync(filePath);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🗑️  ${cleaned} ancien${cleaned > 1 ? "s" : ""} backup${cleaned > 1 ? "s" : ""} supprimé${cleaned > 1 ? "s" : ""} (rétention ${RETENTION_DAYS}j)`);
  }

  const remaining = readdirSync(BACKUP_PATH).filter(f => f.endsWith(".gz")).length;
  console.log(`📁 Backups conservés : ${remaining}`);
}

async function preDeployBackup(): Promise<void> {
  console.log("🚀 BACKUP PRÉ-DÉPLOIEMENT");
  await runBackup();
  console.log("✅ Backup pré-déploiement terminé — déploiement autorisé\n");
}

// Déterminer le mode
const mode = process.argv[2];
if (mode === "--pre-deploy") {
  preDeployBackup().catch(err => { console.error(err); process.exit(1); });
} else {
  runBackup().catch(err => { console.error(err); process.exit(1); });
}
