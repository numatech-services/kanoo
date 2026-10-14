import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { validatePurchase, PurchaseError } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

/** POST — valide un brouillon : écriture d'achat (AC). */
export const POST = withAuth("purchases", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const p = await PurchaseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound("Achat introuvable");
  try { await withTransaction(session => validatePurchase(auth, p, session, { force: body.force === true })); }
  catch (e) { if (e instanceof PurchaseError) return badRequest(e.message); throw e; }
  await logAudit(auth, "UPDATE", "purchases", { resourceId: params.id, after: { status: "validated", ...(p.matchOverride ? { matchOverride: p.matchOverride } : {}) } });
  return ok(p);
});
