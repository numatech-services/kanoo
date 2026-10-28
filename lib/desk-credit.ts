import { Types, type ClientSession } from "mongoose";
import { DeskCustomerModel, DeskCustomerMoveModel } from "@/models/DeskCustomer";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BusinessRuleError } from "@/lib/errors";
import { accountForMethod } from "@/lib/comptoir";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { assertDayOpen, CREDIT_ACCOUNT } from "@/lib/comptoir-sale";
import type { TokenPayload } from "@/lib/auth";

const METHODS = ["cash", "orange_money", "card", "bank_transfer", "check", "other"];

/**
 * Règlement (total ou partiel) d'une ardoise : encaissement en caisse,
 * écriture (trésorerie / 411800), mouvement d'ardoise, solde réduit.
 */
export async function settleCredit(auth: TokenPayload, customerId: string, input: { amount: number; method?: string; date?: string }, session?: ClientSession) {
  const tenantId = auth.tenantId;
  const c = await DeskCustomerModel.findOne({ _id: customerId, tenantId }).session(session ?? null)
    .lean<{ _id: Types.ObjectId; deskId: Types.ObjectId; name: string; balance: number } | null>();
  if (!c) throw new BusinessRuleError("Client introuvable.");
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  if (amount > c.balance) throw new BusinessRuleError(`Le règlement dépasse l'ardoise (${c.balance.toLocaleString("fr-FR")} FCFA).`);
  const method = METHODS.includes(String(input.method)) ? String(input.method) : "cash";
  const date = input.date ? new Date(input.date) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  await assertDayOpen(tenantId, c.deskId, date, session);
  const claim = await DeskCustomerModel.updateOne({ _id: c._id, balance: { $gte: amount } },
    { $inc: { balance: -amount }, ...(amount === c.balance ? { $unset: { oldestDebtAt: 1 } } : {}) }, { session });
  if (claim.modifiedCount !== 1) throw new BusinessRuleError("L'ardoise vient de changer : recommencez.");
  const label = `Règlement ardoise — ${c.name}`;
  const [entry] = await ActivityCashEntryModel.create([{ tenantId, deskId: c.deskId, direction: "in", amount, label, method, date, customerId: c._id, createdBy: auth.userId }], { session });
  await DeskCustomerMoveModel.create([{ tenantId, deskId: c.deskId, customerId: c._id, kind: "payment", amount: -amount, cashEntryId: entry._id, method, date, label, createdBy: auth.userId }], { session });

  const desk = await ActivityDeskModel.findOne({ _id: c.deskId, tenantId }).select("name treasuryAccountId").session(session ?? null).lean<{ name: string; treasuryAccountId?: unknown } | null>();
  if (desk?.treasuryAccountId) {
    const accountId = await accountForMethod(tenantId, desk.treasuryAccountId, method, session);
    const ledger = await treasuryLedger(tenantId, accountId, session);
    if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
    await registerLedgerAccount(tenantId, CREDIT_ACCOUNT.accountCode, CREDIT_ACCOUNT.accountLabel, session);
    const [je] = await AccountingEntryModel.create([{
      tenantId, journalCode: ledger.journalCode, entryDate: date, reference: `ARD-${String(entry._id).slice(-6).toUpperCase()}`, label: `${desk.name} — ${label}`,
      lines: [{ accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 }, { ...CREDIT_ACCOUNT, debit: 0, credit: amount }],
      linkedDocType: "desk_cash", linkedDocId: entry._id, createdBy: auth.userId,
    }], { session });
    const [mv] = await TreasuryMovementModel.create([{ tenantId, accountId, date, amount, label: `${desk.name} — ${label}`, reference: je.reference, source: "payment", linkedDocType: "desk_cash", linkedDocId: entry._id, createdBy: auth.userId }], { session });
    await ActivityCashEntryModel.updateOne({ _id: entry._id }, { $set: { entryId: je._id, movementId: mv._id } }, { session });
  }
  return { entryId: entry._id, balance: c.balance - amount };
}
