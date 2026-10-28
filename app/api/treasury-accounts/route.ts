import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { withTransaction } from "@/lib/db";
import { nextLedgerCode, registerLedgerAccount } from "@/lib/treasury";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BankStatementLineModel } from "@/models/BankStatementLine";
import { TokenPayload } from "@/lib/auth";
import { isCurrency, foreignAmount } from "@/lib/currency";

interface AccountRow {
  _id: mongoose.Types.ObjectId;
  label: string;
  type: string;
  openingBalance?: number;
  /** @deprecated Solde saisi des comptes créés avant le module de rapprochement. */
  balance?: number;
  currency?: string;
  exchangeRate?: number;
}

/**
 * GET /api/treasury-accounts
 *
 * Le solde renvoyé est **calculé** : solde d'ouverture + somme des mouvements.
 * Le champ `balance` du document n'était mis à jour par aucune route ; il n'est
 * plus lu que comme solde d'ouverture de reprise, pour les comptes antérieurs.
 */
export const GET = withAuth("treasuryAccounts", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  // Comptes désactivés : masqués sauf demande explicite (?all=true).
  const all = new URL(req.url).searchParams.get("all") === "true";
  const filter = { ...tenantFilter(auth), ...(all ? {} : { isActive: true }) };

  const [items, total] = await Promise.all([
    TreasuryAccountModel.find(filter).sort({ label: 1 })
      .skip(pagination.skip).limit(pagination.limit).lean<AccountRow[]>(),
    TreasuryAccountModel.countDocuments(filter),
  ]);

  // ObjectId, pas chaîne : `aggregate` ne convertit pas les types, et un $in de
  // chaînes contre des ObjectId ne trouvait aucun mouvement — chaque solde
  // affiché valait le seul solde d'ouverture.
  const ids = items.map(a => new mongoose.Types.ObjectId(String(a._id)));
  const [movementSums, pendingCounts, lineCounts] = await Promise.all([
    TreasuryMovementModel.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { ...tenantFilter(auth), accountId: { $in: ids } } },
      { $group: { _id: "$accountId", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    TreasuryMovementModel.aggregate<{ _id: string; count: number }>([
      { $match: { ...tenantFilter(auth), accountId: { $in: ids }, statementLineId: { $exists: false } } },
      { $group: { _id: "$accountId", count: { $sum: 1 } } },
    ]),
    BankStatementLineModel.aggregate<{ _id: string; count: number }>([
      { $match: { ...tenantFilter(auth), accountId: { $in: ids } } },
      { $group: { _id: "$accountId", count: { $sum: 1 } } },
    ]),
  ]);

  const sumBy = new Map(movementSums.map(r => [String(r._id), r]));
  const pendingBy = new Map(pendingCounts.map(r => [String(r._id), r.count]));
  const linesBy = new Map(lineCounts.map(r => [String(r._id), r.count]));

  const enriched = items.map(a => {
    const key = String(a._id);
    const openingBalance = a.openingBalance ?? a.balance ?? 0;
    const agg = sumBy.get(key);
    return {
      ...a,
      openingBalance,
      balance: openingBalance + (agg?.total ?? 0),
      // Solde en devise (compte suivi en contre-valeur FCFA), si le cours est connu.
      foreignBalance: foreignAmount(openingBalance + (agg?.total ?? 0), a.currency, a.exchangeRate),
      movementCount: agg?.count ?? 0,
      pendingCount: pendingBy.get(key) ?? 0,
      statementLineCount: linesBy.get(key) ?? 0,
    };
  });

  return paginatedResponse(enriched, total, pagination);
});

export const POST = withAuth("treasuryAccounts", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["label", "type"]);
  if (err) return badRequest(err);

  // Ce qui est saisi à la création est un solde d'**ouverture**, à une date
  // donnée. Le stocker dans `balance` reproduirait le défaut d'origine : un
  // nombre figé que plus rien ne met à jour.
  if (!["bank", "cash", "mobile_money"].includes(body.type)) return badRequest("Type de compte invalide (banque, caisse, mobile money).");
  if (body.currency && !isCurrency(body.currency)) return badRequest("Devise inconnue.");
  // Chaque compte reçoit son compte comptable (5211xx, 5218xx, 5711xx) : le
  // grand livre suit chaque banque et chaque caisse séparément.
  const account = await withTransaction(async session => {
    const ledgerCode = await nextLedgerCode(auth.tenantId, body.type, session);
    const [a] = await TreasuryAccountModel.create([{
      label: body.label,
      type: body.type,
      currency: body.currency || "XOF",
      ...(Number(body.exchangeRate) > 0 ? { exchangeRate: Number(body.exchangeRate) } : {}),
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      openingBalance: Number(body.openingBalance ?? body.balance ?? 0),
      openingDate: body.openingDate ? new Date(body.openingDate) : new Date(),
      tenantId: auth.tenantId,
      ledgerCode,
    }], { session });
    await registerLedgerAccount(auth.tenantId, ledgerCode, String(body.label), session);
    return a;
  });
  return created(account);
});
