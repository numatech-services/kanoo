import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { unknownAccounts } from "@/lib/ledger";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
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
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ reference: rx }, { label: rx }, { "lines.accountLabel": rx }];
  }
  const account = url.searchParams.get("account");
  if (account && /^\d{1,8}$/.test(account)) filter["lines.accountCode"] = { $regex: `^${account}` };
  const projectId = url.searchParams.get("projectId");
  if (projectId && Types.ObjectId.isValid(projectId)) filter["lines.projectId"] = new Types.ObjectId(projectId);

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

const JOURNALS = ["AC", "VT", "BQ", "CA", "OD"];

/**
 * POST — saisie manuelle. Contrôles : journal, comptes du plan (actifs),
 * montants positifs, une ligne est au débit OU au crédit, équilibre, et
 * imputation analytique (projet, secteur, service) valide.
 */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const missing = requireFields(body, ["journalCode", "entryDate", "reference", "label", "lines"]);
  if (missing) return badRequest(missing);
  if (!JOURNALS.includes(body.journalCode)) return badRequest("Journal inconnu (AC, VT, BQ, CA ou OD).");
  const entryDate = new Date(body.entryDate);
  if (isNaN(entryDate.getTime())) return badRequest("Date invalide.");
  if (!Array.isArray(body.lines) || body.lines.length < 2) return badRequest("Une écriture doit contenir au moins 2 lignes");

  const lines = [];
  for (const [i, l] of (body.lines as Array<Record<string, unknown>>).entries()) {
    const debit = Math.round(Number(l.debit) || 0), credit = Math.round(Number(l.credit) || 0);
    const code = String(l.accountCode ?? "").trim();
    if (debit < 0 || credit < 0) return badRequest(`Ligne ${i + 1} : montant négatif.`);
    if ((debit > 0) === (credit > 0)) return badRequest(`Ligne ${i + 1} : un montant au débit OU au crédit.`);
    if (!/^[1-9]\d{2,7}$/.test(code)) return badRequest(`Ligne ${i + 1} : numéro de compte invalide.`);
    lines.push({ accountCode: code, accountLabel: String(l.accountLabel ?? "").trim().slice(0, 160) || code, debit, credit, ...pickImputation(l) });
  }
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebit !== totalCredit) return badRequest(`Écriture déséquilibrée : débits=${totalDebit} ≠ crédits=${totalCredit}`);

  await connectDB();
  const unknown = await unknownAccounts(auth.tenantId, lines.map(l => l.accountCode));
  if (unknown.length) return badRequest(`Compte(s) absent(s) du plan comptable : ${unknown.join(", ")}. Ajoutez-les dans « Plan comptable ».`);
  const impErr = await checkImputations(auth.tenantId, lines);
  if (impErr) return badRequest(impErr);

  const entry = await AccountingEntryModel.create({
    tenantId: auth.tenantId, journalCode: body.journalCode, entryDate,
    reference: String(body.reference).slice(0, 80), label: String(body.label).slice(0, 300),
    lines, linkedDocType: "manual", createdBy: auth.userId, isLettered: false,
  });

  await logAudit(auth, "CREATE", "accountingEntries", {
    resourceId: entry._id.toString(),
    after: { journalCode: entry.journalCode, reference: entry.reference, totalDebit },
  });
  return created(entry);
});
