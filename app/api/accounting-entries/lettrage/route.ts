import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { applyLetter, removeLetter, migrateLegacyLettering } from "@/lib/lettering";
import { BusinessRuleError } from "@/lib/errors";
import { withAuth, ok, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounting-entries/lettrage?account=411&state=open|lettered|all
 * Lignes d'un compte de tiers à rapprocher (factures ↔ règlements), avec le tiers.
 */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const account = (url.searchParams.get("account") || "411").replace(/\D/g, "");
  if (!/^4\d{0,7}$/.test(account)) return badRequest("Le lettrage porte sur un compte de tiers (classe 4).");
  const state = url.searchParams.get("state") ?? "open";
  await migrateLegacyLettering(auth.tenantId);
  const lineMatch: Record<string, unknown> = { "lines.accountCode": { $regex: `^${account}` } };
  if (state === "open") lineMatch["lines.letterRef"] = { $exists: false };
  if (state === "lettered") lineMatch["lines.letterRef"] = { $exists: true };
  const rows = await AccountingEntryModel.aggregate<{ _id: Types.ObjectId; entryDate: Date; reference: string; label: string; line: { accountCode: string; debit: number; credit: number; thirdPartyId?: Types.ObjectId; letterRef?: string } }>([
    { $match: { ...tenantFilter(auth), "lines.accountCode": { $regex: `^${account}` } } }, { $unwind: "$lines" }, { $match: lineMatch },
    { $project: { entryDate: 1, reference: 1, label: 1, line: "$lines" } },
    { $sort: { entryDate: 1 } }, { $limit: 2000 },
  ]);
  const ids = [...new Set(rows.map(r => r.line.thirdPartyId).filter(Boolean).map(String))];
  const [clients, suppliers] = await Promise.all([
    ClientModel.find({ ...tenantFilter(auth), _id: { $in: ids } }).select("name").lean<Array<{ _id: unknown; name: string }>>(),
    SupplierModel.find({ ...tenantFilter(auth), _id: { $in: ids } }).select("name").lean<Array<{ _id: unknown; name: string }>>(),
  ]);
  const names = new Map([...clients, ...suppliers].map(t => [String(t._id), t.name]));
  return ok(rows.map(r => ({
    entryId: String(r._id), date: r.entryDate, reference: r.reference, label: r.label, account: r.line.accountCode,
    debit: r.line.debit, credit: r.line.credit, thirdPartyId: r.line.thirdPartyId ? String(r.line.thirdPartyId) : null,
    thirdParty: r.line.thirdPartyId ? names.get(String(r.line.thirdPartyId)) ?? null : null,
    isLettered: !!r.line.letterRef, letterRef: r.line.letterRef ?? null,
  })));
});

/**
 * POST { entryIds, account, letterRef? } — lettre des écritures dont les lignes
 * sur ce compte s'équilibrent. Refuse une écriture déjà lettrée et une
 * référence déjà utilisée ; la référence est générée si absente.
 */
export const POST = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.entryIds) ? [...new Set(body.entryIds.map(String))] as string[] : [];
  if (ids.length < 2) return badRequest("Au moins 2 écritures requises pour le lettrage");
  if (ids.some(id => !Types.ObjectId.isValid(id))) return badRequest("Écriture invalide.");
  const account = String(body.account ?? "4").replace(/\D/g, "");
  if (!/^4\d{0,7}$/.test(account)) return badRequest("Le lettrage porte sur un compte de tiers (classe 4).");
  await connectDB();
  await migrateLegacyLettering(auth.tenantId);
  let result: { letterRef: string; lines: number };
  try {
    result = await withTransaction(session => applyLetter(auth.tenantId, ids, account, { letterRef: body.letterRef ? String(body.letterRef) : undefined, session }));
  } catch (e) {
    if (e instanceof BusinessRuleError) return /déjà utilisée|vient d'être/.test(e.message) ? conflict(e.message) : badRequest(e.message);
    throw e;
  }
  await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { action: "lettrage", entryIds: ids, letterRef: result.letterRef, account } });
  return ok({ letterRef: result.letterRef, message: `${result.lines} écritures lettrées (${result.letterRef})` });
});

// DELETE /api/accounting-entries/lettrage?ref=… — annuler un lettrage
export const DELETE = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const letterRef = new URL(req.url).searchParams.get("ref");
  if (!letterRef) return badRequest("Référence de lettrage requise (?ref=…)");
  await connectDB();
  await migrateLegacyLettering(auth.tenantId);
  const count = await withTransaction(session => removeLetter(auth.tenantId, letterRef, session));
  await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { action: "delettrage", letterRef, count } });
  return ok({ message: `Lettrage '${letterRef}' annulé sur ${count} écriture(s)` });
});
