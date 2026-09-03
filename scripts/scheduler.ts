/**
 * Scheduler Kanoo — pour un hébergement VPS avec worker permanent.
 *
 * Les tâches elles-mêmes vivent dans lib/cron-jobs.ts, partagées avec
 * l'endpoint /api/cron (le seul montage possible sur l'hébergement Next.js
 * managé de Hostinger, qui n'autorise pas de processus permanent). Ce script ne
 * fait plus que les planifier ; il n'y a qu'une seule définition des tâches.
 *
 * Les expressions cron sont interprétées dans le fuseau Africa/Niamey (UTC+1).
 *
 * Usage : npm run scheduler
 */
import cron from "node-cron";
import mongoose from "mongoose";
import { config } from "dotenv";
import { CRON_JOBS } from "../lib/cron-jobs";

config({ path: ".env.local" });
config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI absent — le scheduler ne peut pas démarrer.");
  process.exit(1);
}

const TZ = { timezone: "Africa/Niamey" } as const;

async function connectDB() {
  if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI!);
}

for (const job of CRON_JOBS) {
  cron.schedule(job.schedule, async () => {
    try {
      await connectDB();
      const summary = await job.run();
      console.log(`[Scheduler] ${job.label} — ${summary}`);
    } catch (err) {
      console.error(`[Scheduler] ${job.label} :`, err);
    }
  }, TZ);
}

console.log("⏰ Scheduler Kanoo démarré (heures locales Niamey, UTC+1)");
for (const job of CRON_JOBS) {
  console.log(`   ${job.schedule.padEnd(12)} ${job.label} [${job.cadence}]`);
}
console.log(
  "\nSur hébergement managé (Hostinger), n'utilisez pas ce script : "
  + "configurez plutôt une tâche cron qui appelle /api/cron?group=daily|monthly|yearly."
);
