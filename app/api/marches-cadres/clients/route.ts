import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ClientModel } from "@/models/Client";

export const dynamic = "force-dynamic";

/**
 * GET — clients (nom et code seulement) pour créer un marché-cadre. Qui crée
 * un marché-cadre n'a pas forcément accès au fichier clients : la liste
 * déroulante restait vide.
 */
export const GET = withAuth("commandes", "create", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const items = await ClientModel.find({ ...tenantFilter(auth), isActive: { $ne: false } }).select("name code").sort({ name: 1 }).limit(500).lean();
  return ok({ items });
});
