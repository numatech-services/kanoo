import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const e = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("lines.projectId", "code name").populate("lines.activityId", "name")
    .populate("createdBy", "firstName lastName").populate("reversedBy", "reference entryDate").populate("reverses", "reference entryDate")
    .lean();
  if (!e) return notFound();
  return ok(e);
});

/** PATCH — libellé et référence seulement : les montants se corrigent par extourne. */
export const PATCH = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const set: Record<string, string> = {};
  if (typeof body.label === "string" && body.label.trim()) set.label = body.label.trim().slice(0, 300);
  if (typeof body.reference === "string" && body.reference.trim()) set.reference = body.reference.trim().slice(0, 80);
  if (!Object.keys(set).length) return badRequest("Rien à modifier (libellé ou référence).");
  const e = await AccountingEntryModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: params.id, after: set });
  return ok(e);
});
