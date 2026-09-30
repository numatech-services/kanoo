import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
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
  const match: Record<string, unknown> = { ...tenantFilter(auth), "lines.accountCode": { $regex: `^${account}` } };
  if (state === "open") match.isLettered = { $ne: true };
  if (state === "lettered") match.isLettered = true;
  const rows = await AccountingEntryModel.aggregate<{ _id: Types.ObjectId; entryDate: Date; reference: string; label: string; isLettered?: boolean; letterRef?: string; line: { accountCode: string; debit: number; credit: number; thirdPartyId?: Types.ObjectId } }>([
    { $match: match }, { $unwind: "$lines" }, { $match: { "lines.accountCode": { $regex: `^${account}` } } },
    { $project: { entryDate: 1, reference: 1, label: 1, isLettered: 1, letterRef: 1, line: "$lines" } },
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
    isLettered: !!r.isLettered, letterRef: r.letterRef ?? null,
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

  const entries = await AccountingEntryModel.find({ _id: { $in: ids }, ...tenantFilter(auth) });
  if (entries.length !== ids.length) return badRequest("Certaines écritures sont introuvables ou n'appartiennent pas à cette organisation");
  const already = entries.find(e => e.isLettered);
  if (already) return conflict(`L'écriture ${already.reference} est déjà lettrée (${already.letterRef}). Délettrez-la d'abord.`);

  let totalDebit = 0, totalCredit = 0;
  for (const entry of entries) for (const line of entry.lines) if (line.accountCode.startsWith(account)) { totalDebit += line.debit; totalCredit += line.credit; }
  if (totalDebit === 0 && totalCredit === 0) return badRequest(`Aucune de ces écritures ne mouvemente le compte ${account}.`);
  if (Math.abs(totalDebit - totalCredit) > 1) return badRequest(`Lettrage déséquilibré sur ${account} : débits=${totalDebit} ≠ crédits=${totalCredit}`);

  let letterRef = String(body.letterRef ?? "").trim().slice(0, 40);
  if (letterRef) {
    if (await AccountingEntryModel.exists({ ...tenantFilter(auth), letterRef })) return conflict(`La référence ${letterRef} est déjà utilisée.`);
  } else {
    const year = new Date().getFullYear();
    const n = (await AccountingEntryModel.distinct("letterRef", { ...tenantFilter(auth), letterRef: { $regex: `^LET-${year}-` } })).length + 1;
    letterRef = `LET-${year}-${String(n).padStart(4, "0")}`;
  }

  await AccountingEntryModel.updateMany({ _id: { $in: ids }, ...tenantFilter(auth) }, { $set: { isLettered: true, letterRef } });
  await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { action: "lettrage", entryIds: ids, letterRef, account } });
  return ok({ letterRef, message: `${entries.length} écritures lettrées (${letterRef})` });
});

// DELETE /api/accounting-entries/lettrage?ref=… — annuler un lettrage
export const DELETE = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const letterRef = new URL(req.url).searchParams.get("ref");
  if (!letterRef) return badRequest("Référence de lettrage requise (?ref=…)");
  await connectDB();
  const result = await AccountingEntryModel.updateMany({ ...tenantFilter(auth), letterRef }, { $set: { isLettered: false }, $unset: { letterRef: "" } });
  await logAudit(auth, "UPDATE", "accountingEntries", { metadata: { action: "delettrage", letterRef, count: result.modifiedCount } });
  return ok({ message: `Lettrage '${letterRef}' annulé sur ${result.modifiedCount} écriture(s)` });
});
