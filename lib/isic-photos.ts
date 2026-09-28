import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicPhotoModel } from "@/models/IsicPhoto";

/** Photo compressée côté navigateur (≈ 100–400 Ko) : 2 Mo encodés au maximum. */
const MAX_DATA_URI = 2_800_000;

export function validPhoto(dataUri: unknown): dataUri is string {
  return typeof dataUri === "string" && /^data:image\/(jpeg|png);base64,/.test(dataUri) && dataUri.length <= MAX_DATA_URI;
}

export async function savePhoto(auth: TokenPayload, studentId: Types.ObjectId | string, dataUri: string, originalName?: string) {
  const bytes = Math.round((dataUri.length - dataUri.indexOf(",") - 1) * 0.75);
  await IsicPhotoModel.updateOne(
    { tenantId: auth.tenantId, studentId },
    { $set: { dataUri, bytes, originalName: originalName?.slice(0, 200), createdBy: auth.userId } },
    { upsert: true },
  );
  await IsicStudentModel.updateOne({ _id: studentId, ...tenantFilter(auth) }, { $set: { hasPhoto: true } });
}
