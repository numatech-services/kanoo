/**
 * Exécute une automatisation à une date donnée, contre la base de TEST
 * (MONGODB_URI) — pour éprouver ce qui ne se déclenche qu'un jour précis
 * (paie générée d'office le dernier jour du mois…). Outil de test : l'endpoint
 * /api/cron, lui, n'accepte jamais de date.
 *
 *   npx tsx scripts/e2e/run-job-at.ts runPayroll 2026-10-31T10:00:00Z
 */
import mongoose from "mongoose";
import { AUTOMATION_RUNNERS } from "../../lib/automation-jobs";

async function main() {
  const [name, at] = process.argv.slice(2);
  const uri = process.env.MONGODB_URI ?? "";
  if (!/e2e|test/.test(uri)) throw new Error("MONGODB_URI doit désigner une base de test.");
  const runner = (AUTOMATION_RUNNERS as Record<string, (now?: Date) => Promise<string>>)[name];
  if (!runner) throw new Error(`Tâche inconnue : ${name}`);
  const now = new Date(at);
  if (isNaN(now.getTime())) throw new Error(`Date invalide : ${at}`);
  await mongoose.connect(uri);
  const summary = await runner(now);
  console.log(JSON.stringify({ summary }));
  await mongoose.disconnect();
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
