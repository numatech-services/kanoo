import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, conflict } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseCsv, detectColumns, isAcademicYear } from "@/lib/isic-registry";
import { applyRegistryEntries, entriesFromRows } from "@/lib/isic-registry-server";
import { readXlsx } from "@/lib/isic-xlsx";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 8_000_000;

/**
 * POST /api/isic/registry/import
 *   { mode, csv? | fileBase64?, fileName?, academicYear?, schoolName? }
 *
 * Accepte le CSV et le **.xlsx** — en particulier vos deux fichiers ISIC :
 *  - mode « reprise »  : étudiants existants avec leur numéro (ex. fichier reçu
 *    d'ISIC des années passées : numéro + validité réelle repris) ;
 *  - mode « students » : nouvelle liste (ex. fichier envoyé à ISIC « Première
 *    vague 2026-2027 ») — étudiants « en attente de numéro » ;
 *  - mode « numbers »  : fichier reçu d'ISIC — numéros, statut et validité ;
 *    ne crée aucun étudiant.
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const mode = body.mode as "reprise" | "students" | "numbers";
  if (!["reprise", "students", "numbers"].includes(mode)) return badRequest("Mode d'import inconnu.");
  if (body.academicYear && !isAcademicYear(body.academicYear)) return badRequest("Année académique invalide (format 2025-2026).");

  let parsed: { headers: string[]; rows: string[][] };
  if (typeof body.fileBase64 === "string" && body.fileBase64) {
    const b64 = body.fileBase64.replace(/^data:[^,]*,/, "");
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_FILE_BYTES) return badRequest("Fichier trop volumineux (8 Mo maximum).");
    if (/\.xls$/i.test(String(body.fileName || ""))) return badRequest("Format .xls (Excel 97) non pris en charge : enregistrez le fichier au format .xlsx.");
    try { parsed = await readXlsx(buf); } catch { return badRequest("Fichier Excel illisible. Vérifiez qu'il s'agit bien d'un .xlsx."); }
  } else {
    parsed = parseCsv(String(body.csv || ""));
  }
  const { headers, rows } = parsed;
  if (!headers.length || !rows.length) return badRequest("Fichier vide ou illisible.");
  if (rows.length > 20000) return badRequest("20 000 lignes maximum par import.");

  const cols = detectColumns(headers);
  const hasName = cols.name >= 0 || (cols.firstName >= 0 && cols.lastName >= 0);
  if (mode !== "numbers" && !hasName) return badRequest("Colonnes du nom introuvables (« Nom », ou « Prénom » et « Nom »).");
  if (mode === "numbers" && (cols.matricule < 0 || cols.number < 0)) {
    return badRequest("Le fichier reçu d'ISIC doit contenir les colonnes « Personal ID » (matricule) et « Card Number ».");
  }

  const defaults = { schoolName: String(body.schoolName || "").trim() || undefined, academicYear: mode === "numbers" ? undefined : body.academicYear };
  const entries = entriesFromRows(rows, {
    ...cols,
    // Une liste de nouveaux étudiants n'attribue pas de numéro par erreur.
    number: mode === "students" ? -1 : cols.number,
    email: mode === "numbers" ? -1 : cols.email,
    phone: mode === "numbers" ? -1 : cols.phone,
    year: mode === "numbers" ? -1 : cols.year,
  }, defaults);

  // Ex. fichier des doctorants : colonne « Academic Institution Name » vide.
  if (mode !== "numbers" && entries.every(e => !e.schoolName)) {
    return badRequest("La colonne « établissement » est vide dans ce fichier : choisissez l'établissement par défaut avant l'import.");
  }

  try {
    const { report } = await applyRegistryEntries(auth, entries, {
      numberSource: mode === "reprise" ? "reprise" : "isic",
      licenceSource: mode === "reprise" ? "reprise" : "manuel",
      numbersOnly: mode === "numbers",
    });
    await logAudit(auth, "UPDATE", "isic", { metadata: { registryImport: mode, file: String(body.fileName || "csv").slice(0, 120), created: report.created, numbers: report.numbersAssigned, conflicts: report.conflicts.length } });
    return ok(report);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return conflict("Un autre import modifie le registre en même temps. Relancez l'import : les lignes déjà traitées ne seront pas dupliquées.");
    }
    throw err;
  }
});
