import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok } from "@/lib/api-helpers";
import { supplierSchedule } from "@/lib/supplier-schedule";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET — échéancier des factures fournisseurs non soldées et balance âgée par fournisseur. */
export const GET = withAuth("purchases", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  return ok(await supplierSchedule(auth.tenantId));
});
