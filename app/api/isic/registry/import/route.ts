import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, conflict } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseCsv, detectColumns, isAcademicYear } from "@/lib/isic-registry";
import { applyRegistryEntries, entriesFromCsv } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/isic/registry/import — { mode, csv, academicYear?, schoolName? }
 *
 *  - mode « reprise »  : étudiants existants, AVEC leur numéro s'ils en ont un ;
 *  - mode « students » : nouvelle liste d'étudiants (sans numéro, en attente) ;
 *  - mode « numbers »  : fichier retour d'ISIC (matricule + numéro) — ne crée
 *    aucun étudiant, attribue seulement les numéros.
 *
 * Réponse : rapport ligne à ligne (créés, numéros attribués, licences ouvertes,
 * conflits et lignes ignorées) — rien n'est écrasé en silence.
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const mode = body.mode as "reprise" | "students" | "numbers";
  if (!["reprise", "students", "numbers"].includes(mode)) return badRequest("Mode d'import inconnu.");
  if (body.academicYear && !isAcademicYear(body.academicYear)) return badRequest("Année académique invalide (format 2025-2026).");

  const { headers, rows } = parseCsv(String(body.csv || ""));
  if (!headers.length || !rows.length) return badRequest("Fichier vide ou illisible. Enregistrez votre tableau Excel au format CSV.");
  if (rows.length > 20000) return badRequest("20 000 lignes maximum par import.");

  const cols = detectColumns(headers);
  if (mode !== "numbers" && cols.name < 0) return badRequest("Colonne « nom » introuvable.");
  if (mode === "numbers" && (cols.matricule < 0 || cols.number < 0)) {
    return badRequest("Le fichier retour d'ISIC doit contenir les colonnes « matricule » et « numéro ISIC ».");
  }
  if (mode !== "numbers" && cols.school < 0 && !String(body.schoolName || "").trim()) {
    return badRequest("Aucune colonne « établissement » : choisissez l'établissement de la liste.");
  }

  const entries = entriesFromCsv(headers, rows, {
    ...cols,
    // Une liste d'étudiants « nouveaux » ne doit pas attribuer de numéro par erreur.
    number: mode === "students" ? -1 : cols.number,
    email: mode === "numbers" ? -1 : cols.email, phone: mode === "numbers" ? -1 : cols.phone,
    year: mode === "numbers" ? -1 : cols.year,
  }, { schoolName: String(body.schoolName || "").trim() || undefined, academicYear: mode === "numbers" ? undefined : body.academicYear });

  try {
    const { report } = await applyRegistryEntries(auth, entries, {
      numberSource: mode === "reprise" ? "reprise" : "isic",
      licenceSource: mode === "reprise" ? "reprise" : "manuel",
      numbersOnly: mode === "numbers",
    });
    await logAudit(auth, "UPDATE", "isic", { metadata: { registryImport: mode, created: report.created, numbers: report.numbersAssigned, conflicts: report.conflicts.length } });
    return ok(report);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return conflict("Un autre import modifie le registre en même temps. Relancez l'import : les lignes déjà traitées ne seront pas dupliquées.");
    }
    throw err;
  }
});
