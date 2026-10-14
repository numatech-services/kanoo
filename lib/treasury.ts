import { Types, type ClientSession } from "mongoose";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { LedgerAccountModel } from "@/models/LedgerAccount";
import { ensureLedger } from "@/lib/ledger";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";

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
    // ObjectId obligatoires : aggregate ne convertit pas, et des chaînes ne
    // correspondaient à aucun mouvement (solde = solde d'ouverture, toujours).
    { $match: { tenantId: new Types.ObjectId(String(tenantId)), accountId: new Types.ObjectId(String(accountId)) } },
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

/**
 * Compte du plan SYSCOHADA qui porte un compte de trésorerie : la banque (521),
 * la caisse (571) ou le porte-monnaie électronique (5218). L'écriture doit
 * créditer le compte réellement mouvementé — une sortie de caisse passée en
 * « Banque » fausse le rapprochement des deux.
 */
export type TreasuryKind = "bank" | "cash" | "mobile_money";
export function ledgerFor(kind?: string | null): { accountCode: string; accountLabel: string; journalCode: "BQ" | "CA" } {
  if (kind === "cash") return { accountCode: "571000", accountLabel: "Caisse", journalCode: "CA" };
  if (kind === "mobile_money") return { accountCode: "521800", accountLabel: "Monnaie électronique (mobile money)", journalCode: "BQ" };
  return { accountCode: "521000", accountLabel: "Banque", journalCode: "BQ" };
}

/** Type d'un compte de trésorerie de l'organisation (null s'il n'existe pas). */
export async function treasuryKind(tenantId: string, accountId: unknown, session?: ClientSession): Promise<TreasuryKind | null> {
  if (!accountId) return null;
  const a = await TreasuryAccountModel.findOne({ _id: accountId, tenantId }).select("type")
    .session(session ?? null).lean<{ type?: TreasuryKind } | null>();
  return a?.type ?? null;
}

const LEDGER_PREFIX: Record<TreasuryKind, string> = { bank: "5211", mobile_money: "5218", cash: "5711" };

/**
 * Compte comptable et journal d'un compte de trésorerie : son compte dédié
 * s'il en a un, sinon le compte général de son type (comptes anciens).
 */
export async function treasuryLedger(tenantId: string, accountId: unknown, session?: ClientSession):
  Promise<{ kind: TreasuryKind; accountCode: string; accountLabel: string; journalCode: "BQ" | "CA" } | null> {
  if (!accountId) return null;
  const a = await TreasuryAccountModel.findOne({ _id: accountId, tenantId }).select("type label ledgerCode")
    .session(session ?? null).lean<{ type: TreasuryKind; label: string; ledgerCode?: string } | null>();
  if (!a) return null;
  const base = ledgerFor(a.type);
  return a.ledgerCode
    ? { kind: a.type, accountCode: a.ledgerCode, accountLabel: a.label, journalCode: base.journalCode }
    : { kind: a.type, ...base };
}

/** Prochain compte dédié libre pour ce type (521101, 521102…). */
export async function nextLedgerCode(tenantId: string, kind: TreasuryKind, session?: ClientSession): Promise<string> {
  const prefix = LEDGER_PREFIX[kind];
  const used = await TreasuryAccountModel.find({ tenantId, ledgerCode: { $regex: `^${prefix}` } }).select("ledgerCode")
    .session(session ?? null).lean<Array<{ ledgerCode: string }>>();
  const max = used.reduce((m, a) => Math.max(m, Number(a.ledgerCode.slice(4)) || 0), 0);
  if (max >= 99) throw new BusinessRuleError("Plus de 99 comptes de ce type : regroupez-en avant d'en créer un autre.");
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

/** Inscrit le compte dédié au plan comptable de l'organisation. */
export async function registerLedgerAccount(tenantId: string, code: string, label: string, session?: ClientSession) {
  // Le plan SYSCOHADA s'initialise à la première lecture s'il est vide : y
  // inscrire d'abord ce seul compte l'aurait laissé vide de tout le reste.
  await ensureLedger(tenantId);
  await LedgerAccountModel.updateOne(
    { tenantId, code },
    { $setOnInsert: { tenantId, code, label: label.slice(0, 160), accountClass: code[0], isActive: true } },
    { upsert: true, session },
  );
}

/**
 * Donne un compte dédié à un compte de trésorerie ancien. Le solde porté
 * jusque-là par le compte général (somme de ses mouvements, qui ont chacun leur
 * écriture) y est reclassé par une OD, pour que le compte dédié reflète tout
 * l'historique. Le solde d'ouverture, jamais écrit en comptabilité, n'est pas
 * concerné.
 */
export async function assignLedgerCode(actor: { tenantId: string; userId: string }, accountId: unknown, session?: ClientSession) {
  const a = await TreasuryAccountModel.findOne({ _id: accountId, tenantId: actor.tenantId }).session(session ?? null);
  if (!a) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  if (a.ledgerCode) return { code: a.ledgerCode as string, reclassed: 0 };
  const code = await nextLedgerCode(actor.tenantId, a.type, session);
  a.ledgerCode = code;
  await a.save({ session });
  await registerLedgerAccount(actor.tenantId, code, a.label, session);
  const [agg] = await TreasuryMovementModel.aggregate<{ total: number }>([
    { $match: { tenantId: new Types.ObjectId(actor.tenantId), accountId: new Types.ObjectId(String(accountId)) } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]).session(session ?? null);
  const total = Math.round(agg?.total ?? 0);
  if (total !== 0) {
    const general = ledgerFor(a.type);
    const amt = Math.abs(total);
    const dedicated = { accountCode: code, accountLabel: a.label };
    await AccountingEntryModel.create([{
      tenantId: actor.tenantId, journalCode: "OD", entryDate: new Date(), reference: `RECL-${code}`,
      label: `Reclassement de ${a.label} sur son compte dédié ${code}`,
      lines: total > 0
        ? [{ ...dedicated, debit: amt, credit: 0 }, { accountCode: general.accountCode, accountLabel: general.accountLabel, debit: 0, credit: amt }]
        : [{ accountCode: general.accountCode, accountLabel: general.accountLabel, debit: amt, credit: 0 }, { ...dedicated, debit: 0, credit: amt }],
      linkedDocType: "treasury", linkedDocId: a._id, createdBy: actor.userId,
    }], { session });
  }
  return { code, reclassed: total };
}
