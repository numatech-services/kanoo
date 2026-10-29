import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "stream";
import { isInternFor, INTERN_EXPORT_MESSAGE, authCan } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import { prepareFinancialExport } from "@/lib/financial-export";

/**
 * Un export à la fois par organisation : un double clic lançait deux
 * générations, et chacune occupe le serveur (mémoire, connexions).
 */
const running = new Set<string>();

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

// GET /api/exports/complet?annee=2026
// Export financier complet d'un exercice (Excel) avec les contrôles de cohérence.
export async function GET(req: NextRequest) {
  const gate = await authorize(req, "accountingEntries", "read");
  if (!gate.ok) return gate.response;
  const auth = gate.auth;
  if (isInternFor(auth, "accountingEntries")) return fail(403, INTERN_EXPORT_MESSAGE);
  // Toute la comptabilité, les pièces et les tiers : réservé à la comptabilité
  // et à la direction (droit de saisie), pas aux profils en lecture seule.
  if (!authCan(auth, "accountingEntries", "create")) return fail(403, "L'export complet est réservé à la comptabilité et à la direction.");
  // Lancé depuis une autre origine (lien piégé) : refusé.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return fail(403, "Requête refusée.");

  const raw = new URL(req.url).searchParams.get("annee");
  const annee = raw ? Number(raw) : new Date().getFullYear();
  if (!Number.isInteger(annee) || annee < 2000 || annee > new Date().getFullYear()) return fail(400, "Exercice invalide.");
  if (running.has(auth.tenantId)) return fail(409, "Un export est déjà en cours pour votre organisation. Patientez quelques instants.");

  running.add(auth.tenantId);
  const trace = { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined };
  try {
    await connectDB();
    await logAudit(auth, "EXPORT", "accountingEntries", { ...trace, metadata: { document: "export-financier-complet", annee, etape: "demandé" } });
    const prepared = await prepareFinancialExport(auth.tenantId, annee, { payroll: authCan(auth, "payslips", "read") });

    const out = new PassThrough();
    // Téléchargement interrompu : le flux se ferme, le verrou aussi.
    out.on("close", () => running.delete(auth.tenantId));
    prepared.write(out)
      .then(() => logAudit(auth, "EXPORT", "accountingEntries", { ...trace, metadata: { document: "export-financier-complet", annee, etape: "produit", ...prepared.counts } }))
      .catch(err => { console.error("[export complet]", err); out.destroy(err instanceof Error ? err : new Error(String(err))); })
      .finally(() => running.delete(auth.tenantId));

    return new NextResponse(Readable.toWeb(out) as ReadableStream, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${prepared.filename}"`,
        "Cache-Control": "no-store",
        // Lus par l'écran pour annoncer le résultat sans ouvrir le classeur.
        "X-Kanoo-Critiques": String(prepared.counts["Critique"]),
        "X-Kanoo-Majeurs": String(prepared.counts["Majeur"]),
        "X-Kanoo-A-Verifier": String(prepared.counts["À vérifier"]),
        "Access-Control-Expose-Headers": "Content-Disposition, X-Kanoo-Critiques, X-Kanoo-Majeurs, X-Kanoo-A-Verifier",
      },
    });
  } catch (err) {
    running.delete(auth.tenantId);
    console.error("[export complet]", err);
    return fail(500, "L'export n'a pas pu être préparé. Réessayez ; si l'erreur persiste, transmettez l'heure de l'essai à l'éditeur de Kanoo.");
  }
}
