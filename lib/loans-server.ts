import { Types, type ClientSession } from "mongoose";
import { LoanModel } from "@/models/Loan";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { TenantModel } from "@/models/Tenant";
import { BusinessRuleError } from "@/lib/errors";
import { registerLedgerAccount, treasuryLedger } from "@/lib/treasury";
import { reverseCashFlow } from "@/lib/cash-posting";
import { addMonths, buildSchedule, FREQUENCIES, LENDER_TYPES, METHODS, type Frequency, type LenderType, type Method } from "@/lib/loan-schedule";
import { checkImputations } from "@/lib/imputation";
import { OPENING_REFERENCE } from "@/lib/opening-balances";

type Actor = { tenantId: string; userId: string };
export const LOAN_ACCOUNTS = {
  interest: { accountCode: "671000", accountLabel: "Intérêts des emprunts" },
  insurance: { accountCode: "625000", accountLabel: "Primes d'assurance" },
  fees: { accountCode: "631000", accountLabel: "Frais bancaires" },
};
const MAX_AMOUNT = 1e12;
export class LoanNotFound extends BusinessRuleError {}

/** Montant entier positif ou nul : null, texte vide ou valeur absurde sont refusés. */
function amount(v: unknown, what: string, { required = true } = {}) {
  if (v === undefined || v === "" || v === null) { if (required) throw new BusinessRuleError(`${what} obligatoire.`); return 0; }
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw new BusinessRuleError(`${what} invalide.`);
  return n;
}
/** Date AAAA-MM-JJ réelle (le 31 février est refusé, pas reporté au 3 mars). */
function day(v: unknown, what: string) {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(NaN);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BusinessRuleError(`${what} invalide.`);
  return d;
}
const today = () => { const d = new Date(Date.now() + 3600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

/** Date à partir de laquelle la comptabilité est tenue dans Kanoo (reprise, sinon lendemain du verrou). */
async function postingStart(tenantId: string) {
  const t = await TenantModel.findById(tenantId).select("accountingRestartDate accountingLockedUntil").lean<{ accountingRestartDate?: Date; accountingLockedUntil?: Date } | null>();
  if (t?.accountingRestartDate) return new Date(t.accountingRestartDate);
  if (t?.accountingLockedUntil) { const d = new Date(t.accountingLockedUntil); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); }
  return null;
}

export interface LoanInput {
  label?: unknown; lender?: unknown; lenderType?: unknown; capitalAccountCode?: unknown; reference?: unknown; treasuryAccountId?: unknown; principal?: unknown; annualRatePct?: unknown;
  durationMonths?: unknown; frequency?: unknown; method?: unknown; deferralPeriods?: unknown; startDate?: unknown; firstDueDate?: unknown;
  fees?: unknown; insurancePerPeriod?: unknown; purpose?: unknown; projectId?: unknown; collateral?: unknown; prior?: unknown; openingRemaining?: unknown; notes?: unknown;
}

/** Création : tableau calculé (ou prêt libre) ; rien n'est comptabilisé avant le déblocage. */
export async function createLoan(actor: Actor, input: LoanInput) {
  const label = String(input.label ?? "").trim(), lender = String(input.lender ?? "").trim();
  if (!label || !lender) throw new BusinessRuleError("Indiquez l'objet de l'emprunt et le prêteur.");
  const lenderType = String(input.lenderType ?? "bank") as LenderType;
  if (!(lenderType in LENDER_TYPES)) throw new BusinessRuleError("Type de prêteur invalide.");
  const capitalAccountCode = input.capitalAccountCode ? String(input.capitalAccountCode).trim() : LENDER_TYPES[lenderType].accountCode;
  if (!/^(16|17|46)\d{2,6}$/.test(capitalAccountCode)) throw new BusinessRuleError("Compte de la dette : 16…, 17… ou 46… (162 banque, 462 associé, 168 autres).");
  const principal = amount(input.principal, "Capital emprunté");
  if (!(principal > 0)) throw new BusinessRuleError("Capital emprunté invalide.");
  if (input.annualRatePct === null || input.annualRatePct === undefined || input.annualRatePct === "") throw new BusinessRuleError("Indiquez le taux (0 pour un prêt sans intérêt).");
  const rate = Number(String(input.annualRatePct).replace(",", ".")) / 100;
  if (!(rate >= 0 && rate < 1)) throw new BusinessRuleError("Taux annuel invalide (en %, par exemple 9,5 ; 0 sans intérêt).");
  const method = String(input.method ?? "annuity") as Method;
  if (!(method in METHODS)) throw new BusinessRuleError("Mode de remboursement invalide.");
  const free = method === "free";
  const frequency = String(input.frequency ?? "monthly") as Frequency;
  if (!(frequency in FREQUENCIES)) throw new BusinessRuleError("Périodicité invalide.");
  const durationMonths = free ? Math.max(1, Math.round(Number(input.durationMonths) || 12)) : Math.round(Number(input.durationMonths));
  if (!(durationMonths >= 1 && durationMonths <= 600)) throw new BusinessRuleError("Durée invalide (en mois).");
  if (!free && durationMonths % FREQUENCIES[frequency].months !== 0) throw new BusinessRuleError("La durée doit être un multiple de la périodicité.");
  const periods = Math.round(durationMonths / FREQUENCIES[frequency].months);
  const deferralPeriods = free ? 0 : amount(input.deferralPeriods ?? 0, "Différé");
  if (!free && deferralPeriods >= periods) throw new BusinessRuleError(`Différé trop long : au plus ${periods - 1} échéance(s) sur ${periods}.`);
  const startDate = day(input.startDate, "Date de déblocage");
  const firstDueDate = input.firstDueDate ? day(input.firstDueDate, free ? "Date de remboursement prévue" : "Première échéance") : free ? undefined : addMonths(startDate, FREQUENCIES[frequency].months);
  if (firstDueDate && firstDueDate <= startDate) throw new BusinessRuleError("L'échéance suit le déblocage.");
  const fees = amount(input.fees ?? 0, "Frais"), insurancePerPeriod = free ? 0 : amount(input.insurancePerPeriod ?? 0, "Assurance");
  if (fees >= principal) throw new BusinessRuleError("Les frais doivent rester inférieurs au capital.");
  if (!Types.ObjectId.isValid(String(input.treasuryAccountId)) || !(await treasuryLedger(actor.tenantId, input.treasuryAccountId))) throw new BusinessRuleError("Choisissez le compte (banque ou caisse) qui reçoit les fonds.");
  if (input.projectId) { const err = await checkImputations(actor.tenantId, [{ projectId: input.projectId }]); if (err) throw new BusinessRuleError(err); }

  // Emprunt antérieur à la reprise : la date de prise en compte est celle de la comptabilité, jamais libre.
  let postedFrom: Date | undefined, openingRemaining: number | undefined;
  if (input.prior === true || input.prior === "true") {
    const start = await postingStart(actor.tenantId);
    if (!start) throw new BusinessRuleError("Aucune reprise ni période close : saisissez l'emprunt normalement et débloquez-le.");
    if (startDate >= start) throw new BusinessRuleError(`Emprunt débloqué après le ${start.toISOString().slice(0, 10)} : ne le marquez pas comme antérieur, débloquez-le dans Kanoo.`);
    postedFrom = start;
    if (free) {
      openingRemaining = amount(input.openingRemaining, "Capital restant dû à la reprise");
      if (openingRemaining > principal) throw new BusinessRuleError("Le capital restant dû dépasse le capital emprunté.");
    }
  }
  const schedule = free ? [] : buildSchedule({ principal, annualRate: rate, durationMonths, frequency, method, deferralPeriods, firstDueDate: firstDueDate!, insurancePerPeriod });
  const installments = schedule.map(s => ({ n: s.n, dueDate: s.dueDate, principal: s.principal, interest: s.interest, insurance: s.insurance, status: postedFrom && s.dueDate < postedFrom ? "prior" : "due" }));
  if (postedFrom && !free) openingRemaining = principal - installments.filter(i => i.status === "prior").reduce((t, i) => t + i.principal, 0);
  const status = !postedFrom ? "draft" : (free ? openingRemaining === 0 : installments.every(i => i.status === "prior")) ? "closed" : "active";
  const [loan] = await LoanModel.create([{
    tenantId: actor.tenantId, label: label.slice(0, 160), lender: lender.slice(0, 160), lenderType, capitalAccountCode,
    capitalAccountLabel: capitalAccountCode === LENDER_TYPES[lenderType].accountCode ? LENDER_TYPES[lenderType].accountLabel : `Emprunt — ${lender.slice(0, 80)}`,
    reference: String(input.reference ?? "").trim().slice(0, 80) || undefined, treasuryAccountId: input.treasuryAccountId, principal, annualRate: rate,
    durationMonths, frequency, method, deferralPeriods, startDate, firstDueDate, fees, insurancePerPeriod,
    purpose: String(input.purpose ?? "").trim().slice(0, 300) || undefined, projectId: input.projectId || undefined,
    collateral: String(input.collateral ?? "").trim().slice(0, 500) || undefined, postedFrom, openingRemaining,
    notes: String(input.notes ?? "").slice(0, 2000) || undefined, installments, status, createdBy: actor.userId,
  }]);
  return loan;
}

async function load(actor: Actor, id: string, session?: ClientSession) {
  const loan = Types.ObjectId.isValid(id) ? await LoanModel.findOne({ _id: id, tenantId: actor.tenantId }).session(session ?? null) : null;
  if (!loan) throw new LoanNotFound("Emprunt introuvable.");
  return loan;
}
const capitalLine = (loan: { capitalAccountCode?: string; capitalAccountLabel?: string }) => ({ accountCode: loan.capitalAccountCode || "162000", accountLabel: loan.capitalAccountLabel || "Emprunts" });

async function postFlow(actor: Actor, loan: { _id: unknown; reference?: string; label: string }, treasuryAccountId: unknown, date: Date, label: string, lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number; projectId?: unknown }>, cash: number, session?: ClientSession) {
  const ledger = await treasuryLedger(actor.tenantId, treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
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

/** Bornes d'une date de paiement : ni avant le déblocage (ou la reprise), ni dans le futur. */
function paymentDate(loan: { disbursedAt?: Date; postedFrom?: Date; startDate: Date }, v: unknown, fallback: Date) {
  const d = v ? day(v, "Date de paiement") : fallback;
  const from = loan.disbursedAt ?? loan.postedFrom ?? loan.startDate;
  if (d < new Date(from)) throw new BusinessRuleError(`Date antérieure au ${new Date(from).toISOString().slice(0, 10)} (déblocage ou reprise).`);
  if (d > today()) throw new BusinessRuleError("Date de paiement dans le futur.");
  return d;
}

/** Déblocage : le prêteur verse le capital, moins les frais de dossier. */
export async function disburseLoan(actor: Actor, id: string, input: { date?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (loan.status !== "draft") throw new BusinessRuleError("Emprunt déjà débloqué.");
  const date = input.date ? day(input.date, "Date de déblocage") : loan.startDate;
  if (date > today()) throw new BusinessRuleError("Date de déblocage dans le futur.");
  const proj = loan.projectId ? { projectId: loan.projectId } : {};
  const lines = [{ ...capitalLine(loan), debit: 0, credit: loan.principal }, ...(loan.fees ? [{ ...LOAN_ACCOUNTS.fees, debit: loan.fees, credit: 0, ...proj }] : [])];
  const r = await postFlow(actor, loan, loan.treasuryAccountId, date, `Déblocage — ${loan.label} (${loan.lender})`, lines, loan.principal - loan.fees, session);
  loan.status = "active"; loan.disbursedAt = date; loan.disbursementEntryId = r.entryId; loan.disbursementMovementId = r.movementId;
  await loan.save({ session });
  return loan;
}

/** Déblocage annulé (erreur de date, de frais, de compte) : seulement sans remboursement enregistré. */
export async function undisburseLoan(actor: Actor, id: string, input: { reason?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (!loan.disbursementEntryId) throw new BusinessRuleError("Aucun déblocage comptabilisé.");
  if (loan.installments.some((x: { status: string }) => x.status === "paid")) throw new BusinessRuleError("Annulez d'abord les remboursements enregistrés.");
  await reverseCashFlow({ tenantId: actor.tenantId, userId: actor.userId, entryId: loan.disbursementEntryId, movementId: loan.disbursementMovementId, reason: String(input.reason ?? "déblocage annulé").slice(0, 200) }, session);
  loan.status = "draft"; loan.disbursedAt = undefined; loan.disbursementEntryId = undefined; loan.disbursementMovementId = undefined;
  await loan.save({ session });
  return loan;
}

function remainingOf(loan: { principal: number; method: string; openingRemaining?: number; postedFrom?: Date; installments: Array<{ status: string; principal: number }> }) {
  const base = loan.postedFrom && loan.openingRemaining !== undefined && loan.openingRemaining !== null ? loan.openingRemaining : loan.principal;
  // Avec une reprise, le restant de départ compte déjà les échéances antérieures : seules les payées s'en déduisent.
  const repaid = loan.installments.filter(x => x.status === "paid").reduce((t, x) => t + x.principal, 0);
  return Math.max(0, base - repaid);
}

/** Échéance payée : capital (compte de la dette), intérêts (671), assurance (625) contre la banque ou la caisse. */
export async function payInstallment(actor: Actor, id: string, input: { installmentId?: unknown; date?: unknown; treasuryAccountId?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (loan.status !== "active") throw new BusinessRuleError(loan.status === "draft" ? "Débloquez d'abord l'emprunt." : "Emprunt soldé.");
  if (loan.method === "free") throw new BusinessRuleError("Prêt sans échéancier : enregistrez un remboursement.");
  const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(input.installmentId));
  if (!inst) throw new BusinessRuleError("Échéance introuvable.");
  if (inst.status !== "due") throw new BusinessRuleError(inst.status === "paid" ? "Échéance déjà payée." : "Échéance antérieure à la reprise : payée hors Kanoo.");
  const earlier = loan.installments.find((x: { n: number; status: string }) => x.n < inst.n && x.status === "due");
  if (earlier) throw new BusinessRuleError(`Payez d'abord l'échéance n° ${earlier.n}.`);
  const date = paymentDate(loan, input.date, inst.dueDate > today() ? today() : inst.dueDate);
  const account = input.treasuryAccountId || loan.treasuryAccountId;
  const proj = loan.projectId ? { projectId: loan.projectId } : {};
  const total = inst.principal + inst.interest + inst.insurance;
  const lines = [
    ...(inst.principal ? [{ ...capitalLine(loan), debit: inst.principal, credit: 0 }] : []),
    ...(inst.interest ? [{ ...LOAN_ACCOUNTS.interest, debit: inst.interest, credit: 0, ...proj }] : []),
    ...(inst.insurance ? [{ ...LOAN_ACCOUNTS.insurance, debit: inst.insurance, credit: 0, ...proj }] : []),
  ];
  const r = await postFlow(actor, loan, account, date, `Échéance ${inst.n}/${loan.installments.length} — ${loan.label} (${loan.lender})`, lines, -total, session);
  inst.status = "paid"; inst.paidAt = date; inst.treasuryAccountId = account; inst.entryId = r.entryId; inst.movementId = r.movementId;
  if (loan.installments.every((x: { status: string }) => x.status !== "due")) loan.status = "closed";
  loan.markModified("installments");
  await loan.save({ session });
  return { loan, paid: { n: inst.n, principal: inst.principal, interest: inst.interest, insurance: inst.insurance, date } };
}

/** Prêt libre : remboursement d'un montant quelconque (capital, et intérêts s'il y en a). */
export async function repayFree(actor: Actor, id: string, input: { principal?: unknown; interest?: unknown; date?: unknown; treasuryAccountId?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  if (loan.method !== "free") throw new BusinessRuleError("Cet emprunt a un échéancier : payez ses échéances.");
  if (loan.status !== "active") throw new BusinessRuleError(loan.status === "draft" ? "Débloquez d'abord l'emprunt." : "Emprunt soldé.");
  const principal = amount(input.principal ?? 0, "Capital remboursé"), interest = amount(input.interest ?? 0, "Intérêts");
  if (!(principal + interest > 0)) throw new BusinessRuleError("Montant du remboursement invalide.");
  const rest = remainingOf(loan);
  if (principal > rest) throw new BusinessRuleError(`Le capital remboursé dépasse le reste dû (${rest.toLocaleString("fr-FR")} FCFA).`);
  const date = paymentDate(loan, input.date, today());
  const account = input.treasuryAccountId || loan.treasuryAccountId;
  const proj = loan.projectId ? { projectId: loan.projectId } : {};
  const n = loan.installments.length + 1;
  const lines = [...(principal ? [{ ...capitalLine(loan), debit: principal, credit: 0 }] : []), ...(interest ? [{ ...LOAN_ACCOUNTS.interest, debit: interest, credit: 0, ...proj }] : [])];
  const r = await postFlow(actor, loan, account, date, `Remboursement ${n} — ${loan.label} (${loan.lender})`, lines, -(principal + interest), session);
  loan.installments.push({ n, dueDate: date, principal, interest, insurance: 0, status: "paid", paidAt: date, treasuryAccountId: account, entryId: r.entryId, movementId: r.movementId });
  if (principal === rest) loan.status = "closed";
  await loan.save({ session });
  return { loan, paid: { n, principal, interest, date } };
}

/** Paiement annulé : écriture extournée et mouvement contre-passé (le dernier d'abord). */
export async function cancelInstallment(actor: Actor, id: string, input: { installmentId?: unknown; reason?: unknown }, session?: ClientSession) {
  const loan = await load(actor, id, session);
  const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(input.installmentId));
  if (!inst || inst.status !== "paid") throw new BusinessRuleError("Échéance non payée.");
  const later = loan.installments.find((x: { n: number; status: string }) => x.n > inst.n && x.status === "paid");
  if (later) throw new BusinessRuleError(`Annulez d'abord le paiement n° ${later.n}.`);
  await reverseCashFlow({ tenantId: actor.tenantId, userId: actor.userId, entryId: inst.entryId, movementId: inst.movementId, reason: String(input.reason ?? "paiement annulé").slice(0, 200) }, session);
  if (loan.method === "free") loan.installments = loan.installments.filter((x: { _id: unknown }) => String(x._id) !== String(inst._id));
  else { inst.status = "due"; inst.paidAt = undefined; inst.entryId = undefined; inst.movementId = undefined; }
  loan.status = "active"; loan.markModified("installments");
  await loan.save({ session });
  return loan;
}

/**
 * Ajustement au tableau remis par la banque : une ou plusieurs échéances non
 * payées en un seul envoi. Si le capital total ne retombe pas sur le capital
 * emprunté, la dernière échéance non touchée absorbe l'écart.
 */
export async function adjustInstallments(actor: Actor, id: string, input: { rows?: unknown; installmentId?: unknown; principal?: unknown; interest?: unknown; insurance?: unknown; dueDate?: unknown }) {
  const loan = await load(actor, id);
  if (loan.method === "free") throw new BusinessRuleError("Prêt sans échéancier : rien à ajuster.");
  const rows = (Array.isArray(input.rows) ? input.rows : [input]) as Array<Record<string, unknown>>;
  const before = loan.installments.map((x: { n: number; principal: number; interest: number; insurance: number; dueDate: Date }) => ({ n: x.n, principal: x.principal, interest: x.interest, insurance: x.insurance, dueDate: x.dueDate }));
  const touched = new Set<string>();
  for (const r of rows) {
    const inst = loan.installments.find((x: { _id: unknown }) => String(x._id) === String(r.installmentId));
    if (!inst || inst.status !== "due") throw new BusinessRuleError("Seule une échéance non payée s'ajuste.");
    for (const k of ["principal", "interest", "insurance"] as const) if (k in r) inst[k] = amount(r[k], k === "principal" ? "Capital" : k === "interest" ? "Intérêts" : "Assurance");
    if (r.dueDate) inst.dueDate = day(r.dueDate, "Date d'échéance");
    inst.adjusted = true; touched.add(String(inst._id));
  }
  let capital = loan.installments.reduce((t: number, x: { principal: number }) => t + x.principal, 0);
  if (capital !== loan.principal) {
    const last = [...loan.installments].reverse().find((x: { _id: unknown; status: string }) => x.status === "due" && !touched.has(String(x._id)));
    const diff = loan.principal - capital;
    if (!last || last.principal + diff < 0) throw new BusinessRuleError(`Le capital des échéances (${capital.toLocaleString("fr-FR")}) doit égaler le capital emprunté (${loan.principal.toLocaleString("fr-FR")}).`);
    last.principal += diff; last.adjusted = true; capital = loan.principal;
  }
  const dates = loan.installments.map((x: { dueDate: Date }) => new Date(x.dueDate).getTime());
  if (dates.some((d: number, i: number) => i > 0 && d < dates[i - 1]) || dates[0] <= new Date(loan.startDate).getTime()) throw new BusinessRuleError("Les échéances doivent rester dans l'ordre, après le déblocage.");
  loan.markModified("installments");
  await loan.save();
  return { loan, before };
}

/** Suppression : seulement un emprunt sans aucune écriture. */
export async function deleteLoan(actor: Actor, id: string) {
  const loan = await load(actor, id);
  if (loan.disbursementEntryId || loan.installments.some((x: { status: string }) => x.status === "paid")) throw new BusinessRuleError("Des écritures existent : annulez d'abord les paiements, puis le déblocage.");
  await LoanModel.deleteOne({ _id: loan._id });
}

/** Capital restant dû, prochaine échéance, retards, intérêts restants. */
export function loanState(loan: { principal: number; status: string; method?: string; openingRemaining?: number; postedFrom?: Date; firstDueDate?: Date; installments: Array<{ n: number; dueDate: Date; principal: number; interest: number; insurance: number; status: string }> }) {
  const remaining = loan.status === "draft" ? 0 : remainingOf({ method: loan.method ?? "annuity", ...loan });
  if (loan.method === "free") {
    const late = loan.status === "active" && loan.firstDueDate && new Date(loan.firstDueDate) < new Date();
    return { remaining, next: loan.status === "active" && loan.firstDueDate ? { n: 0, dueDate: loan.firstDueDate, total: remaining } : null, overdue: { count: late ? 1 : 0, amount: late ? remaining : 0 }, interestLeft: 0 };
  }
  const due = loan.installments.filter(x => x.status === "due");
  const next = due[0] ?? null;
  const overdue = due.filter(x => new Date(x.dueDate) < new Date());
  return {
    remaining,
    next: next ? { n: next.n, dueDate: next.dueDate, total: next.principal + next.interest + next.insurance } : null,
    overdue: { count: overdue.length, amount: overdue.reduce((t, x) => t + x.principal + x.interest + x.insurance, 0) },
    interestLeft: due.reduce((t, x) => t + x.interest, 0),
  };
}

/**
 * Contrôle de la reprise : capital restant des emprunts antérieurs, par compte
 * de dette, comparé au solde d'ouverture saisi par la comptable.
 */
export async function openingCheck(tenantId: string) {
  const loans = await LoanModel.find({ tenantId, postedFrom: { $exists: true } }).select("capitalAccountCode openingRemaining").lean<Array<{ capitalAccountCode?: string; openingRemaining?: number }>>();
  if (!loans.length) return [];
  const byAccount = new Map<string, number>();
  for (const l of loans) byAccount.set(l.capitalAccountCode || "162000", (byAccount.get(l.capitalAccountCode || "162000") ?? 0) + (l.openingRemaining ?? 0));
  const opening = await AccountingEntryModel.findOne({ tenantId, reference: OPENING_REFERENCE, reversedBy: { $exists: false }, reverses: { $exists: false } }).select("lines").lean<{ lines: Array<{ accountCode: string; debit: number; credit: number }> } | null>();
  return [...byAccount].map(([code, loansTotal]) => {
    const booked = opening ? opening.lines.filter(l => l.accountCode === code || l.accountCode.startsWith(code.replace(/0+$/, ""))).reduce((t, l) => t + l.credit - l.debit, 0) : null;
    return { accountCode: code, loans: loansTotal, opening: booked, gap: booked === null ? null : booked - loansTotal };
  });
}
