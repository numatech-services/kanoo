import { Types, type ClientSession } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ComptoirSaleModel, type ISaleLine } from "@/models/ComptoirSale";
import { CashClosingModel } from "@/models/CashClosing";
import { ProductModel } from "@/models/Product";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement, reverseMovement } from "@/lib/stock";
import { deskWarehouse } from "@/lib/comptoir-stock";
import { accountForMethod } from "@/lib/comptoir";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { reverseEntry } from "@/lib/accounting-reversal";
import { nextDocumentNumber } from "@/lib/numbering";
import { timbreQuittanceDu } from "@/lib/niger-fiscal";
import { STAMP_CHARGE, STAMP_DEBT } from "@/lib/payments";
import { saleLine, type SaleLineInput } from "@/lib/margins";
import type { TokenPayload } from "@/lib/auth";

export const SALE_METHODS = ["cash", "orange_money", "card", "bank_transfer", "check", "other"] as const;
const COLLECTED_VAT = { accountCode: "443000", accountLabel: "TVA collectée" };

/** Journée locale AAAA-MM-JJ. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Journée déjà arrêtée pour ce comptoir : plus rien ne s'y écrit. */
export async function assertDayOpen(tenantId: string, deskId: unknown, date: Date, session?: ClientSession) {
  const closed = await CashClosingModel.exists({ tenantId, deskId, day: { $gte: localDay(date) } }).session(session ?? null);
  if (closed) throw new BusinessRuleError(`La caisse est arrêtée au ${date.toLocaleDateString("fr-FR")} (ou après) : cette journée ne se modifie plus.`);
}

export interface SaleInput {
  deskId: string;
  date?: string;
  lines: Array<{ itemId: string; quantity: number; unitPriceTTC?: number; discount?: number }>;
  payments: Array<{ method: string; amount: number }>;
  /** Espèces remises par le client (pour le rendu monnaie). */
  cashGiven?: number;
  customerName?: string;
}

/**
 * Enregistre un ticket : sortie de stock de chaque ligne (coût figé),
 * encaissements par moyen sur le bon compte de trésorerie, écriture de vente
 * (produits HT par compte, TVA par article, timbre-quittance des espèces),
 * dans une seule transaction.
 */
export async function createSale(auth: TokenPayload, input: SaleInput, session?: ClientSession) {
  const tenantId = auth.tenantId;
  const desk = await ActivityDeskModel.findOne({ _id: input.deskId, tenantId }).session(session ?? null)
    .lean<{ _id: Types.ObjectId; name: string; activityId?: unknown; treasuryAccountId?: unknown; revenueAccount?: string; vatRate?: number } | null>();
  if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
  const date = input.date ? new Date(input.date) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  await assertDayOpen(tenantId, desk._id, date, session);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new BusinessRuleError("Le ticket est vide.");
  if (input.lines.length > 100) throw new BusinessRuleError("Ticket trop long (100 lignes au plus).");

  const number = await nextDocumentNumber(tenantId, "sale", { issueDate: date, session });
  const lines: ISaleLine[] = [];
  const warnings: string[] = [];
  const revenueByAccount = new Map<string, number>();
  for (const raw of input.lines) {
    const qty = Number(raw.quantity);
    if (!(qty > 0)) throw new BusinessRuleError("Quantité invalide.");
    const item = await ActivityItemModel.findOne({ _id: raw.itemId, tenantId, deskId: desk._id, archived: { $ne: true } }).session(session ?? null);
    if (!item) throw new BusinessRuleError("Article introuvable sur ce comptoir.");
    const product = item.productId
      ? await ProductModel.findOne({ _id: item.productId, tenantId }).select("tvaRate category accountCode label").session(session ?? null).lean<{ tvaRate?: number; category?: string; accountCode?: string } | null>()
      : null;
    // TVA de l'ARTICLE (comptoir assujetti) ; un comptoir non assujetti (taux 0) vend sans TVA.
    const tvaRate = !desk.vatRate ? 0 : product?.tvaRate ?? desk.vatRate;
    const price = raw.unitPriceTTC !== undefined && raw.unitPriceTTC !== null ? Number(raw.unitPriceTTC) : item.salePrice ?? 0;
    if (!(price >= 0)) throw new BusinessRuleError(`Prix invalide pour ${item.name}.`);

    // Sortie de stock et coût FIGÉ : le CMUP lu au moment de la sortie pour un
    // article du catalogue, le coût de l'article pour un article propre.
    let unitCost = item.unitCost || 0, stockMovementId: unknown, after: number;
    if (item.productId) {
      const wh = await deskWarehouse(tenantId, desk._id, session);
      const r = await applyMovement({
        tenantId, userId: auth.userId, productId: item.productId, warehouseId: wh, type: "exit", quantity: qty,
        reason: `Ticket ${number}`, linkedDocType: "comptoir", linkedDocId: desk._id, linkedDocNumber: number,
      }, session);
      unitCost = Number(r.movement.unitCost) || 0;
      stockMovementId = r.movement._id;
      after = r.after;
    } else {
      if (qty > (item.quantity || 0)) throw new BusinessRuleError(`Stock insuffisant pour ${item.name} (${item.quantity} ${item.unit}).`);
      after = (item.quantity || 0) - qty;
    }
    const [move] = await ActivityStockMoveModel.create([{
      tenantId, deskId: desk._id, itemId: item._id, type: "out", quantity: qty, quantityAfter: after,
      unitCost, reason: `Ticket ${number}`, stockMovementId, date, createdBy: auth.userId,
    }], { session });
    item.quantity = Math.max(0, after);
    await item.save({ session });

    const line = saleLine({ quantity: qty, unitPriceTTC: price, discount: Number(raw.discount) || 0, tvaRate, unitCost } as SaleLineInput);
    if (line.marginHT !== null && line.marginHT < 0) warnings.push(`${item.name} : vendu sous son coût (marge ${line.marginHT.toLocaleString("fr-FR")} FCFA).`);
    if (!unitCost) warnings.push(`${item.name} : sans coût d'achat, marge non calculée.`);
    if (item.threshold != null && after <= item.threshold) warnings.push(`${item.name} : stock bas (${after} ${item.unit}).`);
    lines.push({
      itemId: item._id, ...(item.productId ? { productId: item.productId } : {}), label: item.name, category: product?.category,
      ...line, stockMovementId: stockMovementId as Types.ObjectId | undefined, stockMoveId: move._id,
    });
    const account = product?.accountCode && /^7\d{2,7}$/.test(product.accountCode) ? product.accountCode : desk.revenueAccount || "701100";
    revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0) + line.totalHT);
  }

  const totalTTC = lines.reduce((t, l) => t + l.totalTTC, 0);
  const totalHT = lines.reduce((t, l) => t + l.totalHT, 0);
  const totalTVA = totalTTC - totalHT;
  const costTotal = lines.reduce((t, l) => t + l.costTotal, 0);
  const marginHT = lines.reduce((t, l) => t + (l.marginHT ?? 0), 0);

  // Paiements : leur somme fait le total du ticket (le rendu monnaie est à part).
  const payments = (Array.isArray(input.payments) && input.payments.length ? input.payments : [{ method: "cash", amount: totalTTC }])
    .map(p => ({ method: (SALE_METHODS as readonly string[]).includes(p.method) ? p.method : "other", amount: Math.round(Number(p.amount) || 0) }))
    .filter(p => p.amount > 0);
  const paid = payments.reduce((t, p) => t + p.amount, 0);
  if (paid !== totalTTC) throw new BusinessRuleError(`Les paiements (${paid.toLocaleString("fr-FR")}) doivent égaler le total du ticket (${totalTTC.toLocaleString("fr-FR")} FCFA).`);
  const cashDue = payments.filter(p => p.method === "cash").reduce((t, p) => t + p.amount, 0);
  const changeGiven = input.cashGiven && input.cashGiven > cashDue ? Math.round(input.cashGiven - cashDue) : 0;

  const withAccounts = [] as Array<{ method: string; amount: number; treasuryAccountId?: unknown }>;
  for (const p of payments) withAccounts.push({ ...p, ...(desk.treasuryAccountId ? { treasuryAccountId: await accountForMethod(tenantId, desk.treasuryAccountId, p.method, session) } : {}) });

  const [sale] = await ComptoirSaleModel.create([{
    tenantId, deskId: desk._id, number, date, lines, totalTTC, totalHT, totalTVA, costTotal, marginHT,
    payments: withAccounts, changeGiven, customerName: input.customerName ? String(input.customerName).slice(0, 120) : undefined,
    cashierId: auth.userId,
  }], { session });

  // Encaissements de la caisse du comptoir (un par moyen) : ils alimentent
  // l'onglet Caisse et l'arrêté ; la comptabilité vient du ticket.
  for (const p of withAccounts) {
    await ActivityCashEntryModel.create([{
      tenantId, deskId: desk._id, direction: "in", amount: p.amount, label: `Ticket ${number}`,
      method: p.method, date, saleId: sale._id, createdBy: auth.userId,
    }], { session });
  }

  // Écriture et trésorerie : seulement si le comptoir est relié à une caisse.
  if (desk.treasuryAccountId) {
    const tag = desk.activityId ? { activityId: desk.activityId } : {};
    const debit: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number }> = [];
    let journal: "BQ" | "CA" = "CA";
    for (const p of withAccounts) {
      const ledger = await treasuryLedger(tenantId, p.treasuryAccountId, session);
      if (!ledger) throw new BusinessRuleError("Compte de trésorerie du comptoir introuvable.");
      if (p === withAccounts[0]) journal = ledger.journalCode;
      debit.push({ accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: p.amount, credit: 0 });
      await TreasuryMovementModel.create([{
        tenantId, accountId: p.treasuryAccountId, date, amount: p.amount, label: `${desk.name} — ticket ${number}`, reference: number,
        source: "payment", linkedDocType: "comptoir_sale", linkedDocId: sale._id, createdBy: auth.userId,
      }], { session });
    }
    const stamp = timbreQuittanceDu({ cash: cashDue > 0, montantTTC: cashDue });
    if (stamp) await registerLedgerAccount(tenantId, STAMP_CHARGE.accountCode, STAMP_CHARGE.accountLabel, session);
    const [entry] = await AccountingEntryModel.create([{
      tenantId, journalCode: journal, entryDate: date, reference: number, label: `${desk.name} — ticket ${number}`,
      lines: [
        ...debit,
        ...[...revenueByAccount.entries()].filter(([, v]) => v > 0).map(([code, v]) => ({ accountCode: code, accountLabel: "Ventes du comptoir", debit: 0, credit: v, ...tag })),
        ...(totalTVA > 0 ? [{ ...COLLECTED_VAT, debit: 0, credit: totalTVA }] : []),
        // Timbre-quittance du reçu en espèces (CGI art. 560), charge de l'entreprise.
        ...(stamp ? [{ ...STAMP_CHARGE, debit: stamp, credit: 0, ...tag }, { ...STAMP_DEBT, debit: 0, credit: stamp }] : []),
      ],
      linkedDocType: "comptoir_sale", linkedDocId: sale._id, createdBy: auth.userId,
    }], { session });
    sale.entryId = entry._id;
    await sale.save({ session });
  }
  return { sale, warnings };
}

/** Annule un ticket : stock rendu, encaissements retirés, écriture et trésorerie extournées. */
export async function cancelSale(auth: TokenPayload, saleId: string, reason: string, session?: ClientSession) {
  const tenantId = auth.tenantId;
  const sale = await ComptoirSaleModel.findOne({ _id: saleId, tenantId }).session(session ?? null);
  if (!sale) throw new BusinessRuleError("Ticket introuvable.");
  if (sale.status === "cancelled") throw new BusinessRuleError("Ticket déjà annulé.");
  await assertDayOpen(tenantId, sale.deskId, new Date(sale.date), session);
  const claim = await ComptoirSaleModel.updateOne({ _id: sale._id, status: "paid" }, { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason.slice(0, 300) } }, { session });
  if (claim.modifiedCount !== 1) throw new BusinessRuleError("Ticket déjà annulé.");

  for (const l of sale.lines as ISaleLine[]) {
    const item = await ActivityItemModel.findOne({ _id: l.itemId, tenantId }).session(session ?? null);
    let after = (item?.quantity ?? 0) + l.quantity;
    if (l.stockMovementId) {
      const r = await reverseMovement({ tenantId, userId: auth.userId, movementId: l.stockMovementId, reason: `ticket ${sale.number} annulé` }, session);
      if (typeof (r as { after?: number }).after === "number") after = (r as { after: number }).after;
    }
    if (item) { item.quantity = Math.max(0, after); await item.save({ session }); }
    await ActivityStockMoveModel.create([{
      tenantId, deskId: sale.deskId, itemId: l.itemId, type: "in", quantity: l.quantity, quantityAfter: Math.max(0, after),
      unitCost: l.unitCost, reason: `Annulation du ticket ${sale.number}`, date: new Date(), createdBy: auth.userId,
    }], { session });
  }
  await ActivityCashEntryModel.deleteMany({ tenantId, saleId: sale._id }, { session });
  if (sale.entryId) await reverseEntry({ tenantId, userId: auth.userId, entryId: sale.entryId, reason: `ticket ${sale.number} annulé : ${reason}` }, session);
  const moves = await TreasuryMovementModel.find({ tenantId, linkedDocType: "comptoir_sale", linkedDocId: sale._id }).session(session ?? null).lean<Array<{ accountId: unknown; amount: number; label: string }>>();
  for (const m of moves) {
    await TreasuryMovementModel.create([{
      tenantId, accountId: m.accountId, date: new Date(), amount: -m.amount, label: `Annulation — ${m.label}`, reference: sale.number,
      source: "payment", linkedDocType: "comptoir_sale", linkedDocId: sale._id, createdBy: auth.userId,
    }], { session });
  }
  return sale;
}

const CASH_SHORTFALL = { accountCode: "658100", accountLabel: "Manquants de caisse" };
const CASH_SURPLUS = { accountCode: "758100", accountLabel: "Excédents de caisse" };

/** Totaux d'une journée de comptoir, par moyen de paiement, et ventes du jour. */
export async function dayFigures(tenantId: string, deskId: unknown, day: string, session?: ClientSession) {
  const from = new Date(`${day}T00:00:00.000`), to = new Date(`${day}T23:59:59.999`);
  const match = { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(String(deskId)), date: { $gte: from, $lte: to } };
  const [rows, sales] = await Promise.all([
    ActivityCashEntryModel.aggregate<{ _id: { m: string; d: string }; total: number }>([
      { $match: match }, { $group: { _id: { m: "$method", d: "$direction" }, total: { $sum: "$amount" } } },
    ]).session(session ?? null),
    ComptoirSaleModel.aggregate<{ n: number; ttc: number; margin: number }>([
      { $match: { ...match, status: "paid" } },
      { $group: { _id: null, n: { $sum: 1 }, ttc: { $sum: "$totalTTC" }, margin: { $sum: "$marginHT" } } },
    ]).session(session ?? null),
  ]);
  const methods = [...new Set(rows.map(r => r._id.m))];
  const byMethod = methods.map(m => ({
    method: m,
    receipts: rows.find(r => r._id.m === m && r._id.d === "in")?.total ?? 0,
    expenses: rows.find(r => r._id.m === m && r._id.d === "out")?.total ?? 0,
  }));
  const cash = byMethod.find(b => b.method === "cash");
  return {
    byMethod, cashNet: (cash?.receipts ?? 0) - (cash?.expenses ?? 0),
    salesCount: sales[0]?.n ?? 0, salesTTC: sales[0]?.ttc ?? 0, marginHT: Math.round(sales[0]?.margin ?? 0),
  };
}

/**
 * Arrête la caisse d'un comptoir pour une journée : enregistre le théorique
 * par moyen, les espèces comptées et l'écart, comptabilise l'écart (658100
 * manquant / 758100 excédent, contre la caisse) et verrouille la journée.
 */
export async function closeDay(auth: TokenPayload, input: { deskId: string; day: string; countedCash: number; openingFloat?: number; notes?: string }, session?: ClientSession) {
  const tenantId = auth.tenantId;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day || "")) throw new BusinessRuleError("Journée invalide.");
  if (input.day > localDay(new Date())) throw new BusinessRuleError("Une journée future ne s'arrête pas.");
  const counted = Math.round(Number(input.countedCash));
  if (!(counted >= 0)) throw new BusinessRuleError("Montant compté invalide.");
  const desk = await ActivityDeskModel.findOne({ _id: input.deskId, tenantId }).session(session ?? null)
    .lean<{ _id: Types.ObjectId; name: string; activityId?: unknown; treasuryAccountId?: unknown } | null>();
  if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
  if (await CashClosingModel.exists({ tenantId, deskId: desk._id, day: { $gte: input.day } }).session(session ?? null))
    throw new BusinessRuleError("Cette journée (ou une journée postérieure) est déjà arrêtée.");

  const f = await dayFigures(tenantId, desk._id, input.day, session);
  // Le fonds de caisse du matin est compté avec les espèces du soir.
  const theoreticalCash = Math.max(0, Math.round(Number(input.openingFloat) || 0)) + f.cashNet;
  const gap = counted - theoreticalCash;
  const [closing] = await CashClosingModel.create([{
    tenantId, deskId: desk._id, day: input.day, byMethod: f.byMethod, theoreticalCash, countedCash: counted, gap,
    salesCount: f.salesCount, salesTTC: f.salesTTC, marginHT: f.marginHT,
    notes: input.notes ? String(input.notes).slice(0, 500) : undefined, closedBy: auth.userId,
  }], { session });

  if (gap !== 0 && desk.treasuryAccountId) {
    const ledger = await treasuryLedger(tenantId, desk.treasuryAccountId, session);
    if (!ledger) throw new BusinessRuleError("Caisse du comptoir introuvable.");
    const counter = gap < 0 ? CASH_SHORTFALL : CASH_SURPLUS;
    await registerLedgerAccount(tenantId, counter.accountCode, counter.accountLabel, session);
    const amount = Math.abs(gap), tag = desk.activityId ? { activityId: desk.activityId } : {};
    const date = new Date(`${input.day}T23:59:00.000`);
    const label = `${desk.name} — ${gap < 0 ? "manquant" : "excédent"} de caisse du ${input.day}`;
    const [entry] = await AccountingEntryModel.create([{
      tenantId, journalCode: ledger.journalCode, entryDate: date, reference: `ARR-${input.day}`, label,
      lines: gap < 0
        ? [{ ...counter, debit: amount, credit: 0, ...tag }, { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount }]
        : [{ accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 }, { ...counter, debit: 0, credit: amount, ...tag }],
      linkedDocType: "cash_closing", linkedDocId: closing._id, createdBy: auth.userId,
    }], { session });
    await TreasuryMovementModel.create([{
      tenantId, accountId: desk.treasuryAccountId, date, amount: gap, label, reference: `ARR-${input.day}`,
      source: "manual", linkedDocType: "cash_closing", linkedDocId: closing._id, createdBy: auth.userId,
    }], { session });
    closing.entryId = entry._id;
    await closing.save({ session });
  }
  return closing;
}

/** Ticket sans coûts ni marges, pour un caissier (rôle non financier). */
export function hideCosts<T extends Record<string, unknown>>(sale: T): T {
  const lines = (sale.lines as Array<Record<string, unknown>> | undefined)?.map(({ unitCost: _u, costTotal: _c, marginHT: _m, ...l }) => l);
  const { costTotal: _c, marginHT: _m, ...rest } = sale;
  return { ...rest, ...(lines ? { lines } : {}) } as unknown as T;
}
