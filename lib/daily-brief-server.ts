import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { InvoiceModel } from "@/models/Invoice";
import { PurchaseModel } from "@/models/Purchase";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { RecurringExpenseModel } from "@/models/RecurringExpense";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { AdminDocumentModel } from "@/models/AdminDocument";
import { ApprobationModel } from "@/models/Approbation";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { DevisModel } from "@/models/Devis";
import { ProductStockModel } from "@/models/ProductStock";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { OPEN_APPEL_STATUSES, daysUntil } from "@/lib/appels";
import { ContractModel } from "@/models/Contract";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { retentionState } from "@/lib/retention";
import { GUARANTEE_TYPES, daysToExpiry } from "@/lib/guarantees";
import { accountBalance } from "@/lib/treasury";
import { formatMoney, formatDateLong } from "@/lib/format";
import { rankBrief, plural, type BriefCandidate, type BriefItem } from "@/lib/daily-brief";
import type { TokenPayload } from "@/lib/auth";

const DAY = 86_400_000;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

type Can = (resource: string, action?: "read" | "create" | "update" | "delete") => boolean;

/**
 * Candidats du brief, lus dans les données de l'organisation et limités à ce
 * que l'utilisateur a le droit de voir : un commercial ne reçoit pas d'alerte
 * de trésorerie, un comptable ne reçoit pas les devis à relancer.
 * Chaque lecture est indépendante : une erreur sur l'une n'empêche pas les autres.
 */
export async function briefCandidates(auth: TokenPayload, can: Can, now = new Date()): Promise<BriefCandidate[]> {
  await connectDB();
  const tid = new Types.ObjectId(auth.tenantId);
  const out: BriefCandidate[] = [];
  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* un capteur en panne ne bloque pas le brief */ } };
  const days = (d: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / DAY);
  const in30 = new Date(now.getTime() + 30 * DAY);

  // Encaissements attendus et retards clients.
  let receivable30 = 0;
  if (can("invoices")) await safe(async () => {
    const open = await InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } })
      .select("number dueDate totalTTC paidAmount creditedAmount retentionAmount").lean<Array<{ number: string; dueDate: Date; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number }>>();
    const due = (i: typeof open[number]) => Math.max(0, i.totalTTC - (i.paidAmount ?? 0) - (i.creditedAmount ?? 0) - (i.retentionAmount ?? 0));
    const late = open.filter(i => new Date(i.dueDate) < now && due(i) > 0);
    receivable30 = open.filter(i => new Date(i.dueDate) <= in30).reduce((t, i) => t + due(i), 0);
    if (late.length) {
      const amount = late.reduce((t, i) => t + due(i), 0);
      const oldest = late.reduce((m, i) => Math.max(m, days(i.dueDate)), 0);
      out.push({ kind: "overdue_receivables", amount, daysLate: oldest,
        title: `Relancer ${plural(late.length, "facture")} en retard`,
        why: `${formatMoney(amount)} restent dus ; ${oldest > 0 ? `la plus ancienne a ${oldest} jour${oldest > 1 ? "s" : ""} de retard` : "échéance dépassée aujourd'hui"}.`,
        href: "/relances", cta: "Voir les relances" });
    }
    const drafts = await InvoiceModel.find({ tenantId: tid, documentType: { $ne: "credit_note" }, status: "draft", createdAt: { $lt: new Date(now.getTime() - DAY) } })
      .select("totalTTC createdAt").lean<Array<{ totalTTC: number; createdAt: Date }>>();
    if (drafts.length) {
      const amount = drafts.reduce((t, i) => t + i.totalTTC, 0);
      out.push({ kind: "draft_invoices", amount, daysLate: drafts.reduce((m, i) => Math.max(m, days(i.createdAt)), 0),
        title: `Émettre ${plural(drafts.length, "facture")} restée${drafts.length > 1 ? "s" : ""} au brouillon`,
        why: `${formatMoney(amount)} ne sont ni comptabilisés ni réclamés au client tant que ces factures ne sont pas émises.`,
        href: "/invoices?status=draft", cta: "Voir les brouillons" });
    }
  });

  // Factures fournisseurs à payer.
  let payable30 = 0;
  if (can("purchases")) await safe(async () => {
    const open = await PurchaseModel.find({ tenantId: tid, status: { $in: ["validated", "partial"] } })
      .select("number dueDate totalTTC paidAmount").lean<Array<{ dueDate?: Date; totalTTC: number; paidAmount?: number }>>();
    const rest = (p: typeof open[number]) => Math.max(0, p.totalTTC - (p.paidAmount ?? 0));
    payable30 = open.filter(p => !p.dueDate || new Date(p.dueDate) <= in30).reduce((t, p) => t + rest(p), 0);
    const late = open.filter(p => p.dueDate && new Date(p.dueDate) < now);
    const soon = open.filter(p => p.dueDate && new Date(p.dueDate) >= now && new Date(p.dueDate) <= new Date(now.getTime() + 7 * DAY));
    if (late.length) {
      const amount = late.reduce((t, p) => t + rest(p), 0);
      const oldest = late.reduce((m, p) => Math.max(m, days(p.dueDate!)), 0);
      out.push({ kind: "supplier_overdue", amount, daysLate: oldest,
        title: `Régler ${plural(late.length, "facture fournisseur", "factures fournisseurs")} échue${late.length > 1 ? "s" : ""}`,
        why: `${formatMoney(amount)} dus, jusqu'à ${oldest} jour${oldest > 1 ? "s" : ""} de retard : la relation fournisseur et les pénalités sont en jeu.`,
        href: "/depenses?due=overdue", cta: "Voir les factures" });
    } else if (soon.length) {
      const amount = soon.reduce((t, p) => t + rest(p), 0);
      const first = soon.reduce((m, p) => Math.min(m, Math.ceil((new Date(p.dueDate!).getTime() - now.getTime()) / DAY)), 99);
      out.push({ kind: "supplier_due", amount, daysLeft: first,
        title: `Préparer le paiement de ${plural(soon.length, "facture fournisseur", "factures fournisseurs")}`,
        why: `${formatMoney(amount)} arrivent à échéance dans les 7 jours (première dans ${first} jour${first > 1 ? "s" : ""}).`,
        href: "/depenses", cta: "Voir les achats" });
    }
  });

  // Trésorerie projetée à 30 jours.
  if (can("treasuryAccounts") && can("invoices")) await safe(async () => {
    const accounts = await TreasuryAccountModel.find({ tenantId: tid, isActive: { $ne: false } }).select("_id").lean<Array<{ _id: unknown }>>();
    if (!accounts.length) return;
    let cash = 0;
    for (const a of accounts) cash += (await accountBalance(auth.tenantId, String(a._id)))?.balance ?? 0;
    const charges = await RecurringExpenseModel.find({ tenantId: tid, isActive: { $ne: false }, nextDueDate: { $lte: in30 } })
      .select("amount").lean<Array<{ amount: number }>>();
    const fixed = charges.reduce((t, c) => t + c.amount, 0);
    const projected = Math.round(cash + receivable30 - payable30 - fixed);
    if (projected < 0) {
      out.push({ kind: "treasury_shortfall", amount: -projected, daysLeft: 15,
        title: "Anticiper un manque de trésorerie",
        why: `Solde actuel ${formatMoney(cash)}, encaissements attendus ${formatMoney(receivable30)}, sorties prévues ${formatMoney(payable30 + fixed)} : il manquerait ${formatMoney(-projected)} d'ici 30 jours.`,
        href: "/treasury/prevision", cta: "Voir la prévision" });
    }
  });

  // TVA du mois précédent, à déposer avant le 20.
  if (can("fiscalDeclarations")) await safe(async () => {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const deadline = new Date(now.getFullYear(), now.getMonth(), 20);
    const left = Math.ceil((deadline.getTime() - now.getTime()) / DAY);
    if (left < 0 || left > 12) return;
    const done = await FiscalDeclarationModel.exists({ tenantId: tid, type: "tva", "period.annee": prev.getFullYear(), "period.mois": prev.getMonth() + 1, status: { $in: ["submitted", "paid"] } });
    if (done) return;
    out.push({ kind: "vat_deadline", daysLeft: left,
      title: `Déclarer la TVA de ${MONTHS[prev.getMonth()]}`,
      why: `Date limite le ${formatDateLong(deadline)}, dans ${left} jour${left > 1 ? "s" : ""}. La déclaration est préparée à partir de la comptabilité.`,
      href: "/fiscalite/tva", cta: "Préparer la déclaration" });
  });

  // Documents administratifs (RCCM, NIF, assurance…) échus ou à renouveler.
  if (can("documents")) await safe(async () => {
    const docs = await AdminDocumentModel.find({ tenantId: tid, archivedAt: { $exists: false }, expiresAt: { $lte: in30 }, renewalStartedAt: { $exists: false } })
      .select("label type expiresAt").lean<Array<{ label?: string; type: string; expiresAt: Date }>>();
    const expired = docs.filter(d => new Date(d.expiresAt) < now);
    const soon = docs.filter(d => new Date(d.expiresAt) >= now);
    if (expired.length) out.push({ kind: "admin_doc_expired", daysLate: expired.reduce((m, d) => Math.max(m, days(d.expiresAt)), 0),
      title: `Renouveler ${plural(expired.length, "document administratif échu", "documents administratifs échus")}`,
      why: `${expired.map(d => d.label || d.type.toUpperCase()).slice(0, 3).join(", ")} : un document échu peut bloquer un marché public ou un paiement.`,
      href: "/documents-administratifs", cta: "Voir le coffre" });
    else if (soon.length) {
      const first = soon.reduce((m, d) => Math.min(m, Math.ceil((new Date(d.expiresAt).getTime() - now.getTime()) / DAY)), 99);
      out.push({ kind: "admin_doc_expiring", daysLeft: first,
        title: `Lancer le renouvellement de ${plural(soon.length, "document", "documents")}`,
        why: `${soon.map(d => d.label || d.type.toUpperCase()).slice(0, 3).join(", ")} expire${soon.length > 1 ? "nt" : ""} dans moins de 30 jours (premier dans ${first} jour${first > 1 ? "s" : ""}).`,
        href: "/documents-administratifs", cta: "Voir le coffre" });
    }
  });

  // Validations qui attendent cet utilisateur.
  await safe(async () => {
    const me = new Types.ObjectId(auth.userId);
    const mine = await ApprobationModel.find({ tenantId: tid, status: "pending", approvers: { $elemMatch: { userId: me, status: "pending" } } })
      .select("amount currentLevel approvers createdAt").lean<Array<{ amount?: number; currentLevel?: number; approvers: Array<{ userId: unknown; level?: number; status: string }>; createdAt: Date }>>();
    const actionable = mine.filter(a => a.approvers.some(x => String(x.userId) === auth.userId && x.status === "pending" && (x.level ?? 1) === (a.currentLevel ?? 1)));
    if (actionable.length) out.push({ kind: "approvals_pending", amount: actionable.reduce((t, a) => t + (a.amount ?? 0), 0),
      daysLate: actionable.reduce((m, a) => Math.max(m, days(a.createdAt)), 0),
      title: `Décider de ${plural(actionable.length, "demande", "demandes")} d'approbation`,
      why: "Elles attendent votre décision pour avancer ; la plus ancienne attend depuis "
        + `${actionable.reduce((m, a) => Math.max(m, days(a.createdAt)), 0)} jour(s).`,
      href: "/approbations", cta: "Décider" });
  });
  if (can("expenses", "update")) await safe(async () => {
    const reports = await ExpenseReportModel.find({ tenantId: tid, status: "submitted" }).select("submittedAt totalTTC").lean<Array<{ submittedAt?: Date; totalTTC?: number }>>();
    if (reports.length) out.push({ kind: "expenses_to_validate", amount: reports.reduce((t, r) => t + (r.totalTTC ?? 0), 0),
      daysLate: reports.reduce((m, r) => Math.max(m, r.submittedAt ? days(r.submittedAt) : 0), 0),
      title: `Valider ${plural(reports.length, "note de frais", "notes de frais")}`,
      why: "Des collaborateurs attendent leur remboursement.", href: "/notes-de-frais", cta: "Valider" });
  });

  // Devis envoyés qui expirent dans la semaine.
  if (can("devis")) await safe(async () => {
    const quotes = await DevisModel.find({ tenantId: tid, status: "sent", validUntil: { $gte: now, $lte: new Date(now.getTime() + 7 * DAY) } })
      .select("totalTTC validUntil").lean<Array<{ totalTTC: number; validUntil: Date }>>();
    if (quotes.length) {
      const first = quotes.reduce((m, q) => Math.min(m, Math.ceil((new Date(q.validUntil).getTime() - now.getTime()) / DAY)), 99);
      out.push({ kind: "quotes_expiring", amount: quotes.reduce((t, q) => t + q.totalTTC, 0), daysLeft: first,
        title: `Relancer ${plural(quotes.length, "devis")} avant expiration`,
        why: `${formatMoney(quotes.reduce((t, q) => t + q.totalTTC, 0))} d'offres en attente de réponse, la première expire dans ${first} jour${first > 1 ? "s" : ""}.`,
        href: "/devis?status=sent", cta: "Voir les devis" });
    }
  });

  // Appels d'offres dont la date limite de dépôt approche (14 jours).
  if (can("appels")) await safe(async () => {
    const open = await AppelCandidatureModel.find({ tenantId: tid, status: { $in: OPEN_APPEL_STATUSES },
      submissionDeadline: { $gte: new Date(new Date(now).setHours(0, 0, 0, 0)), $lte: new Date(now.getTime() + 14 * DAY) } })
      .sort({ submissionDeadline: 1 }).select("title estimatedAmount submissionDeadline requiredDocuments")
      .lean<Array<{ _id: unknown; title: string; estimatedAmount?: number; submissionDeadline: Date; requiredDocuments?: Array<{ provided: boolean }> }>>();
    if (open.length) {
      const first = open[0], left = daysUntil(first.submissionDeadline, now);
      const missing = (first.requiredDocuments ?? []).filter(d => !d.provided).length;
      const when = left === 0 ? "aujourd'hui" : left === 1 ? "demain" : `dans ${left} jours`;
      out.push({ kind: "tender_deadline", amount: first.estimatedAmount || undefined, daysLeft: left,
        title: open.length > 1 ? `Préparer ${plural(open.length, "dossier")} d'appel d'offres` : `Déposer « ${first.title} »`,
        why: `Dépôt ${when}${open.length > 1 ? ` pour « ${first.title} »` : ""}${missing ? `, ${plural(missing, "pièce")} encore à réunir` : ", dossier complet"}.`,
        href: open.length > 1 ? "/appels" : `/appels/${String(first._id)}`, cta: "Ouvrir le dossier" });
    }
  });

  // Retenues de garantie dont le délai de garantie est écoulé : à réclamer.
  if (can("contracts") && can("invoices")) await safe(async () => {
    const held = await InvoiceModel.aggregate<{ _id: unknown; invoices: Array<{ retentionAmount: number; status: string }> }>([
      { $match: { tenantId: tid, documentType: "invoice", retentionAmount: { $gt: 0 }, status: { $ne: "cancelled" }, contractId: { $exists: true } } },
      { $group: { _id: "$contractId", invoices: { $push: { retentionAmount: "$retentionAmount", status: "$status" } } } },
    ]);
    if (!held.length) return;
    const contracts = await ContractModel.find({ tenantId: tid, _id: { $in: held.map(h => h._id) } })
      .select("reference title retentionReleases receptionProvisoireDate receptionDefinitiveDate guaranteeMonths")
      .lean<Array<{ _id: unknown; reference: string; title: string; retentionReleases?: Array<{ amount: number }>; receptionProvisoireDate?: Date; receptionDefinitiveDate?: Date; guaranteeMonths?: number }>>();
    const claimable = contracts.map(c => ({ c, s: retentionState(held.find(h => String(h._id) === String(c._id))!.invoices, c, now) })).filter(x => x.s.claimable);
    if (!claimable.length) return;
    const amount = claimable.reduce((t, x) => t + x.s.outstanding, 0);
    const late = claimable.reduce((m, x) => Math.max(m, days(new Date(x.s.releasableFrom!))), 0);
    const one = claimable.length === 1 ? claimable[0].c : null;
    out.push({ kind: "retention_claimable", amount, daysLate: late,
      title: one ? `Réclamer la retenue de garantie du marché ${one.reference}` : `Réclamer ${plural(claimable.length, "retenue")} de garantie`,
      why: `${formatMoney(amount)} retenus par vos clients, délai de garantie écoulé : demandez la réception définitive et le reversement.`,
      href: one ? `/contracts/${String(one._id)}` : "/contracts/rentabilite", cta: "Voir le marché" });
  });

  // Cautions bancaires échues (mainlevée à demander) ou qui arrivent à échéance.
  if (can("appels")) await safe(async () => {
    const list = await BankGuaranteeModel.find({ tenantId: tid, status: "active", expiryDate: { $lte: new Date(now.getTime() + 15 * DAY) } })
      .sort({ expiryDate: 1 }).select("type amount beneficiary expiryDate").lean<Array<{ _id: unknown; type: keyof typeof GUARANTEE_TYPES; amount: number; beneficiary: string; expiryDate: Date }>>();
    if (!list.length) return;
    const expired = list.filter(g => (daysToExpiry(g.expiryDate, now) ?? 0) < 0);
    const amount = list.reduce((t, g) => t + g.amount, 0);
    const first = list[0], left = daysToExpiry(first.expiryDate, now) ?? 0;
    out.push({ kind: "guarantee_due", amount, ...(expired.length ? { daysLate: -left } : { daysLeft: left }),
      title: expired.length ? `Obtenir la mainlevée de ${plural(expired.length, "caution")}` : `${plural(list.length, "caution")} arrive${list.length > 1 ? "nt" : ""} à échéance`,
      why: expired.length
        ? `${GUARANTEE_TYPES[first.type]} (${first.beneficiary}) échue : tant que la mainlevée n'est pas obtenue, la banque facture et garde le dépôt.`
        : `${GUARANTEE_TYPES[first.type]} (${first.beneficiary}) échoit dans ${left} jour${left > 1 ? "s" : ""} : prorogez-la ou demandez la mainlevée.`,
      href: "/cautions", cta: "Voir les cautions" });
  });

  // Articles sous le seuil d'alerte.
  if (can("products")) await safe(async () => {
    const low = await ProductStockModel.countDocuments({ tenantId: tid, minAlert: { $gt: 0 }, $expr: { $lte: ["$qty", "$minAlert"] } });
    if (low) out.push({ kind: "stock_low", title: `Réapprovisionner ${plural(low, "article")}`,
      why: "Le stock est passé sous le seuil d'alerte : risque de rupture.", href: "/stock?alertOnly=true", cta: "Voir le stock" });
  });

  // Comptoirs dont la caisse reste hors comptabilité.
  if (can("comptoir") && can("accountingEntries")) await safe(async () => {
    const n = await ActivityDeskModel.countDocuments({ tenantId: tid, archived: { $ne: true }, treasuryAccountId: { $exists: false } });
    if (n) out.push({ kind: "desk_unlinked", title: `Relier ${plural(n, "comptoir")} à sa caisse`,
      why: "Ses ventes n'apparaissent ni au compte de résultat ni en trésorerie tant qu'il n'est pas relié.", href: "/comptoir", cta: "Paramétrer" });
  });

  return out;
}

export async function dailyBrief(auth: TokenPayload, can: Can, limit = 3): Promise<{ items: BriefItem[]; total: number }> {
  const candidates = await briefCandidates(auth, can);
  return { items: rankBrief(candidates, limit), total: candidates.length };
}
