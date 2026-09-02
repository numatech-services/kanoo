import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("payslips", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const p = await PayslipModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("employeeId","firstName lastName code").lean();
  if (!p) return notFound(); return ok(p);
});
export const PATCH = withAuth("payslips", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const p = await PayslipModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!p) return notFound();
  // Seul isPaid peut être modifié
  if (typeof body.isPaid !== "undefined") { p.isPaid = body.isPaid; if (body.isPaid) p.paidAt = new Date(); }
  await p.save();
  await logAudit(auth, "UPDATE", "payslips", { resourceId: params.id, after: { isPaid: p.isPaid } });
  return ok(p);
});
