import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { IsicBatchModel } from "@/models/IsicBatch";
import { IsicCardModel } from "@/models/IsicCard";
import { isAcademicYear } from "@/lib/isic-registry";
import { applyRegistryEntries } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/isic/:id/registry — synchronise un lot avec le registre ISIC.
 *
 * Pour chaque carte du lot :
 *  1. retrouve (ou crée) la fiche de l'étudiant — établissement du lot + matricule ;
 *  2. ouvre sa licence pour l'année académique du lot ;
 *  3. numéros : un numéro déjà reçu sur la carte remonte au registre ; un
 *     étudiant qui a DÉJÀ un numéro (ancien étudiant) le retrouve sur sa carte,
 *     qui passe « numérotée » sans repasser par ISIC ;
 *  4. rattache la carte à la fiche.
 * Rejouable sans risque : rien n'est dupliqué.
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Lot ISIC introuvable");
  const tf = tenantFilter(auth);
  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tf })
    .select("universityName universityId academicYear")
    .lean<{ _id: Types.ObjectId; universityName: string; universityId?: Types.ObjectId; academicYear?: string } | null>();
  if (!batch) return notFound("Lot ISIC introuvable");

  const body = await req.json().catch(() => ({}));
  const year = isAcademicYear(batch.academicYear) ? batch.academicYear : body.academicYear;
  if (!isAcademicYear(year)) {
    return badRequest("L'année académique du lot n'est pas au format 2025-2026 : précisez-la pour ouvrir les licences.");
  }

  const cards = await IsicCardModel.find({ batchId: batch._id, ...tf })
    .select("_id studentName matricule isicNumber status")
    .lean<Array<{ _id: Types.ObjectId; studentName: string; matricule?: string; isicNumber?: string; status: string }>>();
  if (!cards.length) return badRequest("Ce lot n'a encore aucune carte : importez d'abord la liste des étudiants.");

  let outcome;
  try {
    outcome = await applyRegistryEntries(auth, cards.map((c, i) => ({
      line: i + 1, fullName: c.studentName, matricule: c.matricule, schoolName: batch.universityName,
      schoolId: batch.universityId ? String(batch.universityId) : undefined,
      number: c.isicNumber, academicYear: year,
    })), { numberSource: "isic", licenceSource: "lot", batchId: String(batch._id) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return conflict("Le registre est modifié en même temps ailleurs. Relancez la synchronisation.");
    throw err;
  }

  // Report sur les cartes : rattachement + numéro connu du registre.
  let numbersFromRegistry = 0;
  const ops = cards.map((c, i) => {
    const hit = outcome.byLine.get(i + 1);
    if (!hit) return null;
    const set: Record<string, unknown> = { studentId: hit.studentId };
    if (!c.isicNumber && hit.number) {
      set.isicNumber = hit.number;
      if (c.status === "pending") set.status = "numbered";
      numbersFromRegistry++;
    }
    return { updateOne: { filter: { _id: c._id, ...tf }, update: { $set: set } } };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (ops.length) await IsicCardModel.bulkWrite(ops, { ordered: false });

  const r = outcome.report;
  await logAudit(auth, "UPDATE", "isic", { resourceId: String(batch._id), metadata: { registrySync: true, linked: ops.length, numbersFromRegistry } });
  return ok({
    academicYear: year,
    cards: cards.length,
    linked: ops.length,
    studentsCreated: r.created,
    numbersToRegistry: r.numbersAssigned,
    numbersFromRegistry,
    licencesCreated: r.licencesCreated,
    conflicts: r.conflicts,
    skipped: r.skipped,
  });
});
