import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicPhotoModel } from "@/models/IsicPhoto";
import { validPhoto, savePhoto } from "@/lib/isic-photos";
import { normalizeMatricule, normalizeText, photoStem } from "@/lib/isic-registry";
import { ensureRegistryIndexes } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/isic/registry/photos — { fileName | matricule, schoolName?, dataUri }
 * Rattache une photo à l'étudiant dont le Personal ID (matricule) correspond au
 * nom du fichier — « 25175.jpg.jpeg » → 25175, comme dans vos envois à ISIC.
 * Réponse { status: "attached" | "unknown" | "ambiguous" } pour le rapport.
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await ensureRegistryIndexes();
  const b = await req.json().catch(() => ({}));
  if (!validPhoto(b.dataUri)) return badRequest("Photo invalide : JPEG ou PNG, 2 Mo maximum après compression.");
  const id = normalizeMatricule(b.matricule || photoStem(String(b.fileName || "")));
  if (!id) return badRequest("Impossible de déduire le Personal ID du nom de fichier.");

  const candidates = await IsicStudentModel.find({ ...tenantFilter(auth), archived: { $ne: true }, matricule: { $exists: true, $ne: "" } })
    .select("_id matricule schoolName fullName").lean<Array<{ _id: Types.ObjectId; matricule: string; schoolName: string; fullName: string }>>();
  let hits = candidates.filter(c => normalizeMatricule(c.matricule) === id);
  if (hits.length > 1 && b.schoolName) hits = hits.filter(c => normalizeText(c.schoolName) === normalizeText(b.schoolName));
  if (hits.length === 0) return ok({ status: "unknown", personalId: id });
  if (hits.length > 1) return ok({ status: "ambiguous", personalId: id });

  await savePhoto(auth, hits[0]._id, b.dataUri, b.fileName);
  return ok({ status: "attached", personalId: id, studentId: String(hits[0]._id), fullName: hits[0].fullName });
});

export const DELETE = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const studentId = new URL(req.url).searchParams.get("studentId");
  if (!studentId || !Types.ObjectId.isValid(studentId)) return notFound("Étudiant introuvable");
  await IsicPhotoModel.deleteOne({ tenantId: auth.tenantId, studentId });
  const r = await IsicStudentModel.updateOne({ _id: studentId, ...tenantFilter(auth) }, { $set: { hasPhoto: false } });
  if (!r.matchedCount) return notFound("Étudiant introuvable");
  return ok({ removed: true });
});

