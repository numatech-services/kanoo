import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { ErrorEventModel } from "@/models/ErrorEvent";

export type ErrorSource = "api" | "render" | "client" | "csp";

export interface ErrorReport {
  source: ErrorSource;
  message: string;
  stack?: string;
  url?: string;
  ref?: string;
  userAgent?: string;
  tenantId?: string;
}

/**
 * Empreinte d'une erreur : même source, même message une fois retirés les
 * identifiants et nombres variables, même premier cadre de pile. Deux
 * occurrences de la même panne sur deux factures différentes se regroupent.
 */
export function fingerprint(r: Pick<ErrorReport, "source" | "message" | "stack" | "url">): string {
  const msg = r.message
    .replace(/[a-f0-9]{24}/gi, "<id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
  const frame = (r.stack ?? "").split("\n").map(l => l.trim()).find(l => l.startsWith("at ")) ?? "";
  // Violation CSP : la page compte. Erreur navigateur : le message seul — la
  // pile vient d'un code minifié qui change à chaque déploiement et manque
  // souvent. Erreur serveur : le premier cadre de pile départage deux pannes
  // de même message.
  const extra = r.source === "csp" ? (r.url ?? "").replace(/\?.*$/, "")
    : r.source === "client" ? ""
    : frame.replace(/:\d+:\d+\)?$/, "");
  return crypto.createHash("sha1").update(`${r.source}|${msg}|${extra}`).digest("hex");
}

/**
 * Enregistre une erreur. Ne lève jamais et ne bloque pas l'appelant : un
 * journal en panne ne doit pas transformer une erreur en deux.
 */
export async function recordError(r: ErrorReport): Promise<void> {
  try {
    if (process.env.ERROR_LOG_DISABLED === "true") return;
    const message = String(r.message || "Erreur sans message").slice(0, 1000);
    const now = new Date();
    await connectDB();
    await ErrorEventModel.updateOne(
      { fingerprint: fingerprint({ ...r, message }) },
      {
        $inc: { count: 1 },
        $set: {
          lastAt: now,
          ...(r.ref ? { lastRef: String(r.ref).slice(0, 64) } : {}),
          ...(r.url ? { url: String(r.url).slice(0, 500) } : {}),
          ...(r.userAgent ? { userAgent: String(r.userAgent).slice(0, 300) } : {}),
          ...(r.tenantId ? { tenantId: r.tenantId } : {}),
        },
        $unset: { resolvedAt: "" },
        $setOnInsert: { source: r.source, message, stack: r.stack?.slice(0, 4000), firstAt: now },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error("[error-log] enregistrement impossible :", err instanceof Error ? err.message : err);
  }
}
