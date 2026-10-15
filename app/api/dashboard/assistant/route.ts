import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { PaymentModel } from "@/models/Payment";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { accountBalance } from "@/lib/treasury";
import { BOOKED_INVOICE_MATCH, INVOICE_DUE_EXPR } from "@/lib/payments";
import { detectIntent, bestClient } from "@/lib/home-assistant";

export const dynamic = "force-dynamic";
const fmt = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
const DAY = 86_400_000;

/** POST { question } — réponse chiffrée, lue sur les données de l'organisation. */
export const POST = withAuth("invoices", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 300);
  if (!question) return badRequest("Posez une question.");
  const tid = new Types.ObjectId(auth.tenantId);
  const now = new Date();
  const open = { tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } };
  const intent = detectIntent(question);
  const reply = (answer: string, links: Array<{ href: string; label: string }> = []) => ok({ intent, answer, links });

  if (intent === "overdue") {
    const rows = await InvoiceModel.aggregate([{ $match: { ...open, dueDate: { $lt: now } } }, { $addFields: { due: INVOICE_DUE_EXPR } }, { $match: { due: { $gt: 0 } } }, { $sort: { dueDate: 1 } },
      { $lookup: { from: "clients", localField: "clientId", foreignField: "_id", as: "c" } }, { $project: { number: 1, due: 1, dueDate: 1, client: { $first: "$c.name" } } }]);
    if (!rows.length) return reply("Aucune facture en retard. 👍");
    const total = rows.reduce((t: number, r: { due: number }) => t + r.due, 0);
    const lines = rows.slice(0, 5).map((r: { number: string; due: number; dueDate: Date; client?: string }) => `• ${r.number} — ${r.client ?? "?"} : ${fmt(r.due)} (${Math.floor((now.getTime() - new Date(r.dueDate).getTime()) / DAY)} j de retard)`);
    return reply(`${rows.length} facture${rows.length > 1 ? "s" : ""} en retard, ${fmt(total)} au total :\n${lines.join("\n")}${rows.length > 5 ? `\n… et ${rows.length - 5} autre(s).` : ""}`, [{ href: "/invoices?overdue=true", label: "Voir les retards" }, { href: "/relances", label: "Relancer" }]);
  }

  if (intent === "drafts") {
    const rows = await InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: "draft" }).sort({ dueDate: 1 }).populate("clientId", "name").select("number totalTTC dueDate clientId").lean<Array<{ number: string; totalTTC: number; dueDate?: Date; clientId?: { name?: string } }>>();
    if (!rows.length) return reply("Aucun brouillon en attente : toutes vos factures sont émises.");
    const total = rows.reduce((t, r) => t + r.totalTTC, 0);
    const first = rows.find(r => r.dueDate);
    return reply(`${rows.length} brouillon${rows.length > 1 ? "s" : ""} pour ${fmt(total)}, pas encore émis${first?.dueDate ? ` — le premier échoit le ${new Date(first.dueDate).toLocaleDateString("fr-FR")}` : ""} :\n${rows.slice(0, 4).map(r => `• ${r.number} — ${r.clientId?.name ?? "?"} : ${fmt(r.totalTTC)}`).join("\n")}`, [{ href: "/invoices?status=draft", label: "Voir les brouillons" }]);
  }

  if (intent === "client_due" || intent === "receivables") {
    const rows = await InvoiceModel.aggregate([{ $match: open }, { $group: { _id: "$clientId", due: { $sum: INVOICE_DUE_EXPR }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", now] }, INVOICE_DUE_EXPR, 0] } }, n: { $sum: 1 } } }, { $match: { due: { $gt: 0 } } }]);
    const clients = await ClientModel.find({ tenantId: tid, _id: { $in: rows.map((r: { _id: unknown }) => r._id) } }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>();
    const withDue = clients.map(c => ({ ...c, ...(rows.find((r: { _id: Types.ObjectId }) => String(r._id) === String(c._id)) as { due: number; overdue: number; n: number }) }));
    if (intent === "client_due") {
      const target = bestClient(question, withDue) ?? bestClient(question, await ClientModel.find({ tenantId: tid }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>());
      if (!target) return reply("Je n'ai pas reconnu le client. Écrivez une partie de son nom, par exemple « Combien me doit Tahoua ? ».");
      const found = withDue.find(c => String(c._id) === String(target._id));
      if (!found) return reply(`${target.name} ne vous doit rien : aucune facture ouverte.`, [{ href: `/clients/${target._id}`, label: "Fiche client" }]);
      return reply(`${found.name} vous doit ${fmt(found.due)} sur ${found.n} facture${found.n > 1 ? "s" : ""}${found.overdue > 0 ? `, dont ${fmt(found.overdue)} en retard` : ", rien en retard"}.`, [{ href: `/clients/${found._id}`, label: "Fiche client" }, { href: `/clients/${found._id}/releve`, label: "Relevé" }]);
    }
    const total = withDue.reduce((t, c) => t + c.due, 0);
    const top = [...withDue].sort((a, b) => b.due - a.due).slice(0, 4);
    return reply(total > 0 ? `${fmt(total)} restent à encaisser chez ${withDue.length} client${withDue.length > 1 ? "s" : ""} :\n${top.map(c => `• ${c.name} : ${fmt(c.due)}${c.overdue > 0 ? ` (${fmt(c.overdue)} en retard)` : ""}`).join("\n")}` : "Rien à encaisser : toutes vos factures émises sont réglées.", [{ href: "/clients", label: "Clients" }]);
  }

  if (intent === "treasury") {
    if (!authCan(auth, "treasuryAccounts", "read")) return reply("La trésorerie n'est pas accessible avec votre rôle.");
    const accounts = await TreasuryAccountModel.find({ tenantId: tid, isActive: { $ne: false } }).select("label").lean<Array<{ _id: Types.ObjectId; label: string }>>();
    const balances = await Promise.all(accounts.map(async a => ({ label: a.label, b: (await accountBalance(auth.tenantId, String(a._id)))?.balance ?? 0 })));
    const total = balances.reduce((t, a) => t + a.b, 0);
    return reply(`Trésorerie disponible : ${fmt(total)}.\n${balances.map(a => `• ${a.label} : ${fmt(a.b)}`).join("\n")}`, [{ href: "/treasury", label: "Trésorerie" }, { href: "/treasury/prevision", label: "Prévision" }]);
  }

  if (intent === "revenue") {
    const sum = async (from: Date) => (await InvoiceModel.aggregate([{ $match: { tenantId: tid, issueDate: { $gte: from, $lte: now }, ...BOOKED_INVOICE_MATCH } }, { $group: { _id: null, t: { $sum: { $multiply: ["$totalTTC", { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] }] } } } }]))[0]?.t ?? 0;
    const [year, month] = await Promise.all([sum(new Date(now.getFullYear(), 0, 1)), sum(new Date(now.getFullYear(), now.getMonth(), 1))]);
    return reply(`Chiffre d'affaires facturé (TTC, avoirs déduits) : ${fmt(year)} depuis le 1er janvier, dont ${fmt(month)} ce mois-ci.`, [{ href: "/analytics", label: "Évolution sur 12 mois" }]);
  }

  if (intent === "collected") {
    if (!authCan(auth, "payments", "read")) return reply("Les encaissements ne sont pas accessibles avec votre rôle.");
    const r = await PaymentModel.aggregate([{ $match: { tenantId: tid, date: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }, status: { $nin: ["pending", "cancelled"] } } }, { $group: { _id: null, t: { $sum: "$amount" }, n: { $sum: 1 } } }]);
    return reply(`Encaissé ce mois-ci : ${fmt(r[0]?.t ?? 0)} en ${r[0]?.n ?? 0} règlement${(r[0]?.n ?? 0) > 1 ? "s" : ""}.`, [{ href: "/payments", label: "Encaissements" }]);
  }

  return reply("Je réponds aux questions sur vos factures, vos clients et votre trésorerie. Essayez :\n• « Combien me doit <client> ? »\n• « Quelles factures sont en retard ? »\n• « Résume mes brouillons »\n• « Quel est mon solde de trésorerie ? »\n• « Quel est mon chiffre d'affaires ? »");
});
