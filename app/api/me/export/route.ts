import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";

// RGPD — droit d'accès : export des données personnelles de l'utilisateur (JSON).
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  await connectDB();

  const user = await UserModel.findById(auth.userId).lean();
  if (!user) return unauthorized();
  const u = user as Record<string, unknown> & {
    _id: unknown; email: string; firstName?: string; lastName?: string; phone?: string; role?: string;
    isActive?: boolean; createdAt?: Date; lastLoginAt?: Date; twoFactorEnabled?: boolean;
    consents?: unknown; deletionRequestedAt?: Date;
  };

  const data = {
    exportedAt: new Date().toISOString(),
    account: {
      id: String(u._id),
      email: u.email,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      phone: u.phone ?? null,
      role: u.role ?? null,
      isActive: u.isActive ?? null,
      createdAt: u.createdAt ?? null,
      lastLoginAt: u.lastLoginAt ?? null,
    },
    security: { twoFactorEnabled: !!u.twoFactorEnabled },
    consents: u.consents ?? { email: false, whatsapp: false, sms: false },
    deletionRequestedAt: u.deletionRequestedAt ?? null,
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="mes-donnees-kanoo.json"',
    },
  });
}
