import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { runCronGroup, runCronJob, type Cadence } from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";
// Une exécution de groupe peut être longue (relances, envois) : on autorise
// jusqu'à 5 minutes plutôt que la limite courte par défaut.
export const maxDuration = 300;

const GROUPS: Cadence[] = ["daily", "monthly", "yearly"];

/**
 * GET|POST /api/cron — déclencheur des tâches planifiées.
 *
 * Le scheduler node-cron est un processus permanent, impossible sur
 * l'hébergement Next.js managé (Hostinger) qui ne fait tourner que l'app web.
 * Cet endpoint expose les mêmes tâches ; une tâche cron de l'hébergeur l'appelle
 * périodiquement. Configuration côté hPanel (menu « Avancé » → Tâches cron) :
 *
 *   # chaque jour à 06:30 (heure serveur) — les tâches quotidiennes
 *   30 6 * * *  curl -fsS -H "x-cron-key: $CRON_SECRET" "https://…/api/cron?group=daily"
 *   # le 1er du mois à 01:00 — rappels TVA + purge des jetons
 *   0 1 1 * *   curl -fsS -H "x-cron-key: $CRON_SECRET" "https://…/api/cron?group=monthly"
 *   # le 1er janvier — remise à zéro de la numérotation
 *   1 0 1 1 *   curl -fsS -H "x-cron-key: $CRON_SECRET" "https://…/api/cron?group=yearly"
 *
 * Sécurité : un secret partagé (CRON_SECRET), comparé en temps constant. Sans
 * lui, n'importe qui pourrait déclencher des envois de relances. Si la variable
 * n'est pas configurée, l'endpoint se refuse plutôt que de s'ouvrir.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET non configuré : endpoint désactivé." },
      { status: 503 }
    );
  }

  // Le secret peut venir d'un en-tête (préféré) ou d'un paramètre (certaines
  // interfaces cron n'ajoutent pas d'en-têtes).
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-key")
    || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || url.searchParams.get("key")
    || "";

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const authorized = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!authorized) {
    return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 401 });
  }

  await connectDB();

  // Une tâche nommée, ou un groupe de cadence.
  const jobId = url.searchParams.get("job");
  if (jobId) {
    const result = await runCronJob(jobId);
    if (!result) return NextResponse.json({ success: false, error: `Tâche inconnue : ${jobId}` }, { status: 404 });
    return NextResponse.json({ success: true, ran: [result] });
  }

  const group = (url.searchParams.get("group") || "daily") as Cadence;
  if (!GROUPS.includes(group)) {
    return NextResponse.json({ success: false, error: `Groupe inconnu : ${group}` }, { status: 400 });
  }

  const started = Date.now();
  const results = await runCronGroup(group);
  const failed = results.filter(r => r.error).length;

  // 207 si au moins une tâche a échoué : l'ordonnanceur peut le repérer sans
  // qu'un échec partiel passe pour un succès complet.
  return NextResponse.json(
    { success: failed === 0, group, totalMs: Date.now() - started, failed, ran: results },
    { status: failed === 0 ? 200 : 207 }
  );
}

export const GET = handle;
export const POST = handle;
