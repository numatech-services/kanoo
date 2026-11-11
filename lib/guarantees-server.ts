import { Types, type ClientSession } from "mongoose";
import { BankGuaranteeModel, type GuaranteeType } from "@/models/BankGuarantee";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { ContractModel } from "@/models/Contract";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { GUARANTEE_TYPES, GUARANTEE_FEE_ACCOUNT, GUARANTEE_DEPOSIT_ACCOUNT, GUARANTEE_CALL_ACCOUNT } from "@/lib/guarantees";
import { BusinessRuleError } from "@/lib/errors";
import { LoanModel } from "@/models/Loan";
import { settleByGuarantee, loanState } from "@/lib/loans-server";
import { CHARGE_KINDS, FEE_PERIODS, nextCommission } from "@/lib/guarantees";
const GUARANTEE_RECEIVED_ACCOUNT = { accountCode: "758000", accountLabel: "Produits divers (cautions reçues appelées)" };
const ADVANCE_ACCOUNT = { accountCode: "419000", accountLabel: "Clients créditeurs, avances reçues" };
const SUPPLIER_ADVANCE_ACCOUNT = { accountCode: "409000", accountLabel: "Fournisseurs, avances et acomptes versés" };

type Actor = { tenantId: string; userId: string };
type Line = { accountCode: string; accountLabel: string; debit: number; credit: number };

const money = (v: unknown) => Math.round(Number(v) || 0);
const dateOf = (v: unknown, label: string) => {
  const d = new Date(String(v ?? ""));
  if (isNaN(d.getTime())) throw new BusinessRuleError(`${label} invalide.`);
  return d;
};

/** Écriture + mouvement de trésorerie d'une opération de caution. `cash` > 0 : entrée en banque ; < 0 : sortie. */
async function post(actor: Actor, g: { _id: unknown; treasuryAccountId?: unknown; reference?: string }, opts: { date: Date; label: string; lines: Line[]; cash: number }, session?: ClientSession) {
  const ledger = await treasuryLedger(actor.tenantId, g.treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Banque de la caution introuvable.");
  const lines = opts.lines.map(l => l.accountCode === "BANK" ? { ...l, accountCode: ledger.accountCode, accountLabel: ledger.accountLabel } : l);
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: ledger.journalCode, entryDate: opts.date, reference: (g.reference || "CAUTION").slice(0, 80),
    label: opts.label, lines, linkedDocType: "guarantee", linkedDocId: g._id, createdBy: actor.userId,
  }], { session });
  if (opts.cash) {
    await TreasuryMovementModel.create([{
      tenantId: actor.tenantId, accountId: g.treasuryAccountId, date: opts.date, amount: opts.cash, label: opts.label, reference: g.reference,
      source: opts.cash < 0 ? "expense" : "manual", linkedDocType: "guarantee", linkedDocId: g._id, createdBy: actor.userId,
    }], { session });
  }
  return entry._id as Types.ObjectId;
}
const BANK = (debit: number, credit: number): Line => ({ accountCode: "BANK", accountLabel: "", debit, credit });

export interface GuaranteeInput {
  type?: unknown; reference?: unknown; treasuryAccountId?: unknown; bankName?: unknown; beneficiary?: unknown;
  amount?: unknown; issueDate?: unknown; expiryDate?: unknown; appelId?: unknown; contractId?: unknown;
  fee?: unknown; collateral?: unknown; notes?: unknown;
  direction?: unknown; loanId?: unknown; guaranteeForm?: unknown; feeRatePct?: unknown; feePeriod?: unknown;
}

/**
 * Enregistre une caution émise par la banque. La commission (631) et le dépôt
 * bloqué par la banque (275) sortent du compte bancaire choisi ; le montant
 * garanti, lui, reste hors bilan.
 */
export async function createGuarantee(actor: Actor, input: GuaranteeInput, opts: { canPost: boolean }, session?: ClientSession) {
  const tid = new Types.ObjectId(actor.tenantId);
  const type = String(input.type ?? "") as GuaranteeType;
  if (!(type in GUARANTEE_TYPES)) throw new BusinessRuleError("Type de caution invalide.");
  const amount = money(input.amount);
  if (!(amount > 0)) throw new BusinessRuleError("Montant garanti invalide.");
  const issueDate = input.issueDate ? dateOf(input.issueDate, "Date d'émission") : new Date();
  const expiryDate = input.expiryDate ? dateOf(input.expiryDate, "Date d'échéance") : undefined;
  if (expiryDate && expiryDate < issueDate) throw new BusinessRuleError("L'échéance précède l'émission.");
  const direction = input.direction === "received" ? "received" : "issued";
  const fee = direction === "received" ? 0 : money(input.fee), collateral = direction === "received" ? 0 : money(input.collateral);
  const feePeriod = String(input.feePeriod ?? "once");
  if (!(feePeriod in FEE_PERIODS)) throw new BusinessRuleError("Rythme de commission invalide.");
  const feeRate = input.feeRatePct === undefined || input.feeRatePct === "" || input.feeRatePct === null ? undefined : Number(String(input.feeRatePct).replace(",", ".")) / 100;
  if (feeRate !== undefined && !(feeRate >= 0 && feeRate <= 0.5)) throw new BusinessRuleError("Taux de commission invalide (en % par an).");
  if (feePeriod !== "once" && !feeRate) throw new BusinessRuleError("Commission périodique : indiquez son taux annuel.");
  let loanId: Types.ObjectId | undefined;
  if (input.loanId) {
    if (!Types.ObjectId.isValid(String(input.loanId)) || !(await LoanModel.exists({ _id: input.loanId, tenantId: tid }).session(session ?? null))) throw new BusinessRuleError("Emprunt introuvable.");
    loanId = new Types.ObjectId(String(input.loanId));
  }
  if (type === "garantie_emprunt" && direction === "received") throw new BusinessRuleError("Une garantie d'emprunt est donnée par l'organisation, pas reçue.");
  if (fee < 0 || collateral < 0) throw new BusinessRuleError("Montants négatifs refusés.");
  if (collateral > amount) throw new BusinessRuleError("Le dépôt bloqué dépasse le montant garanti.");
  if ((fee || collateral) && !opts.canPost) throw new BusinessRuleError("Commission et dépôt passent en comptabilité : réservé au gérant et à la comptabilité.");

  let beneficiary = String(input.beneficiary ?? "").trim();
  let appelId: Types.ObjectId | undefined, contractId: Types.ObjectId | undefined, marketProjectId: Types.ObjectId | undefined;
  if (input.appelId) {
    const a = Types.ObjectId.isValid(String(input.appelId)) ? await AppelCandidatureModel.findOne({ _id: input.appelId, tenantId: tid }).select("organism").session(session ?? null).lean<{ _id: Types.ObjectId; organism?: string } | null>() : null;
    if (!a) throw new BusinessRuleError("Appel d'offres introuvable.");
    appelId = a._id; beneficiary ||= a.organism ?? "";
  }
  if (input.contractId) {
    const c = Types.ObjectId.isValid(String(input.contractId)) ? await ContractModel.findOne({ _id: input.contractId, tenantId: tid }).select("clientId projectId").populate("clientId", "name").session(session ?? null).lean<{ _id: Types.ObjectId; clientId?: { name?: string }; projectId?: Types.ObjectId } | null>() : null;
    if (!c) throw new BusinessRuleError("Marché introuvable.");
    contractId = c._id; beneficiary ||= c.clientId?.name ?? "";
    // Commission de la caution : charge DU MARCHÉ (elle n'entrait pas dans sa marge).
    marketProjectId = c.projectId;
  }
  if (!beneficiary) throw new BusinessRuleError("Indiquez le bénéficiaire (maître d'ouvrage).");
  let treasuryAccountId: Types.ObjectId | undefined;
  if (input.treasuryAccountId) {
    if (!Types.ObjectId.isValid(String(input.treasuryAccountId))) throw new BusinessRuleError("Banque invalide.");
    treasuryAccountId = new Types.ObjectId(String(input.treasuryAccountId));
    if (!(await treasuryLedger(actor.tenantId, treasuryAccountId, session))) throw new BusinessRuleError("Banque introuvable.");
  } else if (direction === "issued") throw new BusinessRuleError("Choisissez la banque qui émet la caution : son encours compte dans la ligne de cautions de cette banque.");

  const [g] = await BankGuaranteeModel.create([{
    tenantId: tid, type, amount, issueDate, expiryDate, beneficiary: beneficiary.slice(0, 200), appelId, contractId, treasuryAccountId,
    reference: String(input.reference ?? "").trim().slice(0, 100) || undefined, bankName: String(input.bankName ?? "").trim().slice(0, 120) || undefined,
    fee, collateral, notes: String(input.notes ?? "").slice(0, 2000) || undefined, createdBy: actor.userId,
    direction, loanId, guaranteeForm: String(input.guaranteeForm ?? "").trim().slice(0, 120) || undefined, feeRate, feePeriod: direction === "received" ? "once" : feePeriod,
  }], { session });
  const what = `${GUARANTEE_TYPES[type]} — ${g.beneficiary}`;
  if (fee) {
    g.feeEntryId = await post(actor, g, { date: issueDate, label: `Commission ${what}`, lines: [{ ...GUARANTEE_FEE_ACCOUNT, debit: fee, credit: 0, ...(marketProjectId ? { projectId: marketProjectId } : {}) }, BANK(0, fee)], cash: -fee }, session);
  }
  if (collateral) {
    await registerLedgerAccount(actor.tenantId, GUARANTEE_DEPOSIT_ACCOUNT.accountCode, GUARANTEE_DEPOSIT_ACCOUNT.accountLabel, session);
    g.collateralEntryId = await post(actor, g, { date: issueDate, label: `Dépôt bloqué — ${what}`, lines: [{ ...GUARANTEE_DEPOSIT_ACCOUNT, debit: collateral, credit: 0 }, BANK(0, collateral)], cash: -collateral }, session);
  }
  if (fee || collateral) await g.save({ session });
  return g;
}

async function loadActive(actor: Actor, id: string, session?: ClientSession) {
  const g = Types.ObjectId.isValid(id) ? await BankGuaranteeModel.findOne({ _id: id, tenantId: actor.tenantId }).session(session ?? null) : null;
  if (!g) throw new BusinessRuleError("Caution introuvable.");
  if (g.status !== "active") throw new BusinessRuleError(g.status === "released" ? "Mainlevée déjà obtenue." : g.status === "cancelled" ? "Caution annulée." : "Caution déjà appelée.");
  return g;
}

/** Mainlevée : la banque libère l'engagement et rend le dépôt bloqué. */
export async function releaseGuarantee(actor: Actor, id: string, input: { date?: unknown }, session?: ClientSession) {
  const g = await loadActive(actor, id, session);
  const date = input.date ? dateOf(input.date, "Date") : new Date();
  if (g.collateral > 0) {
    await post(actor, g, { date, label: `Mainlevée — dépôt restitué (${GUARANTEE_TYPES[g.type as GuaranteeType]} — ${g.beneficiary})`,
      lines: [BANK(g.collateral, 0), { ...GUARANTEE_DEPOSIT_ACCOUNT, debit: 0, credit: g.collateral }], cash: g.collateral }, session);
  }
  g.status = "released"; g.releasedAt = date;
  await g.save({ session });
  return g;
}

/** Sûreté réelle (gage, nantissement, hypothèque) : sa réalisation cède un actif, aucun argent ne sort. */
export const REAL_SECURITY = /nantis|hypoth|gage|warrant/i;

/**
 * Appel de la caution par le bénéficiaire.
 * - Caution REÇUE : la banque du fournisseur nous paie ; l'avance versée (409)
 *   s'éteint pour une caution d'avance, sinon produit (758, compte non vérifié).
 * - Caution DONNÉE : la banque paie et se rembourse sur le dépôt, puis sur le
 *   compte. Avance de démarrage : éteint l'avance du client (419, plafonnée à
 *   son solde) ; garantie d'emprunt : éteint le capital restant (emprunt mis à
 *   jour) ; le reste est une charge (658).
 * - Sûreté réelle : écriture de cession à passer en comptabilité, l'appel ne
 *   fait que constater (option `manualPosting`).
 * Renvoie la caution et, le cas échéant, un avertissement pour la comptable.
 */
export async function callGuarantee(actor: Actor, id: string, input: { amount?: unknown; date?: unknown; treasuryAccountId?: unknown; manualPosting?: unknown }, session?: ClientSession) {
  const g = await loadActive(actor, id, session);
  const called = input.amount === undefined || input.amount === "" ? g.amount : money(input.amount);
  if (!(called > 0) || called > g.amount) throw new BusinessRuleError(`Montant appelé : entre 1 et ${g.amount.toLocaleString("fr-FR")} FCFA.`);
  const date = input.date ? dateOf(input.date, "Date") : new Date();
  const what = `${GUARANTEE_TYPES[g.type as GuaranteeType]} — ${g.beneficiary}`;
  const done = (warning?: string) => { g.status = "called"; g.calledAt = date; g.calledAmount = called; return g.save({ session }).then(() => ({ guarantee: g, warning })); };

  if (g.direction === "received") {
    const account = input.treasuryAccountId || g.treasuryAccountId;
    if (!account || !Types.ObjectId.isValid(String(account))) throw new BusinessRuleError("Choisissez le compte qui reçoit le paiement de la caution.");
    if (!(await treasuryLedger(actor.tenantId, account, session))) throw new BusinessRuleError("Compte de trésorerie introuvable.");
    g.treasuryAccountId = new Types.ObjectId(String(account));
    const credit = g.type === "avance_demarrage" ? SUPPLIER_ADVANCE_ACCOUNT : GUARANTEE_RECEIVED_ACCOUNT;
    await registerLedgerAccount(actor.tenantId, credit.accountCode, credit.accountLabel, session);
    await post(actor, g, { date, label: `Caution reçue appelée — ${what}`, lines: [BANK(called, 0), { ...credit, debit: 0, credit: called }], cash: called }, session);
    return done(g.type === "avance_demarrage" ? "Avance au fournisseur éteinte au 409 : lettrez-la avec la fiche du fournisseur." : undefined);
  }

  if (REAL_SECURITY.test(g.guaranteeForm ?? "")) {
    if (input.manualPosting !== true) throw new BusinessRuleError("Sûreté réelle (gage, nantissement, hypothèque) : sa réalisation se comptabilise comme une cession d'actif, sans sortie d'argent. Passez l'écriture en comptabilité, puis confirmez l'appel.");
    return done("Appel constaté sans écriture : l'écriture de cession est à passer en comptabilité.");
  }
  if (!g.treasuryAccountId) throw new BusinessRuleError("Indiquez d'abord la banque émettrice de la caution (modifier).");

  // Part qui éteint une dette (avance du client, capital de l'emprunt) ; le reste est une charge.
  let settle: { account: { accountCode: string; accountLabel: string }; amount: number; thirdPartyId?: unknown } | null = null;
  let warning: string | undefined;
  if (g.type === "avance_demarrage") {
    const contract = g.contractId ? await ContractModel.findOne({ _id: g.contractId, tenantId: actor.tenantId }).select("clientId").session(session ?? null).lean<{ clientId?: Types.ObjectId } | null>() : null;
    if (contract?.clientId) {
      const [bal] = await AccountingEntryModel.aggregate<{ net: number }>([
        { $match: { tenantId: new Types.ObjectId(actor.tenantId) } }, { $unwind: "$lines" },
        { $match: { "lines.accountCode": ADVANCE_ACCOUNT.accountCode, "lines.thirdPartyId": contract.clientId } },
        { $group: { _id: null, net: { $sum: { $subtract: ["$lines.credit", "$lines.debit"] } } } },
      ]).session(session ?? null);
      const open = Math.max(0, Math.round(bal?.net ?? 0));
      if (open > 0) settle = { account: ADVANCE_ACCOUNT, amount: Math.min(open, called), thirdPartyId: contract.clientId };
      warning = "Si la facture d'acompte portait de la TVA, passez l'avoir correspondant pour régulariser la TVA collectée (traitement à valider par la comptable).";
    } else {
      warning = "Aucun marché rattaché : l'avance du client n'a pas pu être retrouvée, la somme est passée en charge (658).";
    }
  }
  if (g.type === "garantie_emprunt" && g.loanId) {
    const loan = await LoanModel.findOne({ _id: g.loanId, tenantId: actor.tenantId }).select("capitalAccountCode capitalAccountLabel").session(session ?? null).lean<{ capitalAccountCode?: string; capitalAccountLabel?: string } | null>();
    if (loan) settle = { account: { accountCode: loan.capitalAccountCode || "162000", accountLabel: loan.capitalAccountLabel || "Emprunts" }, amount: called };
  }
  const fromDeposit = Math.min(g.collateral, called), fromBank = called - fromDeposit, back = g.collateral - fromDeposit;
  const lines = (settled: number) => {
    const loss = called - settled;
    return [
      ...(settled ? [{ ...settle!.account, debit: settled, credit: 0, ...(settle!.thirdPartyId ? { thirdPartyId: settle!.thirdPartyId } : {}) }] : []),
      ...(loss ? [{ ...GUARANTEE_CALL_ACCOUNT, debit: loss, credit: 0 }] : []),
      ...(fromDeposit ? [{ ...GUARANTEE_DEPOSIT_ACCOUNT, debit: 0, credit: fromDeposit }] : []),
      ...(fromBank ? [BANK(0, fromBank)] : []),
    ];
  };
  let settled = settle?.amount ?? 0;
  if (g.type === "garantie_emprunt" && settle) {
    // Capital éteint plafonné au restant dû : calculé avant l'écriture, appliqué à l'emprunt après.
    const loanDoc = await LoanModel.findOne({ _id: g.loanId, tenantId: actor.tenantId }).session(session ?? null).lean<Parameters<typeof loanState>[0] | null>();
    settled = loanDoc && loanDoc.status === "active" ? Math.min(called, loanState(loanDoc).remaining) : 0;
    if (settled < called) warning = `Capital restant dû inférieur à l'appel : ${(called - settled).toLocaleString("fr-FR")} FCFA passés en charge (658).`;
  }
  const entryId = await post(actor, g, { date, label: `Caution appelée — ${what}`, lines: lines(settled), cash: -fromBank }, session);
  if (g.type === "garantie_emprunt" && settled > 0) {
    await settleByGuarantee(actor, g.loanId, { amount: settled, date, guaranteeId: g._id, entryId }, session);
    const still = await LoanModel.exists({ _id: g.loanId, tenantId: actor.tenantId, status: "active", method: { $ne: "free" } }).session(session ?? null);
    if (still) warning = [warning, "Emprunt en partie remboursé par la caution : ajustez les échéances restantes au nouveau tableau de la banque (intérêts recalculés)."].filter(Boolean).join(" ");
  }
  if (back > 0) {
    await post(actor, g, { date, label: `Solde du dépôt restitué — ${g.beneficiary}`, lines: [BANK(back, 0), { ...GUARANTEE_DEPOSIT_ACCOUNT, debit: 0, credit: back }], cash: back }, session);
  }
  return done(warning);
}

/**
 * Frais passés après l'émission : commission périodique (montant calculé par
 * défaut), frais de prorogation ou de dossier. Charge 631 imputée au marché,
 * débitée de la banque émettrice.
 */
export async function chargeGuarantee(actor: Actor, id: string, input: { kind?: unknown; amount?: unknown; date?: unknown; label?: unknown }, session?: ClientSession) {
  const g = await loadActive(actor, id, session);
  if (g.direction === "received") throw new BusinessRuleError("Caution reçue : ses frais sont à la charge du fournisseur.");
  if (!g.treasuryAccountId) throw new BusinessRuleError("Indiquez d'abord la banque émettrice de la caution.");
  const kind = String(input.kind ?? "commission") as keyof typeof CHARGE_KINDS;
  if (!(kind in CHARGE_KINDS)) throw new BusinessRuleError("Nature des frais invalide.");
  const due = kind === "commission" ? nextCommission(g)[0] : undefined;
  const amount = input.amount === undefined || input.amount === "" || input.amount === null ? (due?.amount ?? 0) : money(input.amount);
  if (!(amount > 0) || amount > 1e12) throw new BusinessRuleError("Montant des frais invalide.");
  const date = input.date ? dateOf(input.date, "Date") : (due && due.date < new Date() ? due.date : new Date());
  let marketProjectId: unknown;
  if (g.contractId) marketProjectId = (await ContractModel.findOne({ _id: g.contractId, tenantId: actor.tenantId }).select("projectId").session(session ?? null).lean<{ projectId?: unknown } | null>())?.projectId;
  const label = `${CHARGE_KINDS[kind]}${due && kind === "commission" ? ` (période ${due.period})` : ""} — ${GUARANTEE_TYPES[g.type as GuaranteeType]} — ${g.beneficiary}`.slice(0, 280);
  const entryId = await post(actor, g, { date, label, lines: [{ ...GUARANTEE_FEE_ACCOUNT, debit: amount, credit: 0, ...(marketProjectId ? { projectId: marketProjectId } : {}) }, BANK(0, amount)], cash: -amount }, session);
  g.charges = [...(g.charges ?? []), { date, amount, kind, label: String(input.label ?? "").slice(0, 200) || undefined, entryId }];
  await g.save({ session });
  return g;
}

/** Prorogation : nouvelle échéance, et frais de prorogation s'il y en a. */
export async function extendGuarantee(actor: Actor, id: string, input: { expiryDate?: unknown; fee?: unknown; date?: unknown }, session?: ClientSession) {
  const g = await loadActive(actor, id, session);
  const expiry = dateOf(input.expiryDate, "Nouvelle échéance");
  if (g.expiryDate && expiry <= g.expiryDate) throw new BusinessRuleError("La nouvelle échéance doit suivre l'actuelle.");
  if (g.issueDate && expiry <= g.issueDate) throw new BusinessRuleError("L'échéance doit suivre la date d'émission.");
  g.expiryDate = expiry;
  await g.save({ session });
  const fee = money(input.fee ?? 0);
  if (fee > 0) return chargeGuarantee(actor, id, { kind: "prorogation", amount: fee, date: input.date }, session);
  return g;
}

/** Saisie erronée : commission et dépôt extournés, mouvements contre-passés, caution supprimée. */
export async function deleteGuarantee(actor: Actor, id: string, session?: ClientSession) {
  const g = await loadActive(actor, id, session);
  for (const entryId of [g.feeEntryId, g.collateralEntryId, ...(g.charges ?? []).map((c: { entryId?: unknown }) => c.entryId)].filter(Boolean)) {
    await reverseEntry({ tenantId: actor.tenantId, userId: actor.userId, entryId, reason: "caution supprimée (saisie erronée)" }, session);
  }
  const moves = await TreasuryMovementModel.find({ tenantId: actor.tenantId, linkedDocType: "guarantee", linkedDocId: g._id }).session(session ?? null);
  for (const m of moves) {
    await TreasuryMovementModel.create([{ tenantId: actor.tenantId, accountId: m.accountId, date: new Date(), amount: -m.amount,
      label: `Annulation — ${m.label}`, source: "manual", linkedDocType: "guarantee", linkedDocId: g._id, createdBy: actor.userId }], { session });
  }
  // Gardée, au statut « annulée » : la piste d'audit reste complète.
  g.status = "cancelled";
  await g.save({ session });
}
