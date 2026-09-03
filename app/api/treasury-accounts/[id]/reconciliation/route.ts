import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BankStatementLineModel } from "@/models/BankStatementLine";
import {
  reconciliationSummary, suggestMatches,
  type MovementLike, type StatementLineLike,
} from "@/lib/reconciliation";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/treasury-accounts/:id/reconciliation
 *
 * Situation d'un compte à une date d'arrêté : solde comptable, solde bancaire,
 * écart, et propositions d'appariement.
 *
 * Tout est calculé à la volée. Le solde n'est **jamais** stocké : le champ
 * `balance` du compte était un nombre saisi une fois que rien ne mettait à
 * jour, et qui dérivait indéfiniment. Seul `openingBalance` est déclaré — le
 * solde à une date connue —, le reste se déduit des mouvements.
 */
export const GET = withAuth("treasuryAccounts", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const account = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<{ _id: unknown; label: string; type: string; openingBalance?: number; balance?: number } | null>();
  if (!account) return notFound("Compte introuvable");

  const url = new URL(req.url);
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam ? new Date(asOfParam) : new Date();
  if (Number.isNaN(asOf.getTime())) return notFound("Date d'arrêté invalide");

  const [movements, lines] = await Promise.all([
    TreasuryMovementModel.find({ ...tenantFilter(auth), accountId: params.id })
      .sort({ date: -1 }).limit(500).lean<MovementLike[]>(),
    BankStatementLineModel.find({ ...tenantFilter(auth), accountId: params.id })
      .sort({ date: -1 }).limit(500).lean<StatementLineLike[]>(),
  ]);

  // Reprise : les comptes créés avant ce module portent leur solde dans
  // `balance`. On l'utilise comme solde d'ouverture tant qu'aucun n'est
  // déclaré, plutôt que de repartir de zéro et d'afficher un écart massif.
  const openingBalance = account.openingBalance ?? account.balance ?? 0;

  return ok({
    account: { _id: account._id, label: account.label, type: account.type },
    asOf: asOf.toISOString(),
    summary: reconciliationSummary(openingBalance, movements, lines, asOf),
    suggestions: suggestMatches(movements, lines),
    movements,
    lines,
  });
});
