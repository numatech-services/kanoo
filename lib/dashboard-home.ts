import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { TokenPayload } from "@/lib/auth";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { PurchaseModel } from "@/models/Purchase";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { BOOKED_INVOICE_MATCH, INVOICE_DUE_EXPR, invoiceDue } from "@/lib/payments";
import { planForTenant } from "@/lib/dunning-context";
import { dailyBrief } from "@/lib/daily-brief-server";
import type { BriefItem } from "@/lib/daily-brief";

/**
 * Données du tableau de bord (charte v5), lues en une fois côté serveur.
 * Chaque bloc n'est calculé que si le rôle peut le voir ; un bloc absent est
 * `null` et l'écran le masque, plutôt que d'afficher zéro.
 */

type Can = (resource: string, action?: "read" | "create" | "update" | "delete") => boolean;
const DAY = 86_400_000;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (d: Date) => MONTHS[d.getMonth()];

export interface HomeInvoice {
  _id: string; number: string; client: string; clientId: string | null; issueDate: string; dueDate: string | null;
  totalTTC: number; remaining: number; status: string;
}
export interface HomeData {
  greeting: { salut: string; firstName: string; tenantName: string; month: string };
  hero: { overdueAmount: number; overdueCount: number; overdueClients: number; outstanding: number; outstandingCount: number } | null;
  kpis: {
    revenue?: { value: number; prev: number; trend: number[] };
    toCollect?: { value: number; count: number; trend: number[] };
    overdue?: { value: number; count: number; share: number };
    collected?: { value: number; prev: number; trend: number[] };
  };
  treasury: { balance: number; months: Array<{ label: string; balance: number }>; prevYear: number[]; forecast: Array<{ label: string; balance: number }> } | null;
  receivables: { total: number; clients: Array<{ clientId: string; name: string; due: number; overdue: number }> } | null;
  invoices: { items: HomeInvoice[]; counts: { all: number; overdue: number; draft: number; sent: number; paid: number } } | null;
  upcoming: HomeInvoice[] | null;
  reminders: { enabled: boolean; steps: Array<{ label: string; offsetDays: number; tone: string }>; next: Array<{ date: string; offsetDays: number; client: string; invoice: string; step: string }> } | null;
  objective: { target: number | null; invoiced: number; lastYear: number; canEdit: boolean } | null;
  brief: BriefItem[];
}

const salutation = (h: number) => (h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir");

export async function loadDashboard(auth: TokenPayload, can: Can): Promise<HomeData> {
  await connectDB();
  const tid = new Types.ObjectId(auth.tenantId);
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sameDayLastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
  const canInvoices = can("invoices"), canPayments = can("payments"), canTreasury = can("treasuryAccounts");

  const [user, tenant] = await Promise.all([
    UserModel.findById(auth.userId).select("firstName lastName").lean<{ firstName?: string; lastName?: string } | null>(),
    TenantModel.findById(auth.tenantId).select("name monthlyRevenueTarget").lean<{ name?: string; monthlyRevenueTarget?: number } | null>(),
  ]);
  const data: HomeData = {
    greeting: { salut: salutation(now.getHours()), firstName: user?.firstName || "", tenantName: tenant?.name || "", month: now.toLocaleDateString("fr-FR", { month: "long" }) },
    hero: null, kpis: {}, treasury: null, receivables: null, invoices: null, upcoming: null, reminders: null, objective: null, brief: [],
  };
  const open = { tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } };

  const invoicesBlock = async () => {
    if (!canInvoices) return;
    const signed = { $multiply: ["$totalTTC", { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] }] };
    const [ytd, prevYtd, byMonth, outstanding, overdue, recent, counts, monthInvoiced, lastYearMonth, upcoming] = await Promise.all([
      InvoiceModel.aggregate([{ $match: { tenantId: tid, issueDate: { $gte: startOfYear, $lte: now }, ...BOOKED_INVOICE_MATCH } }, { $group: { _id: null, t: { $sum: signed } } }]),
      InvoiceModel.aggregate([{ $match: { tenantId: tid, issueDate: { $gte: new Date(now.getFullYear() - 1, 0, 1), $lte: sameDayLastYear }, ...BOOKED_INVOICE_MATCH } }, { $group: { _id: null, t: { $sum: signed } } }]),
      InvoiceModel.aggregate([
        { $match: { tenantId: tid, issueDate: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) }, ...BOOKED_INVOICE_MATCH } },
        { $group: { _id: { y: { $year: "$issueDate" }, m: { $month: "$issueDate" } }, t: { $sum: signed } } },
      ]),
      InvoiceModel.aggregate([{ $match: open }, { $group: { _id: "$clientId", due: { $sum: INVOICE_DUE_EXPR }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", now] }, INVOICE_DUE_EXPR, 0] } }, n: { $sum: 1 } } }]),
      InvoiceModel.aggregate([{ $match: { ...open, dueDate: { $lt: now } } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: INVOICE_DUE_EXPR }, c: { $addToSet: "$clientId" } } }]),
      InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" } }).sort({ issueDate: -1, createdAt: -1 }).limit(40)
        .populate("clientId", "name").select("number clientId issueDate dueDate totalTTC paidAmount creditedAmount retentionAmount status")
        .lean<Array<{ _id: Types.ObjectId; number: string; clientId?: { _id: Types.ObjectId; name?: string }; issueDate: Date; dueDate?: Date; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status: string }>>(),
      InvoiceModel.aggregate([{ $match: { tenantId: tid, documentType: { $ne: "credit_note" } } }, { $group: { _id: { $cond: [{ $and: [{ $in: ["$status", ["sent", "partial", "overdue"]] }, { $lt: ["$dueDate", now] }] }, "overdue", "$status"] }, n: { $sum: 1 } } }]),
      InvoiceModel.aggregate([{ $match: { tenantId: tid, issueDate: { $gte: startOfMonth }, ...BOOKED_INVOICE_MATCH } }, { $group: { _id: null, t: { $sum: signed } } }]),
      InvoiceModel.aggregate([{ $match: { tenantId: tid, issueDate: { $gte: new Date(now.getFullYear() - 1, now.getMonth(), 1), $lt: new Date(now.getFullYear() - 1, now.getMonth() + 1, 1) }, ...BOOKED_INVOICE_MATCH } }, { $group: { _id: null, t: { $sum: signed } } }]),
      InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["draft", "sent", "partial"] }, dueDate: { $gte: new Date(now.getTime() - DAY), $lte: new Date(now.getTime() + 30 * DAY) } })
        .sort({ dueDate: 1 }).limit(5).populate("clientId", "name").select("number clientId issueDate dueDate totalTTC paidAmount creditedAmount retentionAmount status")
        .lean<Array<{ _id: Types.ObjectId; number: string; clientId?: { _id: Types.ObjectId; name?: string }; issueDate: Date; dueDate?: Date; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status: string }>>(),
    ]);
    const toHome = (i: (typeof recent)[number]): HomeInvoice => {
      const overdueNow = ["sent", "partial", "overdue"].includes(i.status) && i.dueDate && new Date(i.dueDate) < now;
      return {
        _id: String(i._id), number: i.number, client: i.clientId?.name ?? "—", clientId: i.clientId?._id ? String(i.clientId._id) : null,
        issueDate: new Date(i.issueDate).toISOString(), dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
        totalTTC: i.totalTTC, remaining: i.status === "draft" ? i.totalTTC : invoiceDue(i), status: overdueNow ? "overdue" : i.status,
      };
    };
    const trend = Array.from({ length: 12 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1);
      return (byMonth as Array<{ _id: { y: number; m: number }; t: number }>).find(x => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1)?.t ?? 0;
    });
    const out = (outstanding as Array<{ _id: Types.ObjectId; due: number; overdue: number; n: number }>).filter(x => x.due > 0);
    const outTotal = out.reduce((t, x) => t + x.due, 0);
    const od = overdue[0] as { n: number; t: number; c: unknown[] } | undefined;
    const cnt = new Map((counts as Array<{ _id: string; n: number }>).map(c => [c._id, c.n]));

    data.kpis.revenue = { value: ytd[0]?.t ?? 0, prev: prevYtd[0]?.t ?? 0, trend };
    data.kpis.toCollect = { value: outTotal, count: out.reduce((t, x) => t + x.n, 0), trend: trend.slice(-6) };
    data.kpis.overdue = { value: Math.max(0, od?.t ?? 0), count: od?.n ?? 0, share: outTotal > 0 ? Math.round(((od?.t ?? 0) / outTotal) * 100) : 0 };
    data.hero = { overdueAmount: Math.max(0, od?.t ?? 0), overdueCount: od?.n ?? 0, overdueClients: od?.c?.length ?? 0, outstanding: outTotal, outstandingCount: data.kpis.toCollect.count };

    // Créances par client : les cinq plus fortes, le reste regroupé.
    const ids = out.map(x => x._id).filter(Boolean);
    const names = new Map((await (await import("@/models/Client")).ClientModel.find({ tenantId: tid, _id: { $in: ids } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>()).map(c => [String(c._id), c.name]));
    const sorted = [...out].sort((a, b) => b.due - a.due);
    const top = sorted.slice(0, 5).map(x => ({ clientId: String(x._id), name: names.get(String(x._id)) ?? "Client", due: Math.round(x.due), overdue: Math.round(Math.max(0, x.overdue)) }));
    const rest = sorted.slice(5);
    if (rest.length) top.push({ clientId: "", name: `${rest.length} autre${rest.length > 1 ? "s" : ""} client${rest.length > 1 ? "s" : ""}`, due: Math.round(rest.reduce((t, x) => t + x.due, 0)), overdue: Math.round(rest.reduce((t, x) => t + Math.max(0, x.overdue), 0)) });
    data.receivables = { total: Math.round(outTotal), clients: top };

    data.invoices = {
      items: recent.map(toHome),
      counts: {
        all: [...cnt.values()].reduce((t, n) => t + n, 0) - (cnt.get("cancelled") ?? 0),
        overdue: cnt.get("overdue") ?? 0, draft: cnt.get("draft") ?? 0,
        sent: (cnt.get("sent") ?? 0) + (cnt.get("partial") ?? 0), paid: cnt.get("paid") ?? 0,
      },
    };
    data.upcoming = upcoming.map(toHome);
    data.objective = { target: tenant?.monthlyRevenueTarget ?? null, invoiced: Math.round(monthInvoiced[0]?.t ?? 0), lastYear: Math.round(lastYearMonth[0]?.t ?? 0), canEdit: can("companies", "update") };
  };

  const paymentsBlock = async () => {
    if (!canPayments) return;
    const effective = { status: { $nin: ["pending", "cancelled"] } };
    const [thisMonth, prevMonth, byMonth] = await Promise.all([
      PaymentModel.aggregate([{ $match: { tenantId: tid, date: { $gte: startOfMonth }, ...effective } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
      PaymentModel.aggregate([{ $match: { tenantId: tid, date: { $gte: startOfPrevMonth, $lt: startOfMonth }, ...effective } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
      PaymentModel.aggregate([{ $match: { tenantId: tid, date: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) }, ...effective } }, { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, t: { $sum: "$amount" } } }]),
    ]);
    data.kpis.collected = {
      value: thisMonth[0]?.t ?? 0, prev: prevMonth[0]?.t ?? 0,
      trend: Array.from({ length: 6 }, (_, k) => {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + k, 1);
        return (byMonth as Array<{ _id: { y: number; m: number }; t: number }>).find(x => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1)?.t ?? 0;
      }),
    };
  };

  const treasuryBlock = async () => {
    if (!canTreasury) return;
    // Solde réel fin de mois sur 24 mois : soldes d'ouverture + mouvements cumulés.
    const accounts = await TreasuryAccountModel.find({ tenantId: tid, isActive: { $ne: false } }).select("openingBalance balance").lean<Array<{ openingBalance?: number; balance?: number }>>();
    const opening = accounts.reduce((t, a) => t + (a.openingBalance ?? a.balance ?? 0), 0);
    const windowStart = new Date(now.getFullYear(), now.getMonth() - 23, 1);
    const [before, moves] = await Promise.all([
      TreasuryMovementModel.aggregate([{ $match: { tenantId: tid, date: { $lt: windowStart } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
      TreasuryMovementModel.aggregate([{ $match: { tenantId: tid, date: { $gte: windowStart } } }, { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, t: { $sum: "$amount" } } }]),
    ]);
    let running = opening + (before[0]?.t ?? 0);
    const series: Array<{ label: string; balance: number }> = [];
    for (let k = 0; k < 24; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 23 + k, 1);
      running += (moves as Array<{ _id: { y: number; m: number }; t: number }>).find(x => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1)?.t ?? 0;
      series.push({ label: monthLabel(d), balance: Math.round(running) });
    }
    const balance = series[series.length - 1].balance;
    // Prévision à 30, 60, 90 jours : créances qui tombent (les retards comptés à 30 j) moins les achats à régler.
    const horizon = async (days: number) => {
      const limit = new Date(now.getTime() + days * DAY);
      const [inn, outt] = await Promise.all([
        canInvoices ? InvoiceModel.aggregate([{ $match: { ...open, dueDate: { $lte: limit } } }, { $group: { _id: null, t: { $sum: INVOICE_DUE_EXPR } } }]) : [],
        PurchaseModel.aggregate([{ $match: { tenantId: tid, status: { $in: ["validated", "partial"] }, $or: [{ dueDate: { $lte: limit } }, { dueDate: { $exists: false } }] } }, { $group: { _id: null, t: { $sum: { $subtract: ["$totalTTC", { $ifNull: ["$paidAmount", 0] }] } } } }]),
      ]);
      return Math.round(balance + Math.max(0, inn[0]?.t ?? 0) - Math.max(0, outt[0]?.t ?? 0));
    };
    const forecast = await Promise.all([30, 60, 90].map(async d => ({ label: `+${d} j`, balance: await horizon(d) })));
    data.treasury = { balance, months: series.slice(12), prevYear: series.slice(0, 12).map(s => s.balance), forecast };
  };

  const remindersBlock = async () => {
    if (!canInvoices) return;
    try {
      // Prochains envois : pour chaque facture ouverte, la prochaine étape du
      // barème dont la date (échéance + décalage) n'est pas encore passée.
      const { settings, context } = await planForTenant(auth.tenantId, now);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const nameOf = (id: unknown) => { const c = context.clients.get(String(id)) as { name?: string } | undefined; return String(c?.name ?? ""); };
      const next: NonNullable<HomeData["reminders"]>["next"] = [];
      for (const inv of context.invoices) {
        if (!inv.dueDate || invoiceDue({ totalTTC: inv.totalTTC, paidAmount: inv.paidAmount, creditedAmount: inv.creditedAmount, retentionAmount: inv.retentionAmount, status: inv.status }) < settings.minAmount) continue;
        const due = new Date(inv.dueDate); due.setHours(0, 0, 0, 0);
        const step = [...settings.steps].sort((a, b) => a.offsetDays - b.offsetDays).find(st => due.getTime() + st.offsetDays * DAY >= today);
        if (step) next.push({ date: new Date(due.getTime() + step.offsetDays * DAY).toISOString(), offsetDays: step.offsetDays, client: nameOf(inv.clientId), invoice: inv.number, step: step.label });
      }
      next.sort((a, b) => a.date.localeCompare(b.date));
      data.reminders = { enabled: settings.enabled, steps: settings.steps.map(st => ({ label: st.label, offsetDays: st.offsetDays, tone: st.tone })), next: next.slice(0, 5) };
    } catch { data.reminders = null; }
  };

  const briefBlock = async () => {
    try { data.brief = (await dailyBrief(auth, can, 3)).items; } catch { data.brief = []; }
  };

  // Blocs indépendants (chacun remplit ses propres champs) : en parallèle
  // plutôt que l'un après l'autre, le temps d'affichage est celui du plus lent.
  await Promise.all([invoicesBlock(), paymentsBlock(), treasuryBlock(), remindersBlock(), briefBlock()]);
  return data;
}
