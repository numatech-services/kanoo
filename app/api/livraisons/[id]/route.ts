import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await DeliveryNoteModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("invoiceId", "number totalTTC issueDate")
    .populate("clientId", "name code nif address phone")
    .lean();
  if (!item) return notFound();
  return ok(item);
});

export const PATCH = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  const item = await DeliveryNoteModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, body, { new: true }
  );
  if (!item) return notFound();
  await logAudit(auth, "UPDATE", "livraisons", { resourceId: params.id });
  return ok(item);
});
