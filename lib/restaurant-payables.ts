import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { CommandeModel } from "@/models/Commande";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { PurchaseModel } from "@/models/Purchase";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { SupplierModel } from "@/models/Supplier";
import { BusinessRuleError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { payPurchase, validatePurchase, SUPPLIER_ACCOUNT } from "@/lib/purchases";
import { assertMonthOpen } from "@/lib/comptoir-sale";
import { lockAccount, mirrorTill } from "@/lib/restaurant-funding";
import { applyMovement } from "@/lib/stock";
import { syncLinkedItems } from "@/lib/comptoir-stock";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const DAY = 86_400_000;
type PurchaseDoc = Parameters<typeof payPurchase>[1];
interface OpenPurchase { _id: Id; number: string; date: Date; dueDate?: Date; supplierId?: Id; payee?: string; supplierRef?: string; totalTTC: number; paidAmount?: number; credits?: Array<{ amount: number }>; status: string; lines: Array<{ amountHT: number; accountCode: string; activityId?: Id }> }

/**
 * Dette fournisseur d'une réception à crédit : une facture validée (601 au
 * débit, 401 au crédit), imputée au secteur du site. La dette existe dès que
 * la marchandise est reçue ; le numéro de facture du fournisseur vient ensuite.
 * Hors résultat de gestion : l'achat de marchandises n'y compte qu'à la vente.
 */
export async function receptionDebt(auth: TokenPayload, deskId: string, input: { supplierId?: Id; supplier: string; reference?: string; date: Date; dueDays?: number; lines: Array<{ description: string; quantity: number; unitCost: number }> }, session?: ClientSession) {
  const lines = input.lines.filter(l => Math.round(l.quantity * l.unitCost) > 0);
  if (!lines.length) return null;
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("name activityId expenseAccount").session(session ?? null).lean<{ name: string; activityId?: Id; expenseAccount?: string } | null>();
  if (!desk) throw new BusinessRuleError("Site introuvable.");
  const term = input.supplierId ? (await SupplierModel.findOne({ _id: input.supplierId, tenantId: auth.tenantId }).select("paymentTermDays").session(session ?? null).lean<{ paymentTermDays?: number } | null>())?.paymentTermDays : undefined;
  const accountCode = desk.expenseAccount || "601100";
  const rows = lines.map(l => ({ description: l.description.slice(0, 300), accountCode, accountLabel: "Achats de marchandises", quantity: l.quantity, unitPrice: l.unitCost, amountHT: Math.round(l.quantity * l.unitCost), tvaRate: 0, amountTVA: 0, ...(desk.activityId ? { activityId: desk.activityId } : {}) }));
  const total = rows.reduce((t, r) => t + r.amountHT, 0);
  const number = await nextDocumentNumber(auth.tenantId, "purchase", { issueDate: input.date, session });
  const [p] = await PurchaseModel.create([{
    tenantId: auth.tenantId, number, kind: "invoice", deskId, ...(input.supplierId ? { supplierId: input.supplierId } : {}), payee: (input.supplier || "Fournisseur non précisé").slice(0, 160),
    ...(input.reference ? { supplierRef: input.reference.slice(0, 80) } : {}), date: input.date, dueDate: new Date(input.date.getTime() + (input.dueDays ?? term ?? 30) * DAY),
    lines: rows, totalHT: total, totalTVA: 0, totalTTC: total, notes: `Réception en réserve — ${desk.name}`, createdBy: auth.userId,
  }], { session });
  await validatePurchase(auth, p as unknown as Parameters<typeof validatePurchase>[1], session);
  return p._id as Id;
}

async function openPurchase(auth: TokenPayload, deskId: string, id: string, session?: ClientSession) {
  const p = await PurchaseModel.findOne({ _id: id, tenantId: auth.tenantId, deskId }).session(session ?? null);
  if (!p) throw new BusinessRuleError("Facture introuvable sur ce site.");
  return p;
}

/**
 * Règlement d'un fournisseur depuis la caisse du site : le paiement solde la
 * dette (401), il n'est pas un nouvel achat ; une sortie de caisse le reflète
 * pour que les espèces attendues restent justes. Avec `treasuryAccountId`
 * (banque, mobile money), la caisse du site n'est pas concernée.
 */
export async function paySupplier(auth: TokenPayload, deskId: string, purchaseId: string, input: { amount?: number; treasuryAccountId?: string; date?: Date }, session?: ClientSession) {
  const run = async (s?: ClientSession) => {
    const date = input.date ?? new Date();
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("treasuryAccountId").session(s ?? null).lean<{ treasuryAccountId?: Id } | null>();
    if (!desk) throw new BusinessRuleError("Site introuvable.");
    const account = input.treasuryAccountId ?? desk.treasuryAccountId;
    if (!account) throw new BusinessRuleError("Ce site n'a pas de caisse : choisissez le compte qui paie.");
    await lockAccount(auth.tenantId, account, s);
    await assertMonthOpen(auth.tenantId, deskId, date, s);
    const p = await openPurchase(auth, deskId, purchaseId, s);
    const doc = p as unknown as PurchaseDoc;
    // Une caisse de site : comme ses autres dépenses, contrôlée au comptage des espèces, pas sur le solde comptable.
    const till = await ActivityDeskModel.exists({ tenantId: auth.tenantId, treasuryAccountId: account }).session(s ?? null);
    const r = await payPurchase(auth, doc, { amount: input.amount, date, treasuryAccountId: account, allowOverdraft: !!till }, s);
    const paid = doc.payments.find(x => String(x._id) === String(r.paymentId));
    await mirrorTill(auth, account, { direction: "out", amount: r.amount, date, label: `Règlement fournisseur — ${doc.payee ?? ""} (${doc.number})`, category: "supplier_payment", entryId: paid?.entryId, movementId: paid?.movementId }, s);
    return { amount: r.amount, rest: doc.totalTTC - doc.paidAmount };
  };
  return session ? run(session) : withTransaction(run);
}

/**
 * Retour au fournisseur : la marchandise sort de la réserve, l'avoir réduit la
 * dette de la facture (401 au débit, 601 au crédit, même secteur). Ce n'est ni
 * une perte ni une vente. Article, quantité et prix viennent de la réception
 * de cette facture : on ne rend pas plus que reçu, ni plus cher que payé.
 */
export async function returnToSupplier(auth: TokenPayload, deskId: string, purchaseId: string, input: { lines: Array<{ itemId: string; quantity: number; unitCost?: number }>; reason: string; reference?: string }) {
  const reason = String(input.reason ?? "").trim().slice(0, 200);
  if (reason.length < 3) throw new BusinessRuleError("Motif du retour obligatoire.");
  if (!Array.isArray(input.lines) || !input.lines.length) throw new BusinessRuleError("Aucun article retourné.");
  const out = await withTransaction(async session => {
    const date = new Date();
    await assertMonthOpen(auth.tenantId, deskId, date, session);
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("reserveWarehouseId").session(session ?? null).lean<{ reserveWarehouseId?: Id } | null>();
    if (!desk?.reserveWarehouseId) throw new BusinessRuleError("Réserve du site introuvable.");
    const p = await openPurchase(auth, deskId, purchaseId, session);
    if (!["validated", "partial"].includes(p.status)) throw new BusinessRuleError(p.status === "paid" ? "Cette facture est soldée : un retour se règle alors par un remboursement, voyez la comptable." : "Cette facture ne peut pas recevoir d'avoir.");
    const logs = await PurchasePriceLogModel.find({ tenantId: auth.tenantId, purchaseId: p._id }).session(session ?? null).lean<Array<{ itemId: Id; quantity: number; unitCost: number; returned?: number; _id: Id }>>();
    let amount = 0;
    for (const l of input.lines) {
      const q = Number(l?.quantity);
      if (!Types.ObjectId.isValid(String(l?.itemId)) || !(q > 0) || !Number.isFinite(q)) throw new BusinessRuleError("Article ou quantité du retour invalide.");
      const log = logs.find(x => String(x.itemId) === String(l.itemId));
      if (!log) throw new BusinessRuleError("Cet article ne figure pas sur cette facture.");
      const left = Math.round((log.quantity - (log.returned ?? 0)) * 1000) / 1000;
      if (q > left) throw new BusinessRuleError(`On ne rend pas plus que reçu : ${left} au plus.`);
      const it = await ActivityItemModel.findOne({ _id: log.itemId, tenantId: auth.tenantId, deskId }).select("name productId").session(session ?? null).lean<{ name: string; productId?: Id } | null>();
      if (!it?.productId) throw new BusinessRuleError("Article introuvable en réserve.");
      await applyMovement({ tenantId: auth.tenantId, userId: auth.userId, productId: it.productId, warehouseId: desk.reserveWarehouseId, type: "exit", quantity: q, reason: `Retour fournisseur (${p.number}) — ${reason}`.slice(0, 300), linkedDocType: "comptoir", linkedDocId: p._id, linkedDocNumber: input.reference?.slice(0, 60) || p.number }, session);
      await PurchasePriceLogModel.updateOne({ _id: log._id }, { $inc: { returned: q } }, { session });
      log.returned = (log.returned ?? 0) + q;
      amount += Math.round(q * log.unitCost);
    }
    if (!(amount > 0)) throw new BusinessRuleError("Avoir nul : vérifiez le prix de la réception.");
    const credited = (p.credits ?? []).reduce((t: number, x: { amount: number }) => t + x.amount, 0);
    const rest = p.totalTTC - (p.paidAmount ?? 0);
    if (amount > rest) throw new BusinessRuleError(`L'avoir (${amount.toLocaleString("fr-FR")} FCFA) dépasse la dette restante de cette facture (${rest.toLocaleString("fr-FR")} FCFA) : voyez la comptable.`);
    const goods = p.lines[0];
    const third = p.supplierId ? { thirdPartyId: p.supplierId } : {};
    const [entry] = await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: "AC", entryDate: date, reference: `${p.number}-AV${(p.credits?.length ?? 0) + 1}`, label: `Avoir fournisseur ${p.number} — ${reason}`.slice(0, 300),
      lines: [{ ...SUPPLIER_ACCOUNT, debit: amount, credit: 0, ...third }, { accountCode: goods.accountCode, accountLabel: goods.accountLabel || "Achats de marchandises", debit: 0, credit: amount, ...(goods.activityId ? { activityId: goods.activityId } : {}) }],
      linkedDocType: "supplier_invoice", linkedDocId: p._id, createdBy: auth.userId,
    }], { session });
    p.credits = [...(p.credits ?? []), { date, amount, reason, reference: input.reference?.slice(0, 80), entryId: entry._id, by: auth.userId }];
    p.paidAmount = (p.paidAmount ?? 0) + amount;
    p.status = p.paidAmount >= p.totalTTC ? "paid" : "partial";
    await p.save({ session });
    return { amount, credited: credited + amount, rest: rest - amount };
  });
  await syncLinkedItems(auth.tenantId, deskId);
  return out;
}

/**
 * Valorisation d'une réception reçue sans prix : le coût moyen est corrigé sur
 * le stock en place et, si elle n'est pas payée, la dette naît ici. Jusque-là,
 * la marchandise est en stock sans dette : elle reste signalée à la comptable.
 */
export async function valueReception(auth: TokenPayload, deskId: string, ids: string[], unitCost: number) {
  const cost = Number(unitCost);
  if (!(cost > 0) || !Number.isFinite(cost) || cost > 1e9) throw new BusinessRuleError("Prix unitaire invalide.");
  return withTransaction(async session => {
    await assertMonthOpen(auth.tenantId, deskId, new Date(), session);
    const logs = await PurchasePriceLogModel.find({ _id: { $in: ids }, tenantId: auth.tenantId, deskId, unitCost: 0 }).populate("itemId", "name productId").session(session ?? null).lean<Array<{ _id: Id; quantity: number; date: Date; reference?: string; supplierId?: Id; supplierName?: string; paidFromCash: boolean; itemId?: { name: string; productId?: Id } }>>();
    if (!logs.length) throw new BusinessRuleError("Aucune réception à valoriser.");
    let total = 0;
    for (const l of logs) {
      const pid = l.itemId?.productId;
      if (pid) {
        const prod = await ProductModel.findOne({ _id: pid, tenantId: auth.tenantId }).select("purchaseCost").session(session ?? null).lean<{ purchaseCost?: number } | null>();
        const rows = await ProductStockModel.find({ tenantId: auth.tenantId, productId: pid }).select("qty").session(session ?? null).lean<Array<{ qty: number }>>();
        const stock = rows.reduce((t, r) => t + Math.max(0, r.qty), 0), c = prod?.purchaseCost ?? 0;
        // L'entrée est passée au coût moyen du moment : seul l'écart avec le vrai prix se répartit sur le stock restant.
        if (stock > 0) await ProductModel.updateOne({ _id: pid, tenantId: auth.tenantId }, { $set: { purchaseCost: Math.round((c + (l.quantity * (cost - c)) / stock) * 100) / 100 } }, { session });
      }
      await PurchasePriceLogModel.updateOne({ _id: l._id }, { $set: { unitCost: cost } }, { session });
      total += Math.round(l.quantity * cost);
      if (!l.paidFromCash) {
        const purchaseId = await receptionDebt(auth, deskId, { supplierId: l.supplierId, supplier: l.supplierName ?? "", reference: l.reference, date: l.date, lines: [{ description: l.itemId?.name ?? "Article", quantity: l.quantity, unitCost: cost }] }, session);
        if (purchaseId) await PurchasePriceLogModel.updateOne({ _id: l._id }, { $set: { purchaseId } }, { session });
      }
    }
    return { total, count: logs.length };
  });
}

/**
 * Compte de chaque fournisseur d'un site : factures ouvertes, avoirs, déjà
 * payé, reste dû, échéance. Le total du site est la dette fournisseur à ce jour.
 */
export async function supplierBalances(tenantId: string, deskId: string, now = new Date()) {
  const estimated = await CommandeModel.aggregate<{ v: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), sourceDeskId: new Types.ObjectId(deskId), status: { $in: ["partially_received", "received"] }, purchaseId: { $exists: false } } },
    { $unwind: "$lines" }, { $group: { _id: null, v: { $sum: { $multiply: [{ $ifNull: ["$lines.receivedQty", 0] }, { $ifNull: ["$lines.unitPrice", 0] }] } } } },
  ]);
  const list = await PurchaseModel.find({ tenantId, deskId, status: { $in: ["validated", "partial"] } }).sort({ dueDate: 1 }).select("number date dueDate supplierId payee supplierRef totalTTC paidAmount credits status").lean<OpenPurchase[]>();
  const groups = new Map<string, { supplier: string; invoices: Array<Record<string, unknown>>; total: number; credits: number; paid: number; rest: number; overdue: number }>();
  for (const p of list) {
    const k = String(p.supplierId ?? p.payee ?? "—");
    const g = groups.get(k) ?? { supplier: p.payee ?? "—", invoices: [], total: 0, credits: 0, paid: 0, rest: 0, overdue: 0 };
    const credits = (p.credits ?? []).reduce((t, c) => t + c.amount, 0), rest = p.totalTTC - (p.paidAmount ?? 0), late = !!p.dueDate && p.dueDate < now;
    g.invoices.push({ _id: String(p._id), number: p.number, ref: p.supplierRef ?? null, date: p.date, dueDate: p.dueDate ?? null, total: p.totalTTC, credits, paid: (p.paidAmount ?? 0) - credits, rest, late });
    g.total += p.totalTTC; g.credits += credits; g.paid += (p.paidAmount ?? 0) - credits; g.rest += rest; if (late) g.overdue += rest;
    groups.set(k, g);
  }
  const suppliers = [...groups.values()].sort((a, b) => b.rest - a.rest);
  // Commandes reçues dont la facture n'est pas enregistrée : une dette estimée, à part.
  return { suppliers, total: suppliers.reduce((t, s) => t + s.rest, 0), overdue: suppliers.reduce((t, s) => t + s.overdue, 0), estimatedOrders: Math.round(estimated[0]?.v ?? 0) };
}

/** Rapproche des réceptions de la facture du fournisseur : le numéro de facture rejoint la dette déjà créée. */
export async function linkInvoiceRef(tenantId: string, purchaseIds: Id[], ref: string) {
  if (purchaseIds.length) await PurchaseModel.updateMany({ _id: { $in: purchaseIds }, tenantId }, { $set: { supplierRef: ref.slice(0, 80) } });
}

/** Réceptions d'une facture, pour préparer un retour : article et prix payé. */
export async function purchaseLines(tenantId: string, deskId: string, purchaseId: string) {
  const logs = await PurchasePriceLogModel.find({ tenantId, deskId, purchaseId }).populate("itemId", "name unit").lean<Array<{ itemId?: { _id: Id; name: string; unit: string }; quantity: number; returned?: number; unitCost: number }>>();
  return logs.filter(l => l.itemId).map(l => ({ itemId: String(l.itemId!._id), name: l.itemId!.name, unit: l.itemId!.unit, quantity: Math.round((l.quantity - (l.returned ?? 0)) * 1000) / 1000, unitCost: l.unitCost }));
}
