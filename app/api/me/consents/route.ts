import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, ok, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";

type Consents = { email?: boolean; whatsapp?: boolean; sms?: boolean; updatedAt?: Date };

export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  await connectDB();
  const user = await UserModel.findById(auth.userId).select("consents deletionRequestedAt").lean() as
    | { consents?: Consents; deletionRequestedAt?: Date }
    | null;
  return ok({
    consents: user?.consents ?? { email: false, whatsapp: false, sms: false },
    deletionRequestedAt: user?.deletionRequestedAt ?? null,
  });
}

// RGPD — recueil du consentement, horodaté, par canal.
export async function PATCH(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  const body = await req.json();
  await connectDB();
  const user = await UserModel.findById(auth.userId);
  if (!user) return unauthorized();

  const prev = (user.consents || {}) as Consents;
  user.consents = {
    email: typeof body.email === "boolean" ? body.email : !!prev.email,
    whatsapp: typeof body.whatsapp === "boolean" ? body.whatsapp : !!prev.whatsapp,
    sms: typeof body.sms === "boolean" ? body.sms : !!prev.sms,
    updatedAt: new Date(),
  };
  await user.save();
  return ok({ consents: user.consents });
}
