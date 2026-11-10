import { Types } from "mongoose";
import { LoanModel } from "@/models/Loan";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { InvoiceModel } from "@/models/Invoice";
import { PurchaseModel } from "@/models/Purchase";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { accountBalance } from "@/lib/treasury";

export type ForecastFlow = { label: string; amount: number; kind: "in" | "out"; source: string; date: Date; ref?: string };
type Flow = ForecastFlow;

function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

/**
 * Prévision de trésorerie par semaine : soldes actuels + encaissements attendus
 * (factures clients ouvertes, à leur échéance) − décaissements attendus
 * (factures fournisseurs, charges récurrentes, salaires, notes de frais
 * approuvées). Les retards sont placés en semaine 1 : c'est de l'argent attendu
 * maintenant.
 *
 * Un seul calcul pour l'écran (GET /api/treasury-accounts/forecast) et pour
 * l'alerte automatique de découvert (lib/automation-jobs.ts) : l'alerte ne
 * peut pas annoncer un chiffre que l'écran ne montre pas.
 */
export async function computeForecast(tenantId: string, weeks: number, at: Date = new Date()) {
  const tf = { tenantId: new Types.ObjectId(tenantId) };
  const now = new Date(at); now.setHours(0, 0, 0, 0);
  const horizon = new Date(now.getTime() + weeks * 7 * 86400000);

  const accounts = await TreasuryAccountModel.find({ ...tf, isActive: true }).select("_id label type").lean<Array<{ _id: Types.ObjectId; label: string; type: string }>>();
  const balances = await Promise.all(accounts.map(a => accountBalance(tenantId, String(a._id))));
  const opening = balances.reduce((s, b) => s + (b?.balance ?? 0), 0);

  const flows: Flow[] = [];
  const [invoices, purchases, recurring, employees, unpaidSlips, reports] = await Promise.all([
    InvoiceModel.find({ ...tf, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } })
      .select("number dueDate totalTTC paidAmount creditedAmount retentionAmount clientId").populate("clientId", "name")
      .lean<Array<{ number: string; dueDate?: Date; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; clientId?: { name?: string } }>>(),
    PurchaseModel.find({ ...tf, status: { $in: ["validated", "partial"] } }).select("number dueDate date totalTTC paidAmount payee")
      .lean<Array<{ number: string; dueDate?: Date; date: Date; totalTTC: number; paidAmount: number; payee?: string }>>(),
    RecurringExpenseModel.find({ ...tf, isActive: true }).select("label amount frequency nextDueDate endDate")
      .lean<Array<{ label: string; amount: number; frequency: string; nextDueDate: Date; endDate?: Date }>>(),
    EmployeeModel.find({ ...tf, isActive: true }).select("_id grossSalary indemnity employeeType").lean<Array<{ _id: Types.ObjectId; grossSalary?: number; indemnity?: number; employeeType?: string }>>(),
    PayslipModel.find({ ...tf, isPaid: false }).select("netSalary month year").lean<Array<{ netSalary: number; month: number; year: number }>>(),
    ExpenseReportModel.find({ ...tf, status: "approved" }).select("reference totalTTC").lean<Array<{ reference: string; totalTTC: number }>>(),
  ]);

  for (const i of invoices) {
    // La retenue de garantie ne rentre qu'à la réception définitive : hors de l'horizon.
    const rest = i.totalTTC - (i.paidAmount ?? 0) - (i.creditedAmount ?? 0) - (i.retentionAmount ?? 0);
    if (rest > 0) flows.push({ label: `Facture ${i.number}${i.clientId?.name ? ` — ${i.clientId.name}` : ""}`, amount: rest, kind: "in", source: "Clients", date: i.dueDate ?? now, ref: i.number });
  }
  for (const p of purchases) {
    const rest = p.totalTTC - p.paidAmount;
    if (rest > 0) flows.push({ label: `${p.number}${p.payee ? ` — ${p.payee}` : ""}`, amount: rest, kind: "out", source: "Fournisseurs", date: p.dueDate ?? p.date, ref: p.number });
  }
  const step: Record<string, (d: Date) => Date> = {
    daily: d => new Date(d.getTime() + 86400000), weekly: d => new Date(d.getTime() + 7 * 86400000),
    monthly: d => addMonths(d, 1), quarterly: d => addMonths(d, 3), biannual: d => addMonths(d, 6), annual: d => addMonths(d, 12),
  };
  for (const r of recurring) {
    let d = new Date(r.nextDueDate);
    const next = step[r.frequency] ?? step.monthly;
    // Une charge qui prend fin (bail, contrat) ne se prolonge pas jusqu'à l'horizon.
    const until = r.endDate && new Date(r.endDate) < horizon ? new Date(r.endDate) : horizon;
    for (let n = 0; d <= until && n < 400; n++, d = next(d)) flows.push({ label: r.label, amount: r.amount, kind: "out", source: "Charges récurrentes", date: d });
  }
  // Salaires : bulletins générés non payés, puis estimation des mois à venir
  // (dernier net connu par salarié, sinon 85 % du brut ou l'indemnité).
  for (const s of unpaidSlips) flows.push({ label: `Salaires ${s.month}/${s.year} (bulletins à payer)`, amount: s.netSalary, kind: "out", source: "Salaires", date: now });
  const lastNets = await PayslipModel.aggregate<{ _id: Types.ObjectId; net: number }>([
    { $match: { ...tf, employeeId: { $in: employees.map(e => e._id) } } },
    { $sort: { year: -1, month: -1 } },
    { $group: { _id: "$employeeId", net: { $first: "$netSalary" } } },
  ]);
  const netBy = new Map(lastNets.map(x => [String(x._id), x.net]));
  const monthlyPayroll = employees.reduce((s, e) => s + (netBy.get(String(e._id)) ?? (e.employeeType === "employee" ? Math.round((e.grossSalary ?? 0) * 0.85) : e.indemnity ?? 0)), 0);
  const paidOrGenerated = new Set(unpaidSlips.map(s => `${s.year}-${s.month}`));
  if (monthlyPayroll > 0) {
    for (let m = 0; m < 13; m++) {
      const end = new Date(now.getFullYear(), now.getMonth() + m + 1, 0);
      if (end > horizon) break;
      const key = `${end.getFullYear()}-${end.getMonth() + 1}`;
      const already = await PayslipModel.exists({ ...tf, year: end.getFullYear(), month: end.getMonth() + 1 });
      if (already || paidOrGenerated.has(key)) continue;
      flows.push({ label: `Salaires ${end.getMonth() + 1}/${end.getFullYear()} (estimation)`, amount: monthlyPayroll, kind: "out", source: "Salaires", date: end });
    }
  }
  // Emprunts : échéances non payées (capital, intérêts, assurance).
  const loans = await LoanModel.find({ tenantId, status: { $in: ["active", "draft"] } }).select("label lender status principal fees startDate installments").lean<Array<{ label: string; lender: string; status: string; principal: number; fees: number; startDate: Date; installments: Array<{ n: number; dueDate: Date; principal: number; interest: number; insurance: number; status: string }> }>>();
  // Emprunt pas encore débloqué : les fonds attendus entrent à la date prévue.
  for (const l of loans) if (l.status === "draft") flows.push({ label: `Déblocage attendu — ${l.label} (${l.lender})`, amount: l.principal - (l.fees || 0), kind: "in", source: "Emprunts", date: new Date(l.startDate) < now ? now : new Date(l.startDate) });
  for (const l of loans) for (const i of l.installments) {
    if (i.status !== "due") continue;
    flows.push({ label: `Échéance ${i.n} — ${l.label} (${l.lender})`, amount: i.principal + i.interest + i.insurance, kind: "out", source: "Emprunts", date: new Date(i.dueDate) < now ? now : new Date(i.dueDate) });
  }
  for (const r of reports) flows.push({ label: `Note de frais ${r.reference}`, amount: r.totalTTC, kind: "out", source: "Notes de frais", date: now, ref: r.reference });

  // Semaines : semaine 1 = retards + cette semaine.
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(now.getTime() + i * 7 * 86400000);
    return { start, end: new Date(start.getTime() + 7 * 86400000 - 1), in: 0, out: 0, flows: [] as Flow[] };
  });
  for (const f of flows) {
    const t = new Date(f.date).getTime();
    if (t > horizon.getTime()) continue;
    const idx = t < now.getTime() ? 0 : Math.min(weeks - 1, Math.floor((t - now.getTime()) / (7 * 86400000)));
    const b = buckets[idx];
    if (f.kind === "in") b.in += f.amount; else b.out += f.amount;
    b.flows.push(f);
  }
  let running = opening;
  const series = buckets.map(b => {
    running += b.in - b.out;
    return { start: b.start, end: b.end, in: b.in, out: b.out, balance: running, flows: b.flows.sort((x, y) => y.amount - x.amount) };
  });
  const lowest = series.reduce((m, s) => (s.balance < m.balance ? s : m), series[0]);
  return {
    opening, accounts: accounts.map((a, i) => ({ label: a.label, type: a.type, balance: balances[i]?.balance ?? 0 })),
    weeks: series, lowest: lowest ? { balance: lowest.balance, weekStart: lowest.start } : null,
    totals: { in: series.reduce((s, x) => s + x.in, 0), out: series.reduce((s, x) => s + x.out, 0) },
    notes: ["Retards clients et fournisseurs placés en première semaine.", "Salaires futurs estimés d'après le dernier bulletin de chaque salarié."],
  };
}
export type TreasuryForecast = Awaited<ReturnType<typeof computeForecast>>;
