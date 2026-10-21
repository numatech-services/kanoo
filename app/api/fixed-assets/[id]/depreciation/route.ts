import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { postDepreciation, DepreciationError } from "@/lib/fixed-asset-posting";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST /api/fixed-assets/:id/depreciation
 * Passe l'écriture comptable d'amortissement pour une année donnée
 * (implémentation commune avec la passation automatique : lib/fixed-asset-posting.ts).
 */
export const POST = withAuth("fixedAssets", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { year } = await req.json();
  if (!year) return badRequest("Année requise");

  try {
    const r = await withTransaction(session => postDepreciation(auth, params.id, Number(year), session));
    await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "depreciation_posted", year, annuity: r.annuity } });
    return ok({ message: `Amortissement ${year} comptabilisé`, annuity: r.annuity, accountingEntry: r.accountingEntry });
  } catch (err) {
    if (err instanceof DepreciationError) return err.notFound ? notFound() : badRequest(err.message);
    throw err;
  }
});
