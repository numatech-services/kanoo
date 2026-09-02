import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const e = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!e) return notFound(); return ok(e);
});
export const PATCH = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  // Seuls certains champs non-comptables peuvent être modifiés
  const allowed = { label: body.label, reference: body.reference };
  const e = await AccountingEntryModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, allowed, { new: true });
  if (!e) return notFound(); return ok(e);
});
