import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicPhotoModel } from "@/models/IsicPhoto";
import { validPhoto, savePhoto } from "@/lib/isic-photos";

export const dynamic = "force-dynamic";

/** GET — la photo en image (utilisable dans <img src>). */
export const GET = withAuth("isic", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Photo introuvable");
  const photo = await IsicPhotoModel.findOne({ tenantId: auth.tenantId, studentId: params.id }).select("dataUri").lean<{ dataUri: string } | null>();
  if (!photo) return notFound("Photo introuvable");
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(photo.dataUri);
  if (!m) return notFound("Photo illisible");
  return new NextResponse(new Uint8Array(Buffer.from(m[2], "base64")), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, no-store" },
  });
});

/** POST — { dataUri, fileName? } : ajoute ou remplace la photo de cet étudiant. */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Étudiant introuvable");
  const b = await req.json().catch(() => ({}));
  if (!validPhoto(b.dataUri)) return badRequest("Photo invalide : JPEG ou PNG, 2 Mo maximum après compression.");
  const exists = await IsicStudentModel.exists({ _id: params.id, ...tenantFilter(auth) });
  if (!exists) return notFound("Étudiant introuvable");
  await savePhoto(auth, params.id, b.dataUri, b.fileName);
  return ok({ saved: true });
});
