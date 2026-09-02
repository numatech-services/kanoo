import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, ok, created, badRequest, getPagination,
  paginatedResponse, tenantFilter, requireFields
} from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const journal = url.searchParams.get("journal");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const search = url.searchParams.get("search") || "";
  const lettered = url.searchParams.get("lettered");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (journal) filter.journalCode = journal;
  if (lettered !== null && lettered !== undefined) filter.isLettered = lettered === "true";
  if (from || to) {
    filter.entryDate = {};
    if (from) (filter.entryDate as Record<string, unknown>).$gte = new Date(from);
    if (to) (filter.entryDate as Record<string, unknown>).$lte = new Date(to + "T23:59:59");
  }
  if (search) {
    filter.$or = [
      { reference: { $regex: search, $options: "i" } },
      { label: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    AccountingEntryModel.find(filter)
      .sort({ entryDate: -1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    AccountingEntryModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["journalCode", "entryDate", "reference", "label", "lines"]);
  if (missing) return badRequest(missing);

  if (!Array.isArray(body.lines) || body.lines.length < 2) {
    return badRequest("Une écriture doit contenir au moins 2 lignes");
  }

  const totalDebit = body.lines.reduce((s: number, l: { debit?: number }) => s + (l.debit || 0), 0);
  const totalCredit = body.lines.reduce((s: number, l: { credit?: number }) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 1) {
    return badRequest(`Écriture déséquilibrée : débits=${totalDebit} ≠ crédits=${totalCredit}`);
  }

  await connectDB();

  const entry = await AccountingEntryModel.create({
    ...body,
    tenantId: auth.tenantId,
    createdBy: auth.userId,
    isLettered: false,
  });

  await logAudit(auth, "CREATE", "accountingEntries", {
    resourceId: entry._id.toString(),
    after: { journalCode: entry.journalCode, reference: entry.reference, totalDebit },
  });

  return created(entry);
});
