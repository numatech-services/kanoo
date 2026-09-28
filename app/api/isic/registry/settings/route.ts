import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { IsicSettingsModel } from "@/models/IsicSettings";

export const dynamic = "force-dynamic";

export const GET = withAuth("isic", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const s = await IsicSettingsModel.findOne({ tenantId: auth.tenantId }).lean<{ renewalRequestType?: string } | null>();
  return ok({ renewalRequestType: s?.renewalRequestType ?? "" });
});

/** PATCH — { renewalRequestType } : code « Request Type » d'ISIC pour un renouvellement. */
export const PATCH = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const b = await req.json().catch(() => ({}));
  const code = String(b.renewalRequestType ?? "").trim().toUpperCase();
  if (code && !/^[A-Z][A-Z0-9_]{2,39}$/.test(code)) return badRequest("Code invalide : lettres majuscules, chiffres et « _ » (ex. NEW_CARD).");
  await IsicSettingsModel.updateOne(
    { tenantId: auth.tenantId },
    { $set: { renewalRequestType: code || undefined, updatedBy: auth.userId } },
    { upsert: true },
  );
  await logAudit(auth, "UPDATE", "isic", { metadata: { isicSettings: { renewalRequestType: code } } });
  return ok({ renewalRequestType: code });
});
