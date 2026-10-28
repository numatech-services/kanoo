import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, forbidden } from "@/lib/api-helpers";
import { hasFinanceAccess } from "@/lib/role-resources";
import { marginReport, type MarginGroup, type MarginSource } from "@/lib/margins-server";
import { parsePeriod } from "@/lib/flow-filter";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const GROUPS: MarginGroup[] = ["product", "category", "month", "desk", "cashier", "source"];
const SOURCES: MarginSource[] = ["all", "comptoir", "invoices"];

/** Marges par produit, catégorie, mois, comptoir, vendeur : réservé au gérant et à la comptabilité. */
export const GET = withAuth("analytics", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!hasFinanceAccess(auth)) return forbidden("Les marges sont réservées au gérant et à la comptabilité.");
  await connectDB();
  const url = new URL(req.url);
  const p = parsePeriod(url);
  const now = new Date();
  const from = p.from ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = p.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const groupBy = GROUPS.includes(url.searchParams.get("groupBy") as MarginGroup) ? url.searchParams.get("groupBy") as MarginGroup : "product";
  const source = SOURCES.includes(url.searchParams.get("source") as MarginSource) ? url.searchParams.get("source") as MarginSource : "all";
  return ok({ from, to, groupBy, source, ...(await marginReport(auth.tenantId, { from, to, source, groupBy })) });
});
