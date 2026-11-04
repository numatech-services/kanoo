import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { AccountingEntryModel } from "@/models/AccountingEntry";
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
export const OPENING_KINDS = { taken_over: "Stock repris ou déjà payé par l'entreprise", owner_paid: "Payé par le dirigeant", debt: "Dette fournisseur de départ", receivable: "Créance de départ", equipment: "Équipement déjà financé" } as const;
/** Compte de la dette écrite à la qualification d'une ligne sans argent. */
const LINE_ACCOUNTS: Record<string, { accountCode: string; accountLabel: string }> = { owner_paid: { accountCode: "462000", accountLabel: "Associés, comptes courants" }, debt: { accountCode: "401100", accountLabel: "Fournisseurs" } };
const ATTENTE = { accountCode: "471000", accountLabel: "Compte d'attente — situation de départ" };

const MAX_AMOUNT = 1e11;
const cleanAmount = (v: unknown, label = "Montant") => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) throw new BusinessRuleError(`${label} invalide.`);
  return n;
};
const noFuture = (d: Date) => { if (isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000) throw new BusinessRuleError("Date invalide : une opération se saisit le jour où elle a lieu."); return d; };

/** Toute écriture sur un compte verrouille ce compte : deux sorties simultanées ne voient pas le même solde. */
export const lockAccount = (tenantId: string, accountId: unknown, session?: ClientSession) =>
  TreasuryAccountModel.updateOne({ _id: accountId, tenantId }, { $set: { updatedAt: new Date() } }, { session });

/**
 * Reflet sur la caisse d'un site d'un mouvement fait depuis un autre écran
 * (remboursement, virement, annulation) : l'entrée de caisse garde les espèces
 * attendues égales au solde du compte, et le jour clos reste clos. Sans site
 * relié au compte, rien à faire.
 */
export async function mirrorTill(auth: TokenPayload, accountId: unknown, m: { direction: "in" | "out"; amount: number; date: Date; label: string; category?: string; entryId?: unknown; movementId?: unknown }, session?: ClientSession) {
  const desk = await ActivityDeskModel.findOne({ tenantId: auth.tenantId, treasuryAccountId: accountId, archived: { $ne: true } }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
  if (!desk) return null;
  await assertDayOpen(auth.tenantId, desk._id, m.date, session);
  const [cash] = await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId: desk._id, direction: m.direction, amount: m.amount, label: m.label.slice(0, 200), method: "cash", category: m.category ?? (m.direction === "in" ? "funding" : "cash_transfer"), date: m.date, entryId: m.entryId, movementId: m.movementId, createdBy: auth.userId }], { session });
  return cash;
}

/** Virement interne entre deux comptes de trésorerie (585) : ni recette ni dépense. */
export async function transferFunds(auth: TokenPayload, input: { fromAccountId: unknown; toAccountId: unknown; amount: number; date: Date; label: string; reference?: string; allowOverdraft?: boolean }, session?: ClientSession) {
  await lockAccount(auth.tenantId, input.fromAccountId, session);
  const [src, dst] = await Promise.all([treasuryLedger(auth.tenantId, input.fromAccountId, session), treasuryLedger(auth.tenantId, input.toAccountId, session)]);
  if (!src || !dst) throw new BusinessRuleError("Compte de trésorerie introuvable.");
  if (String(input.fromAccountId) === String(input.toAccountId)) throw new BusinessRuleError("Choisissez deux comptes différents.");
  const bal = await accountBalance(auth.tenantId, String(input.fromAccountId), session);
  if (bal && bal.balance < input.amount && !input.allowOverdraft) throw new BusinessRuleError(`Solde insuffisant sur le compte débité (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
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
  await mirrorTill(auth, input.fromAccountId, { direction: "out", amount, date, label, entryId: entry._id, movementId: out._id }, session);
  await mirrorTill(auth, input.toAccountId, { direction: "in", amount, date, label, entryId: entry._id, movementId: inn._id }, session);
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
    const amount = cleanAmount(input.amount, "Montant de départ");
    if (!Object.hasOwn(FUNDING_NATURES, input.nature)) throw new BusinessRuleError("Origine des fonds invalide.");
    const nature = FUNDING_NATURES[input.nature];
    const date = noFuture(input.date ?? new Date());
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }).select("name treasuryAccountId").session(s ?? null).lean<{ _id: Id; name: string; treasuryAccountId?: Id } | null>();
    if (!desk) throw new BusinessRuleError("Site introuvable.");
    if (!desk.treasuryAccountId) throw new BusinessRuleError("Ce site n'a pas de caisse de trésorerie : reliez-en une avant de lui allouer de l'argent.");
    const label = `${input.label?.trim() || nature.label} — ${desk.name}`.slice(0, 200);
    let posted: { entryId: unknown; movementIds: unknown[] };
    if (input.nature === "transfer") {
      if (!input.fromAccountId || !Types.ObjectId.isValid(input.fromAccountId)) throw new BusinessRuleError("Choisissez le compte qui verse l'argent.");
      posted = await transferFunds(auth, { fromAccountId: input.fromAccountId, toAccountId: desk.treasuryAccountId, amount, date, label, reference: `DOT-${localDay(date)}` }, s);
    } else {
      await registerLedgerAccount(auth.tenantId, nature.account!.accountCode, nature.account!.accountLabel, s);
      const p = await postCashFlow({ tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: desk.treasuryAccountId, direction: "in", amount, date, label, reference: `DOT-${localDay(date)}`, account: nature.account!, linkedDocType: "desk_funding", linkedDocId: desk._id }, s);
      posted = { entryId: p.entryId, movementIds: [p.movementId] };
      await mirrorTill(auth, desk.treasuryAccountId, { direction: "in", amount, date, label, entryId: p.entryId, movementId: p.movementId }, s);
    }
    const [f] = await DeskFundingModel.create([{
      tenantId: auth.tenantId, deskId, kind: "money", nature: input.nature, amount, date, label, repayable: nature.repayable,
      ...(input.nature === "transfer" ? { fromAccountId: input.fromAccountId } : { accountCode: nature.account!.accountCode }),
      entryId: posted.entryId, movementIds: posted.movementIds,
      // Un virement interne ou une avance n'ont rien à qualifier ; l'apport et l'origine inconnue, si.
      ...(input.nature === "transfer" || input.nature === "advance" ? { validatedAt: date, validatedBy: auth.userId } : {}), createdBy: auth.userId,
    }], { session: s });
    return f;
  };
  return session ? run(session) : withTransaction(run);
}

/** Ligne de la situation de départ sans mouvement d'argent : à passer par la comptable. */
export async function addOpeningLine(auth: TokenPayload, deskId: string, input: { kind: keyof typeof OPENING_KINDS; amount: number; label?: string; date?: Date; repayable?: boolean }) {
  if (!Object.hasOwn(OPENING_KINDS, input.kind)) throw new BusinessRuleError("Nature de la ligne invalide.");
  const amount = cleanAmount(input.amount);
  if (!(await ActivityDeskModel.exists({ _id: deskId, tenantId: auth.tenantId, archived: { $ne: true } }))) throw new BusinessRuleError("Site introuvable.");
  return DeskFundingModel.create({ tenantId: auth.tenantId, deskId, kind: input.kind, amount, date: input.date ?? new Date(), label: (input.label?.trim() || OPENING_KINDS[input.kind]).slice(0, 200), repayable: input.kind === "owner_paid" ? input.repayable !== false : input.kind === "debt", createdBy: auth.userId });
}

/**
 * Annulation d'une ligne saisie par erreur : extourne de l'écriture, mouvement
 * contraire et reflet sur la caisse du site. Rien ne s'efface : la ligne reste
 * visible, barrée. Refusée après un remboursement ou une qualification : une
 * ligne validée par la comptable ne s'annule pas d'un clic, et une caisse dont
 * l'argent est déjà sorti n'est pas rendue négative.
 */
export async function cancelFunding(auth: TokenPayload, id: string, reason: string) {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) throw new BusinessRuleError("Motif d'annulation obligatoire.");
  await withTransaction(async session => {
    const f = await DeskFundingModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, cancelledAt: { $exists: false }, repaid: 0 }, { $set: { cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: why } }, { session, new: true }).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Ligne introuvable, déjà annulée ou déjà remboursée en partie.");
    if (f.qualifiedAt) throw new BusinessRuleError("Cette ligne a été qualifiée par la comptable : c'est à elle de la corriger par écriture.");
    if (f.kind !== "money") return;
    await assertMonthOpen(auth.tenantId, f.deskId, new Date(), session);
    const moves = await TreasuryMovementModel.find({ _id: { $in: f.movementIds }, tenantId: auth.tenantId }).select("accountId amount").session(session ?? null).lean<Array<{ _id: Id; accountId: Id; amount: number }>>();
    for (const m of moves.filter(x => x.amount > 0)) {
      const bal = await accountBalance(auth.tenantId, String(m.accountId), session);
      if (bal && bal.balance < m.amount) throw new BusinessRuleError(`Cet argent est déjà dépensé (solde ${bal.balance.toLocaleString("fr-FR")} FCFA) : l'annulation mettrait la caisse en négatif.`);
    }
    const source = f.nature === "transfer" ? "transfer" as const : "manual" as const, now = new Date();
    let first = true;
    for (const m of moves) {
      await reverseCashFlow({ tenantId: auth.tenantId, userId: auth.userId, entryId: first ? f.entryId : undefined, movementId: m._id, reason: `Annulation : ${why}`, source }, session);
      first = false;
      await mirrorTill(auth, m.accountId, { direction: m.amount > 0 ? "out" : "in", amount: Math.abs(m.amount), date: now, label: `Annulation : ${f.label}` }, session);
    }
  });
}

/**
 * La comptable traduit la ligne en écriture.
 *  - Argent à qualifier : reclassement du compte d'attente vers le compte choisi.
 *  - Ligne sans argent (payé par le dirigeant, dette de départ) : la dette est
 *    écrite (471 au débit, compte choisi au crédit), le remboursement devient
 *    possible. Avant cela, aucun remboursement n'est permis : il n'y a rien à
 *    rembourser en comptabilité.
 * Un compte de dette (16x, 40x, 46x) rend la ligne remboursable.
 */
export async function qualifyFunding(auth: TokenPayload, id: string, accountCode: string, accountLabel?: string) {
  await withTransaction(async session => {
    const f = await DeskFundingModel.findOne({ _id: id, tenantId: auth.tenantId, qualifiedAt: { $exists: false }, cancelledAt: { $exists: false } }).session(session ?? null).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Ligne introuvable ou déjà qualifiée.");
    if (f.kind === "receivable" || f.kind === "equipment" || f.kind === "taken_over") throw new BusinessRuleError("Cette ligne se passe dans les écritures d'ouverture, hors de cet écran.");
    if (f.kind === "money" && f.validatedAt) throw new BusinessRuleError("Cette ligne est déjà qualifiée.");
    const code = (accountCode || LINE_ACCOUNTS[f.kind]?.accountCode || "").trim();
    if (!/^[14]\d{2,7}$/.test(code)) throw new BusinessRuleError("Compte de financement attendu (classe 1 ou 4).");
    const label = (accountLabel?.trim() || LINE_ACCOUNTS[f.kind]?.accountLabel || "Financement du site").slice(0, 160);
    await registerLedgerAccount(auth.tenantId, code, label, session);
    const from = f.kind === "money" ? { accountCode: f.accountCode ?? ATTENTE.accountCode, accountLabel: ATTENTE.accountLabel } : ATTENTE;
    if (f.kind !== "money") await registerLedgerAccount(auth.tenantId, ATTENTE.accountCode, ATTENTE.accountLabel, session);
    const [e] = from.accountCode === code ? [null] : await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: "OD", entryDate: new Date(), reference: `QUAL-${String(f._id).slice(-6).toUpperCase()}`, label: `Qualification : ${f.label}`.slice(0, 300),
      lines: [{ ...from, debit: f.amount, credit: 0 }, { accountCode: code, accountLabel: label, debit: 0, credit: f.amount }], linkedDocType: "desk_funding", linkedDocId: f._id, createdBy: auth.userId,
    }], { session });
    await DeskFundingModel.updateOne({ _id: f._id }, { $set: { validatedAt: new Date(), validatedBy: auth.userId, qualifiedAt: new Date(), accountCode: code, repayable: /^(16|40|46)/.test(code), ...(e ? { qualificationEntryId: e._id } : {}) } }, { session });
  });
}

/** Remboursement d'une dette de départ ou d'une avance : la dette diminue, sans charge ni dépense du site. Il suppose une dette écrite. */
export async function repayFunding(auth: TokenPayload, id: string, input: { amount: number; fromAccountId: string; date?: Date }) {
  const amount = cleanAmount(input.amount);
  if (!Types.ObjectId.isValid(input.fromAccountId)) throw new BusinessRuleError("Choisissez le compte qui rembourse.");
  const date = noFuture(input.date ?? new Date());
  await withTransaction(async session => {
    await lockAccount(auth.tenantId, input.fromAccountId, session);
    const f = await DeskFundingModel.findOne({ _id: id, tenantId: auth.tenantId, repayable: true, cancelledAt: { $exists: false } }).session(session ?? null).lean<IDeskFunding | null>();
    if (!f) throw new BusinessRuleError("Avance introuvable.");
    if (f.kind !== "money" && !f.qualifiedAt) throw new BusinessRuleError("Cette dette n'est pas encore écrite en comptabilité : la comptable doit d'abord la qualifier.");
    await assertMonthOpen(auth.tenantId, f.deskId, date, session);
    const left = f.amount - (f.repaid ?? 0);
    if (amount > left) throw new BusinessRuleError(`Il reste ${left.toLocaleString("fr-FR")} FCFA à rembourser.`);
    const bal = await accountBalance(auth.tenantId, input.fromAccountId, session);
    if (bal && bal.balance < amount) throw new BusinessRuleError(`Solde insuffisant (${bal.balance.toLocaleString("fr-FR")} FCFA).`);
    const code = f.accountCode || FUNDING_NATURES.advance.account!.accountCode;
    const accountLabel = LINE_ACCOUNTS[f.kind]?.accountCode === code ? LINE_ACCOUNTS[f.kind].accountLabel : FUNDING_NATURES.advance.account!.accountLabel;
    await registerLedgerAccount(auth.tenantId, code, accountLabel, session);
    const label = `Remboursement : ${f.label}`;
    const p = await postCashFlow({ tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: input.fromAccountId, direction: "out", amount, date, label, reference: `RMB-${localDay(date)}`, account: { accountCode: code, accountLabel }, linkedDocType: "desk_funding", linkedDocId: f._id }, session);
    await mirrorTill(auth, input.fromAccountId, { direction: "out", amount, date, label, entryId: p.entryId, movementId: p.movementId }, session);
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
  const amount = cleanAmount(input.amount);
  if (!Types.ObjectId.isValid(input.toAccountId)) throw new BusinessRuleError("Choisissez le compte qui reçoit.");
  const date = noFuture(input.date ?? new Date());
  return withTransaction(async session => {
    await assertDayOpen(auth.tenantId, deskId, date, session);
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("name treasuryAccountId").session(session ?? null).lean<{ name: string; treasuryAccountId?: Id } | null>();
    if (!desk?.treasuryAccountId) throw new BusinessRuleError("Ce site n'a pas de caisse de trésorerie.");
    const to = await TreasuryAccountModel.findOne({ _id: input.toAccountId, tenantId: auth.tenantId }).select("label").session(session ?? null).lean<{ label: string } | null>();
    if (!to) throw new BusinessRuleError("Compte introuvable.");
    const label = (input.label?.trim() || `Remise vers ${to.label} — ${desk.name}`).slice(0, 200);
    return transferFunds(auth, { fromAccountId: desk.treasuryAccountId, toAccountId: input.toAccountId, amount, date, label, reference: `REM-${localDay(date)}` }, session);
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
  const money = sum(["money"]), owner = sum(["owner_paid"]), debts = sum(["debt"]), takenOver = sum(["taken_over"]), receivables = sum(["receivable"]), equipment = sum(["equipment"]);
  const resources = money + owner + debts + takenOver, uses = money + Math.round(stockValue) + equipment + receivables;
  const all = await DeskFundingModel.find({ tenantId, deskId, cancelledAt: { $exists: true } }).sort({ date: 1 }).select("kind amount date label cancelReason").lean<IDeskFunding[]>();
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("openingValidatedAt").lean<{ openingValidatedAt?: Date } | null>();
  return {
    lines: lines.map(l => ({ _id: String(l._id), kind: l.kind, nature: l.nature ?? null, amount: l.amount, date: l.date, label: l.label, repayable: l.repayable, repaid: l.repaid ?? 0, left: l.repayable ? l.amount - (l.repaid ?? 0) : 0, toQualify: (l.kind === "money" && !l.validatedAt) || ((l.kind === "owner_paid" || l.kind === "debt") && !l.qualifiedAt), cancellable: !l.qualifiedAt && (l.repaid ?? 0) === 0 })),
    cancelled: all.map(l => ({ _id: String(l._id), amount: l.amount, label: l.label, reason: l.cancelReason ?? "" })),
    money, owner, debts, takenOver, receivables, equipment, stockValue: Math.round(stockValue), resources, uses, gap: Math.abs(resources - uses) <= 5 ? 0 : resources - uses,
    validatedAt: desk?.openingValidatedAt ?? null,
    repayableLeft: lines.filter(l => l.repayable).reduce((t, l) => t + l.amount - (l.repaid ?? 0), 0),
  };
}
