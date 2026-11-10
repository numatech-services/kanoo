import { NextRequest } from "next/server";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { ledgerFor } from "@/lib/treasury";
import { withTransaction } from "@/lib/db";
import { Types } from "mongoose";
import { unknownAccounts } from "@/lib/ledger";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { parseFlow, parsePeriod, periodMatch, flowTotals } from "@/lib/flow-filter";

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
  if (from || to) Object.assign(filter, periodMatch("entryDate", parsePeriod(url)));
  // Base des totaux recettes / dépenses : période, journal, projet (pas la recherche).
  const base: Record<string, unknown> = { ...filter };
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ reference: rx }, { label: rx }, { "lines.accountLabel": rx }];
  }
  const account = url.searchParams.get("account");
  if (account && /^\d{1,8}$/.test(account)) filter["lines.accountCode"] = { $regex: `^${account}` };
  const projectId = url.searchParams.get("projectId");
  const project = projectId && Types.ObjectId.isValid(projectId) ? new Types.ObjectId(projectId) : null;
  if (project) { filter["lines.projectId"] = project; base["lines.projectId"] = project; }
  // Recettes = écritures portant des produits (classe 7), dépenses = des charges (classe 6).
  const flow = parseFlow(url.searchParams.get("flow"));
  if (flow) filter.$and = [{ lines: { $elemMatch: { accountCode: { $regex: flow === "in" ? "^7" : "^6" }, ...(project ? { projectId: project } : {}) } } }];

  const [items, total, sums] = await Promise.all([
    AccountingEntryModel.find(filter)
      .sort({ entryDate: -1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    AccountingEntryModel.countDocuments(filter),
    AccountingEntryModel.aggregate<{ _id: string; net: number }>([
      { $match: base },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $regex: "^[67]" }, ...(project ? { "lines.projectId": project } : {}) } },
      { $group: { _id: { $substrCP: ["$lines.accountCode", 0, 1] }, net: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } } } },
    ]),
  ]);
  const net = (c: string) => sums.find(x => x._id === c)?.net ?? 0;
  return paginatedResponse(items, total, pagination, { totals: flowTotals(-net("7"), net("6")) });
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

  const lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number } & ReturnType<typeof pickImputation>> = [];
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

  // Banque et caisse (52…, 57…) : la saisie est libre, et chaque ligne crée le
  // mouvement du compte de trésorerie correspondant. Comptabilité et solde du
  // compte restent égaux, le rapprochement bancaire continue de fonctionner.
  const cashLines = lines.filter(l => /^5[27]/.test(l.accountCode));
  const targets = new Map<string, unknown>();
  if (cashLines.length) {
    const accounts = await TreasuryAccountModel.find({ ...tenantFilter(auth), isActive: { $ne: false } }).select("label type ledgerCode").lean<Array<{ _id: unknown; label: string; type: string; ledgerCode?: string }>>();
    const byCode = new Map<string, Array<{ _id: unknown; label: string }>>();
    for (const a of accounts) {
      const code = a.ledgerCode || ledgerFor(a.type).accountCode;
      byCode.set(code, [...(byCode.get(code) ?? []), a]);
    }
    for (const l of cashLines) {
      const found = byCode.get(l.accountCode) ?? [];
      if (found.length === 1) { targets.set(l.accountCode, found[0]._id); continue; }
      const list = accounts.map(a => `${a.label} (${a.ledgerCode || ledgerFor(a.type).accountCode})`).join(", ");
      return badRequest(found.length
        ? `Compte ${l.accountCode} partagé par plusieurs comptes de trésorerie : utilisez le compte propre à la caisse ou à la banque. Comptes : ${list}.`
        : `Compte ${l.accountCode} : aucune caisse ni banque rattachée. Créez-la dans Trésorerie ou utilisez l'un de ces comptes : ${list || "aucun"}.`);
    }
  }

  const entry = await withTransaction(async session => {
    const [e] = await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: body.journalCode, entryDate,
      reference: String(body.reference).slice(0, 80), label: String(body.label).slice(0, 300),
      lines, linkedDocType: "manual", createdBy: auth.userId, isLettered: false,
    }], { session });
    for (const l of cashLines) {
      await TreasuryMovementModel.create([{
        tenantId: auth.tenantId, accountId: targets.get(l.accountCode), date: entryDate, amount: l.debit - l.credit,
        label: String(body.label).slice(0, 200), reference: String(body.reference).slice(0, 80), source: "manual",
        linkedDocType: "manual", linkedDocId: e._id, entryId: e._id, createdBy: auth.userId,
      }], { session });
    }
    return e;
  });

  await logAudit(auth, "CREATE", "accountingEntries", {
    resourceId: entry._id.toString(),
    after: { journalCode: entry.journalCode, reference: entry.reference, totalDebit },
  });
  return created(entry);
});
