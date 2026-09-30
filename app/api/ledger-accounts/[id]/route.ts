import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { LedgerAccountModel } from "@/models/LedgerAccount";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";

/** PATCH — intitulé, notes, activation (le numéro ne change pas). */
export const PATCH = withAuth("ledgerAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if ("label" in body) { const l = String(body.label ?? "").trim(); if (!l) return badRequest("Intitulé obligatoire."); set.label = l.slice(0, 160); }
  if ("notes" in body) set.notes = String(body.notes ?? "").slice(0, 500);
  if ("isActive" in body) set.isActive = !!body.isActive;
  const a = await LedgerAccountModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true });
  if (!a) return notFound();
  await logAudit(auth, "UPDATE", "ledgerAccounts", { resourceId: params.id, after: set });
  return ok(a);
});

/** DELETE — un compte jamais mouvementé ; sinon, le désactiver. */
export const DELETE = withAuth("ledgerAccounts", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const a = await LedgerAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!a) return notFound();
  if (await AccountingEntryModel.exists({ ...tenantFilter(auth), "lines.accountCode": a.code })) {
    return badRequest(`Le compte ${a.code} a des écritures : désactivez-le plutôt.`);
  }
  await LedgerAccountModel.deleteOne({ _id: a._id });
  await logAudit(auth, "DELETE", "ledgerAccounts", { resourceId: params.id, before: { code: a.code } });
  return noContent();
});
