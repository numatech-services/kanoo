import { Types, type ClientSession } from "mongoose";
import { LoanModel } from "@/models/Loan";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BusinessRuleError } from "@/lib/errors";
import { registerLedgerAccount, treasuryLedger } from "@/lib/treasury";
import { reverseCashFlow } from "@/lib/cash-posting";
import { buildSchedule, FREQUENCIES, METHODS, type Frequency, type Method } from "@/lib/loan-schedule";
import { checkImputations } from "@/lib/imputation";

type Actor = { tenantId: string; userId: string };
export const LOAN_ACCOUNTS = {
  capital: { accountCode: "162000", accountLabel: "Emprunts auprès des établissements de crédit" },
  interest: { accountCode: "671000", accountLabel: "Intérêts des emprunts" },
  insurance: { accountCode: "625000", accountLabel: "Primes d'assurance" },
  fees: { accountCode: "631000", accountLabel: "Frais bancaires" },
};

const money = (v: unknown) => Math.round(Number(v));
function day(v: unknown, what: string) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new BusinessRuleError(`${what} invalide.`);
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new BusinessRuleError(`${what} invalide.`);
  return d;
}

export interface LoanInput {
  label?: unknown; lender?: unknown; reference?: unknown; treasuryAccountId?: unknown; principal?: unknown; annualRatePct?: unknown;
  durationMonths?: unknown; frequency?: unknown; method?: unknown; deferralPeriods?: unknown; startDate?: unknown; firstDueDate?: unknown;
  fees?: unknown; insurancePerPeriod?: unknown; purpose?: unknown; projectId?: unknown; collateral?: unknown; postedFrom?: unknown; notes?: unknown;
}

/** Création : le tableau d'amortissement est calculé ; rien n'est comptabilisé avant le déblocage. */
export async function createLoan(actor: Actor, input: LoanInput) {
  const label = String(input.label ?? "").trim(), lender = String(input.lender ?? "").trim();
  if (!label || !lender) throw new BusinessRuleError("Indiquez l'objet de l'emprunt et le prêteur.");
  const principal = money(input.principal), rate = Number(input.annualRatePct) / 100, durationMonths = Math.round(Number(input.durationMonths));
  if (!(principal > 0)) throw new BusinessRuleError("Capital emprunté invalide.");
  if (!(rate >= 0 && rate < 1)) throw new BusinessRuleError("Taux annuel invalide (en %, par exemple 9,5).");
  if (!(durationMonths >= 1 && durationMonths <= 600)) throw new BusinessRuleError("Durée invalide (en mois).");
  const frequency = (String(input.frequency ?? "monthly")) as Frequency, method = (String(input.method ?? "annuity")) as Method;
  if (!(frequency in FREQUENCIES)) throw new BusinessRuleError("Périodicité invalide.");
  if (!(method in METHODS)) throw new BusinessRuleError("Mode de remboursement invalide.");
  if (durationMonths % FREQUENCIES[frequency].months !== 0) throw new BusinessRuleError("La durée doit être un multiple de la périodicité.");
  const deferralPeriods = Math.max(0, Math.round(Number(input.deferralPeriods ?? 0)));
  const startDate = day(input.startDate, "Date de déblocage");
  const firstDueDate = input.firstDueDate ? day(input.firstDueDate, "Première échéance") : new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + FREQUENCIES[frequency].months, startDate.getUTCDate()));
  if (firstDueDate <= startDate) throw new BusinessRuleError("La première échéance suit le déblocage.");
  const fees = money(input.fees ?? 0), insurancePerPeriod = money(input.insurancePerPeriod ?? 0);
  if (fees < 0 || insurancePerPeriod < 0) throw new BusinessRuleError("Montants négatifs refusés.");
  if (!Types.ObjectId.isValid(String(input.treasuryAccountId)) || !(await treasuryLedger(actor.tenantId, input.treasuryAccountId))) throw new BusinessRuleError("Choisissez le compte bancaire de l'emprunt.");
  if (input.projectId) { const err = await checkImputations(actor.tenantId, [{ projectId: input.projectId }]); if (err) throw new BusinessRuleError(err); }
  const postedFrom = input.postedFrom ? day(input.postedFrom, "Date de prise en compte") : undefined;
  const schedule = buildSchedule({ principal, annualRate: rate, durationMonths, frequency, method, deferralPeriods, firstDueDate, insurancePerPeriod });
  const [loan] = await LoanModel.create([{
    tenantId: actor.tenantId, label: label.slice(0, 160), lender: lender.slice(0, 160), reference: String(input.reference ?? "").trim().slice(0, 80) || undefined,
    treasuryAccountId: input.treasuryAccountId, principal, annualRate: rate, durationMonths, frequency, method, deferralPeriods, startDate, firstDueDate,
    fees, insurancePerPeriod, purpose: String(input.purpose ?? "").trim().slice(0, 300) || undefined, projectId: input.projectId || undefined,
    collateral: String(input.collateral ?? "").trim().slice(0, 500) || undefined, postedFrom, notes: String(input.notes ?? "").slice(0, 2000) || undefined,
    installments: schedule.map(s => ({ n: s.n, dueDate: s.dueDate, principal: s.principal, interest: s.interest, insurance: s.insurance, status: postedFrom && s.dueDate < postedFrom ? "prior" : "due" })),
    status: postedFrom && startDate < postedFrom ? "active" : "draft", createdBy: actor.userId,
  }]);
  return loan;
}

async function load(actor: Actor, id: string, session?: ClientSession) {
  const loan = Types.ObjectId.isValid(id) ? await LoanModel.findOne({ _id: id, tenantId: actor.tenantId }).session(session ?? null) : null;
  if (!loan) throw new BusinessRuleError("Emprunt introuvable.");
  return loan;
}

async function postFlow(actor: Actor, loan: { _id: unknown; reference?: string; label: string }, treasuryAccountId: unknown, date: Date, label: string, lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number; projectId?: unknown }>, cash: number, session?: ClientSession) {
  const ledger = await treasuryLedger(actor.tenantId, treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Compte bancaire introuvable.");
  for (const l of lines) await registerLedgerAccount(actor.tenantId, l.accountCode, l.accountLabel, session);
  const bankLine = { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: cash > 0 ? cash : 0, credit: cash < 0 ? -cash : 0 };
  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: ledger.journalCode, entryDate: date, reference: (loan.reference || "EMPRUNT").slice(0, 80),
    label: label.slice(0, 300), lines: [...lines, bankLine], linkedDocType: "loan", linkedDocId: loan._id, createdBy: actor.userId,
  }], { session });
  const [m] = await TreasuryMovementModel.create([{
    tenantId: actor.tenantId, accountId: treasuryAccountId, date, amount: cash, label: label.slice(0, 200), reference: loan.reference,
    source: cash < 0 ? "expense" : "manual", linkedDocType: "loan", linkedDocId: loan._id, entryId: entry._id, createdBy: actor.userId,
  }], { session });
  return { entryId: entry._id, movementId: m._id };
}

/** Déblocage : la banque verse le capital, moins les frais de dossier. */
export async function disburseLoan(actor: Actor, id: string, input: { date?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (loan.status !== "draft") throw new BusinessRuleError("Emprunt déjà débloqué.");
  const date = input.date ? day(input.date, "Date de déblocage") : loan.startDate;
  const proj = loan.projectId ? { projectId: loan.projectId } : {};
  const lines = [{ ...LOAN_ACCOUNTS.capital, debit: 0, credit: loan.principal }, ...(loan.fees ? [{ ...LOAN_ACCOUNTS.fees, debit: loan.fees, credit: 0, ...proj }] : [])];
  const r = await postFlow(actor, loan, loan.treasuryAccountId, date, `Déblocage — ${loan.label} (${loan.lender})`, lines, loan.principal - loan.fees, session);
  loan.status = "active"; loan.disbursedAt = date; loan.disbursementEntryId = r.entryId; loan.disbursementMovementId = r.movementId;
  await loan.save({ session });
  return loan;
}

/** Échéance payée : capital (162), intérêts (671), assurance (625) contre la banque. */
export async function payInstallment(actor: Actor, id: string, input: { installmentId?: unknown; date?: unknown; treasuryAccountId?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (loan.status !== "active") throw new BusinessRuleError(loan.status === "draft" ? "Débloquez d'abord l'emprunt." : "Emprunt soldé.");
  const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(input.installmentId));
  if (!inst) throw new BusinessRuleError("Échéance introuvable.");
  if (inst.status !== "due") throw new BusinessRuleError(inst.status === "paid" ? "Échéance déjà payée." : "Échéance antérieure à la reprise : payée hors Kanoo.");
  const earlier = loan.installments.find((x: { n: number; status: string }) => x.n < inst.n && x.status === "due");
  if (earlier) throw new BusinessRuleError(`Payez d'abord l'échéance n° ${earlier.n}.`);
  const date = input.date ? day(input.date, "Date de paiement") : inst.dueDate;
  const account = input.treasuryAccountId || loan.treasuryAccountId;
  const proj = loan.projectId ? { projectId: loan.projectId } : {};
  const total = inst.principal + inst.interest + inst.insurance;
  const lines = [
    ...(inst.principal ? [{ ...LOAN_ACCOUNTS.capital, debit: inst.principal, credit: 0 }] : []),
    ...(inst.interest ? [{ ...LOAN_ACCOUNTS.interest, debit: inst.interest, credit: 0, ...proj }] : []),
    ...(inst.insurance ? [{ ...LOAN_ACCOUNTS.insurance, debit: inst.insurance, credit: 0, ...proj }] : []),
  ];
  const r = await postFlow(actor, loan, account, date, `Échéance ${inst.n}/${loan.installments.length} — ${loan.label} (${loan.lender})`, lines, -total, session);
  inst.status = "paid"; inst.paidAt = date; inst.treasuryAccountId = account; inst.entryId = r.entryId; inst.movementId = r.movementId;
  if (loan.installments.every((x: { status: string }) => x.status !== "due")) loan.status = "closed";
  loan.markModified("installments");
  await loan.save({ session });
  return loan;
}

/** Paiement annulé : écriture extournée et mouvement contre-passé ; l'échéance redevient due. */
export async function cancelInstallment(actor: Actor, id: string, input: { installmentId?: unknown; reason?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(input.installmentId));
  if (!inst || inst.status !== "paid") throw new BusinessRuleError("Échéance non payée.");
  const later = loan.installments.find((x: { n: number; status: string }) => x.n > inst.n && x.status === "paid");
  if (later) throw new BusinessRuleError(`Annulez d'abord le paiement de l'échéance n° ${later.n}.`);
  await reverseCashFlow({ tenantId: actor.tenantId, userId: actor.userId, entryId: inst.entryId, movementId: inst.movementId, reason: String(input.reason ?? "paiement annulé").slice(0, 200) }, session);
  inst.status = "due"; inst.paidAt = undefined; inst.entryId = undefined; inst.movementId = undefined;
  loan.status = "active"; loan.markModified("installments");
  await loan.save({ session });
  return loan;
}

/** Échéance non payée ajustée au tableau remis par la banque. */
export async function adjustInstallment(actor: Actor, id: string, input: { installmentId?: unknown; principal?: unknown; interest?: unknown; insurance?: unknown; dueDate?: unknown }) {
  const loan = await load(actor, id);
  const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(input.installmentId));
  if (!inst || inst.status !== "due") throw new BusinessRuleError("Seule une échéance non payée s'ajuste.");
  for (const k of ["principal", "interest", "insurance"] as const) {
    if (input[k] === undefined) continue;
    const v = money(input[k]);
    if (!(v >= 0)) throw new BusinessRuleError("Montant invalide.");
    inst[k] = v;
  }
  if (input.dueDate) inst.dueDate = day(input.dueDate, "Date d'échéance");
  const capital = loan.installments.reduce((t: number, x: { principal: number }) => t + x.principal, 0);
  if (capital !== loan.principal) throw new BusinessRuleError(`Le capital des échéances (${capital.toLocaleString("fr-FR")}) doit égaler le capital emprunté (${loan.principal.toLocaleString("fr-FR")}) : ajustez aussi une autre échéance.`);
  inst.adjusted = true; loan.markModified("installments");
  await loan.save();
  return loan;
}

/** Suppression : seulement un emprunt sans aucune écriture. */
export async function deleteLoan(actor: Actor, id: string) {
  const loan = await load(actor, id);
  if (loan.disbursementEntryId || loan.installments.some((x: { status: string }) => x.status === "paid")) throw new BusinessRuleError("Des écritures existent : annulez d'abord les paiements, puis le déblocage.");
  await LoanModel.deleteOne({ _id: loan._id });
}

/** Capital restant dû (après les échéances payées ou antérieures) et prochaine échéance. */
export function loanState(loan: { principal: number; status: string; installments: Array<{ n: number; dueDate: Date; principal: number; interest: number; insurance: number; status: string }> }) {
  const repaid = loan.installments.filter(x => x.status !== "due").reduce((t, x) => t + x.principal, 0);
  const next = loan.installments.find(x => x.status === "due") ?? null;
  const overdue = loan.installments.filter(x => x.status === "due" && new Date(x.dueDate) < new Date());
  const due = loan.installments.filter(x => x.status === "due");
  return {
    remaining: loan.status === "draft" ? 0 : loan.principal - repaid,
    next: next ? { n: next.n, dueDate: next.dueDate, total: next.principal + next.interest + next.insurance } : null,
    overdue: { count: overdue.length, amount: overdue.reduce((t, x) => t + x.principal + x.interest + x.insurance, 0) },
    interestLeft: due.reduce((t, x) => t + x.interest, 0),
  };
}
