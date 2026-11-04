import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { CashSessionModel } from "@/models/CashSession";
import { DeskFundingModel, type IDeskFunding } from "@/models/DeskFunding";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BusinessRuleError } from "@/lib/errors";
import { accountBalance, registerLedgerAccount, treasuryLedger } from "@/lib/treasury";
import { postCashFlow, reverseCashFlow } from "@/lib/cash-posting";
import { assertDayOpen, assertMonthOpen } from "@/lib/comptoir-sale";
import { localDay } from "@/lib/format";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
export type FundingNature = NonNullable<IDeskFunding["nature"]>;

/**
 * Origine de l'argent remis à un site, et son compte de contrepartie
 * (à confirmer par la comptable). Un apport ou une origine inconnue reste en
 * compte d'attente jusqu'à sa qualification : jamais en produit.
 */
export const FUNDING_NATURES: Record<FundingNature, { label: string; repayable: boolean; account?: { accountCode: string; accountLabel: string } }> = {
  transfer: { label: "Virement d'un compte de l'entreprise", repayable: false },
  advance: { label: "Avance à rembourser (associé, dirigeant)", repayable: true, account: { accountCode: "462000", accountLabel: "Associés, comptes courants" } },
  contribution: { label: "Apport, à qualifier par la comptable", repayable: false, account: { accountCode: "471000", accountLabel: "Compte d'attente — apport à qualifier" } },
  to_classify: { label: "Origine à préciser", repayable: false, account: { accountCode: "471000", accountLabel: "Compte d'attente — fonds de départ à classer" } },
};
export const OPENING_KINDS = { owner_paid: "Payé par le dirigeant", debt: "Dette fournisseur de départ", receivable: "Créance de départ", equipment: "Équipement déjà financé" } as const;

/** Virement interne entre deux comptes de trésorerie (585) : ni recette ni dépense. */
export async function transferFunds(auth: TokenPayload, input: { fromAccountId: unknown; toAccountId: unknown; amount: number; date: Date; label: string; reference?: string }, session?: ClientSession) {
  const [src, dst] = await Promise.all([treasuryLedger(auth.tenantId, input.fromAccountId, session), treasuryLedger(auth.tenantId, input.toAccountId, session)]);
  if (!src || !dst) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  if (String(input.fromAccountId) === String(input.toAccountId)) throw new BusinessRuleError("Choisissez deux comptes différents.");
  const bal = await accountBalance(auth.tenantId, String(input.fromAccountId), session);
  if (bal && bal.balance < input.amount) throw new BusinessRuleError(`Solde insuffisant sur le compte débité (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
  const { amount, date, label, reference } = input;
  const [entry] = await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: reference ?? `VIR-${localDay(date)}`, label,
    lines: [
      { accountCode: "585000", accountLabel: "Virements de fonds", debit: amount, credit: 0 },
      { accountCode: src.accountCode, accountLabel: src.accountLabel, debit: 0, credit: amount },
      { accountCode: dst.accountCode, accountLabel: dst.accountLabel, debit: amount, credit: 0 },
      { accountCode: "585000", accountLabel: "Virements de fonds", debit: 0, credit: amount },
    ],
    linkedDocType: "treasury", createdBy: auth.userId,
  }], { session });
  const base = { tenantId: auth.tenantId, date, label, reference, source: "transfer", linkedDocType: "transfer", entryId: entry._id, createdBy: auth.userId };
  const [out] = await TreasuryMovementModel.create([{ ...base, accountId: input.fromAccountId, amount: -amount }], { session });
  const [inn] = await TreasuryMovementModel.create([{ ...base, accountId: input.toAccountId, amount, transferPeerId: out._id }], { session });
  await TreasuryMovementModel.updateOne({ _id: out._id }, { $set: { transferPeerId: inn._id } }, { session });
  return { entryId: entry._id as Id, movementIds: [out._id as Id, inn._id as Id] };
}

/**
 * Argent remis à la caisse d'un site : écriture et mouvement de trésorerie,
 * jamais un chiffre d'affaires. Tant que la caisse n'est pas ouverte, ce
 * montant devient le fonds de caisse proposé à l'ouverture : il n'est saisi
 * qu'une fois. Caisse déjà ouverte : une entrée de caisse le reflète, pour que
 * les espèces attendues restent justes.
 */
export async function allocateFunds(auth: TokenPayload, deskId: string, input: { amount: number; nature: FundingNature; fromAccountId?: string; date?: Date; label?: string }, session?: ClientSession) {
  const run = async (s?: ClientSession) => {
    const amount = Math.round(Number(input.amount));
    if (!(amount > 0)) throw new BusinessRuleError("Montant de départ invalide.");
    const nature = FUNDING_NATURES[input.nature];
    if (!nature) throw new BusinessRuleError("Origine des fonds invalide.");
    const date = input.date ?? new Date();
    if (isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) throw new BusinessRuleError("Date invalide.");
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }).select("name treasuryAccountId").session(s ?? null).lean<{ _id: Id; name: string; treasuryAccountId?: Id } | null>();
    if (!desk) throw new BusinessRuleError("Site introuvable.");
    if (!desk.treasuryAccountId) throw new BusinessRuleError("Ce site n'a pas de caisse de trésorerie : reliez-en une avant de lui allouer de l'argent.");
    const open = await CashSessionModel.exists({ tenantId: auth.tenantId, deskId, status: "open" }).session(s ?? null);
    if (open) await assertDayOpen(auth.tenantId, deskId, date, s); else await assertMonthOpen(auth.tenantId, deskId, date, s);
    const label = `${input.label?.trim() || nature.label} — ${desk.name}`.slice(0, 200);
    let posted: { entryId: unknown; movementIds: unknown[] };
    if (input.nature === "transfer") {
      if (!input.fromAccountId || !Types.ObjectId.isValid(input.fromAccountId)) throw new BusinessRuleError("Choisissez le compte qui verse l'argent.");
      posted = await transferFunds(auth, { fromAccountId: input.fromAccountId, toAccountId: desk.treasuryAccountId, amount, date, label, reference: `DOT-${localDay(date)}` }, s);
    } else {
      await registerLedgerAccount(auth.tenantId, nature.account!.accountCode, nature.account!.accountLabel, s);
      const p = await postCashFlow({ tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: desk.treasuryAccountId, direction: "in", amount, date, label, reference: `DOT-${localDay(date)}`, account: nature.account!, linkedDocType: "desk_funding", linkedDocId: desk._id }, s);
      posted = { entryId: p.entryId, movementIds: [p.movementId] };
    }
    const cash = open ? (await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId, direction: "in", amount, label, method: "cash", category: "funding", date, entryId: posted.entryId, movementId: posted.movementIds[posted.movementIds.length - 1], createdBy: auth.userId }], { session: s }))[0] : null;
    const [f] = await DeskFundingModel.create([{
      tenantId: auth.tenantId, deskId, kind: "money", nature: input.nature, amount, date, label, repayable: nature.repayable,
      ...(input.nature === "transfer" ? { fromAccountId: input.fromAccountId } : { accountCode: nature.account!.accountCode }),
      entryId: posted.entryId, movementIds: posted.movementIds, ...(cash ? { cashEntryId: cash._id } : {}),
      // Un virement interne ou une avance n'ont rien à qualifier ; l'apport et l'origine inconnue, si.
      ...(input.nature === "transfer" || input.nature === "advance" ? { validatedAt: date, validatedBy: auth.userId } : {}), createdBy: auth.userId,
    }], { session: s });
    return f;
  };
  return session ? run(session) : withTransaction(run);
}

/** Ligne de la situation de départ sans mouvement d'argent : à passer par la comptable. */
export async function addOpeningLine(auth: TokenPayload, deskId: string, input: { kind: keyof typeof OPENING_KINDS; amount: number; label?: string; date?: Date; repayable?: boolean }) {
  if (!(input.kind in OPENING_KINDS)) throw new BusinessRuleError("Nature de la ligne invalide.");
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  if (!(await ActivityDeskModel.exists({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }))) throw new BusinessRuleError("Site introuvable.");
  return DeskFundingModel.create({ tenantId: auth.tenantId, deskId, kind: input.kind, amount, date: input.date ?? new Date(), label: (input.label?.trim() || OPENING_KINDS[input.kind]).slice(0, 200), repayable: input.kind === "owner_paid" ? input.repayable !== false : false, createdBy: auth.userId });
}

/**
 * Annulation d'une ligne saisie par erreur : extourne de l'écriture, mouvement
 * contraire, entrée de caisse annulée par une sortie miroir. Rien ne s'efface.
 * Refusée dès qu'un remboursement a eu lieu.
 */
export async function cancelFunding(auth: TokenPayload, id: string, reason: string) {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) throw new BusinessRuleError("Motif d'annulation obligatoire.");
  await withTransaction(async session => {
    const f = await DeskFundingModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, cancelledAt: { $exists: false }, repaid: 0 }, { $set: { cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: why } }, { session, new: true }).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Ligne introuvable, déjà annulée ou déjà remboursée en partie.");
    if (f.kind !== "money") return;
    await assertMonthOpen(auth.tenantId, f.deskId, new Date(), session);
    const [first, ...others] = f.movementIds;
    const source = f.nature === "transfer" ? "transfer" as const : "manual" as const;
    await reverseCashFlow({ tenantId: auth.tenantId, userId: auth.userId, entryId: f.entryId, movementId: first, reason: `Annulation : ${why}`, source }, session);
    for (const m of others) await reverseCashFlow({ tenantId: auth.tenantId, userId: auth.userId, movementId: m, reason: `Annulation : ${why}`, source }, session);
    if (f.cashEntryId) await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId: f.deskId, direction: "out", amount: f.amount, label: `Annulation : ${f.label}`.slice(0, 200), method: "cash", category: "cash_transfer", date: new Date(), entryId: f.entryId, createdBy: auth.userId }], { session });
  });
}

/** La comptable qualifie un apport ou une origine à classer : reclassement du compte d'attente vers le compte choisi. */
export async function qualifyFunding(auth: TokenPayload, id: string, accountCode: string, accountLabel?: string) {
  if (!/^[14]\d{2,7}$/.test(accountCode)) throw new BusinessRuleError("Compte de financement attendu (classe 1 ou 4).");
  await withTransaction(async session => {
    const f = await DeskFundingModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, kind: "money", validatedAt: { $exists: false }, cancelledAt: { $exists: false } }, { $set: { validatedAt: new Date(), validatedBy: auth.userId, accountCode } }, { session, new: false }).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Ligne introuvable ou déjà qualifiée.");
    const label = (accountLabel?.trim() || "Financement du site").slice(0, 160);
    await registerLedgerAccount(auth.tenantId, accountCode, label, session);
    if (f.accountCode !== accountCode) await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: "OD", entryDate: new Date(), reference: `QUAL-${String(f._id).slice(-6).toUpperCase()}`, label: `Qualification : ${f.label}`.slice(0, 300),
      lines: [{ accountCode: f.accountCode, accountLabel: "Compte d'attente", debit: f.amount, credit: 0 }, { accountCode, accountLabel: label, debit: 0, credit: f.amount }], linkedDocType: "desk_funding", createdBy: auth.userId,
    }], { session });
  });
}

/** Remboursement d'une avance : la dette diminue (462), sans charge ni dépense du site. */
export async function repayFunding(auth: TokenPayload, id: string, input: { amount: number; fromAccountId: string; date?: Date }) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  if (!Types.ObjectId.isValid(input.fromAccountId)) throw new BusinessRuleError("Choisissez le compte qui rembourse.");
  const date = input.date ?? new Date();
  await withTransaction(async session => {
    const f = await DeskFundingModel.findOne({ _id: id, tenantId: auth.tenantId, repayable: true, cancelledAt: { $exists: false } }).session(session ?? null).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Avance introuvable.");
    const left = f.amount - (f.repaid ?? 0);
    if (amount > left) throw new BusinessRuleError(`Il reste ${left.toLocaleString("fr-FR")} FCFA à rembourser.`);
    const bal = await accountBalance(auth.tenantId, input.fromAccountId, session);
    if (bal && bal.balance < amount) throw new BusinessRuleError(`Solde insuffisant (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
    const code = f.accountCode || FUNDING_NATURES.advance.account!.accountCode;
    await registerLedgerAccount(auth.tenantId, code, FUNDING_NATURES.advance.account!.accountLabel, session);
    const p = await postCashFlow({ tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: input.fromAccountId, direction: "out", amount, date, label: `Remboursement : ${f.label}`, reference: `RMB-${localDay(date)}`, account: { accountCode: code, accountLabel: FUNDING_NATURES.advance.account!.accountLabel }, linkedDocType: "desk_funding", linkedDocId: f._id }, session);
    const r = await DeskFundingModel.updateOne({ _id: f._id, repaid: f.repaid ?? 0 }, { $inc: { repaid: amount }, $push: { repayments: { date, amount, fromAccountId: new Types.ObjectId(input.fromAccountId), entryId: p.entryId, movementId: p.movementId, by: auth.userId } } }, { session });
    if (r.modifiedCount !== 1) throw new BusinessRuleError("Remboursement concurrent : réessayez.");
  });
}

/**
 * Remise d'espèces de la caisse du site vers un autre compte (banque, mobile
 * money, caisse centrale) : virement interne. Elle baisse les espèces attendues
 * sans être une dépense ; le compte reçoit, aucun chiffre d'affaires.
 */
export async function depositCash(auth: TokenPayload, deskId: string, input: { amount: number; toAccountId: string; date?: Date; label?: string }) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  if (!Types.ObjectId.isValid(input.toAccountId)) throw new BusinessRuleError("Choisissez le compte qui reçoit.");
  const date = input.date ?? new Date();
  return withTransaction(async session => {
    await assertDayOpen(auth.tenantId, deskId, date, session);
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("name treasuryAccountId").session(session ?? null).lean<{ name: string; treasuryAccountId?: Id } | null>();
    if (!desk?.treasuryAccountId) throw new BusinessRuleError("Ce site n'a pas de caisse de trésorerie.");
    const to = await TreasuryAccountModel.findOne({ _id: input.toAccountId, tenantId: auth.tenantId }).select("label").session(session ?? null).lean<{ label: string } | null>();
    if (!to) throw new BusinessRuleError("Compte introuvable.");
    const label = (input.label?.trim() || `Remise vers ${to.label} — ${desk.name}`).slice(0, 200);
    const p = await transferFunds(auth, { fromAccountId: desk.treasuryAccountId, toAccountId: input.toAccountId, amount, date, label, reference: `REM-${localDay(date)}` }, session);
    const [cash] = await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId, direction: "out", amount, label, method: "cash", category: "cash_transfer", date, entryId: p.entryId, movementId: p.movementIds[0], createdBy: auth.userId }], { session });
    return cash;
  });
}

/**
 * Situation de départ d'un site : ressources (argent reçu, payé par le
 * dirigeant, dettes de départ) et emplois (caisse de départ, stock d'ouverture,
 * équipements, créances). Un stock acheté avec une avance n'est pas un
 * financement de plus : il apparaît en emploi de cette même avance.
 */
export async function openingPosition(tenantId: string, deskId: string, stockValue: number) {
  const lines = await DeskFundingModel.find({ tenantId, deskId, cancelledAt: { $exists: false } }).sort({ date: 1 }).lean<IDeskFunding[]>();
  const sum = (kinds: string[]) => lines.filter(l => kinds.includes(l.kind)).reduce((t, l) => t + l.amount, 0);
  const money = sum(["money"]), owner = sum(["owner_paid"]), debts = sum(["debt"]), receivables = sum(["receivable"]), equipment = sum(["equipment"]);
  const resources = money + owner + debts, uses = money + Math.round(stockValue) + equipment + receivables;
  return {
    lines: lines.map(l => ({ _id: String(l._id), kind: l.kind, nature: l.nature ?? null, amount: l.amount, date: l.date, label: l.label, repayable: l.repayable, repaid: l.repaid ?? 0, left: l.repayable ? l.amount - (l.repaid ?? 0) : 0, toQualify: l.kind === "money" && !l.validatedAt })),
    money, owner, debts, receivables, equipment, stockValue: Math.round(stockValue), resources, uses, gap: resources - uses,
    repayableLeft: lines.filter(l => l.repayable).reduce((t, l) => t + l.amount - (l.repaid ?? 0), 0),
  };
}
