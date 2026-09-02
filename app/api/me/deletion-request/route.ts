import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, ok, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";

/**
 * RGPD — droit à l'oubli : enregistre une DEMANDE de suppression (horodatée),
 * non destructive. La suppression effective est traitée par un administrateur
 * après vérification (opération irréversible, jamais automatique).
 */
export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  await connectDB();
  const user = await UserModel.findById(auth.userId);
  if (!user) return unauthorized();

  user.deletionRequestedAt = new Date();
  await user.save();

  await logAudit(auth, "UPDATE", "users", { resourceId: auth.userId, action: "gdpr_deletion_requested" });
  return ok({ requestedAt: user.deletionRequestedAt });
}
