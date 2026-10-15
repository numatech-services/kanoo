import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** PUT { target } — objectif mensuel de chiffre d'affaires facturé (FCFA TTC) ; 0 le retire. */
export const PUT = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const target = Math.round(Number(body.target));
  if (!(target >= 0) || target > 1e13) return badRequest("Objectif invalide.");
  await TenantModel.updateOne({ _id: auth.tenantId }, target > 0 ? { $set: { monthlyRevenueTarget: target } } : { $unset: { monthlyRevenueTarget: 1 } });
  await logAudit(auth, "UPDATE", "companies", { metadata: { monthlyRevenueTarget: target } });
  return ok({ target });
});
