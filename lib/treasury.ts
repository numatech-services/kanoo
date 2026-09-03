import type { ClientSession } from "mongoose";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";

/**
 * Solde d'un compte de trésorerie.
 *
 * Le solde n'est **pas** un champ : c'est le solde d'ouverture plus la somme
 * des mouvements. Le champ `balance` du document était incrémenté par deux
 * routes seulement — la paie et les charges récurrentes — et par aucune autre,
 * jamais par un encaissement. Un compte pouvait ainsi baisser à chaque salaire
 * versé sans jamais remonter d'une facture réglée.
 *
 * Il n'est plus lu que comme solde d'ouverture de reprise, pour les comptes
 * créés avant le module de rapprochement.
 */
export async function accountBalance(
  tenantId: string,
  accountId: string,
  session?: ClientSession
): Promise<{ balance: number; openingBalance: number } | null> {
  const account = await TreasuryAccountModel
    .findOne({ _id: accountId, tenantId })
    .session(session ?? null)
    .lean<{ openingBalance?: number; balance?: number } | null>();
  if (!account) return null;

  const openingBalance = account.openingBalance ?? account.balance ?? 0;
  const [agg] = await TreasuryMovementModel.aggregate<{ total: number }>([
    { $match: { tenantId, accountId: String(accountId) } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]).session(session ?? null);

  return { openingBalance, balance: openingBalance + (agg?.total ?? 0) };
}

export interface MovementInput {
  tenantId: string;
  accountId: string;
  date: Date;
  /** Signé : positif pour un encaissement, négatif pour un décaissement. */
  amount: number;
  label: string;
  reference?: string;
  source: "payment" | "payroll" | "expense" | "transfer" | "manual" | "import";
  linkedDocType?: string;
  linkedDocId?: unknown;
  createdBy: string;
}

/**
 * Enregistre un mouvement. Toujours appelé dans la transaction du document qui
 * l'engendre : un règlement écrit sans son mouvement produirait un écart
 * permanent, qu'aucun rapprochement ne saurait ensuite expliquer.
 */
export async function recordMovement(input: MovementInput, session?: ClientSession) {
  const [movement] = await TreasuryMovementModel.create([input], { session });
  return movement;
}
