import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { DeskPreorderModel } from "@/models/DeskPreorder";
import { IntegrationEventModel } from "@/models/IntegrationEvent";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement } from "@/lib/stock";
import { deskWarehouse } from "@/lib/comptoir-stock";
import { createSale, cancelSale, localDay, assertDayOpen, firstOpenDate } from "@/lib/comptoir-sale";
import { recordLoss, recordCounts } from "@/lib/spot-server";
import { treasuryLedger, registerLedgerAccount } from "@/lib/treasury";
import { productionPlan } from "@/lib/campus-server";
import { EASYPAY_ACCOUNT, parseEvent, lossReasonFor, sameName, catalogueVersion, type ItemRef, type ParsedEvent } from "@/lib/easypay";
import type { ApiV1Context } from "@/lib/api-v1-middleware";
import type { TokenPayload } from "@/lib/auth";

export const SOURCE = "easypay";

type ItemDoc = InstanceType<typeof ActivityItemModel>;

/**
 * Auteur des écritures venues d'EasyPay : la personne qui a créé la clé. Si
 * elle a quitté l'organisation (compte désactivé), la clé n'écrit plus rien.
 */
export async function easypayActor(ctx: { tenantId: string; userId?: string }): Promise<TokenPayload> {
  const user = ctx.userId
    ? await UserModel.findOne({ _id: ctx.userId, tenantId: ctx.tenantId, isActive: { $ne: false } }).select("role email").lean<{ _id: Types.ObjectId; role: TokenPayload["role"]; email: string } | null>()
    : null;
  if (!user) throw new BusinessRuleError("La personne qui a créé cette clé n'a plus accès à Kanoo : créez une nouvelle clé.");
  const tenant = await TenantModel.findById(ctx.tenantId).select("type").lean<{ type: TokenPayload["tenantType"] } | null>();
  return {
    userId: String(user._id), tenantId: ctx.tenantId, tenantType: tenant?.type ?? "pme", role: user.role, email: user.email,
    subscriptionStatus: "active", planModules: [],
  };
}

const bookingDate = firstOpenDate;

/**
 * Article Kanoo d'un article EasyPay : par l'id Kanoo s'il est connu, sinon
 * par l'id EasyPay déjà relié, sinon par le nom (un article pas encore relié).
 * À défaut, il est créé (stock 0, sans coût : à compléter dans Kanoo) — une
 * vente servie ne se perd pas faute d'article.
 */
export async function resolveItem(tenantId: string, deskId: string, ref: ItemRef, opts: { create: boolean; price?: number; userId: string; onCreate?: () => void }, session?: ClientSession): Promise<ItemDoc | null> {
  const base = { tenantId, deskId };
  const link = async (item: ItemDoc) => {
    if (!item.easypayId) {
      const taken = await ActivityItemModel.exists({ ...base, easypayId: ref.id }).session(session ?? null);
      if (!taken) { item.easypayId = ref.id; await item.save({ session }); }
    }
    return item;
  };
  if (ref.kanooId) {
    const byId = await ActivityItemModel.findOne({ ...base, _id: ref.kanooId }).session(session ?? null);
    if (byId) return link(byId);
  }
  const byExt = await ActivityItemModel.findOne({ ...base, easypayId: ref.id }).session(session ?? null);
  if (byExt) return byExt;
  const candidates = await ActivityItemModel.find({ ...base, archived: { $ne: true }, easypayId: { $exists: false } }).select("name").session(session ?? null).lean<Array<{ _id: Types.ObjectId; name: string }>>();
  const same = candidates.find(c => sameName(c.name, ref.name));
  if (same) {
    const item = await ActivityItemModel.findOne({ _id: same._id }).session(session ?? null);
    if (item) return link(item);
  }
  if (!opts.create) return null;
  const [created] = await ActivityItemModel.create([{
    ...base, name: ref.name.slice(0, 160), unit: "unité", quantity: 0, unitCost: 0,
    ...(opts.price !== undefined ? { salePrice: opts.price } : {}), ...(ref.category ? { category: ref.category } : {}),
    easypayId: ref.id, createdBy: opts.userId,
  }], { session });
  opts.onCreate?.();
  return created;
}

/** Applique un événement déjà lu. Lève une BusinessRuleError si une règle de Kanoo le refuse. */
export async function applyEvent(actor: TokenPayload, deskId: string, ev: ParsedEvent, session?: ClientSession): Promise<{ ref?: { kind: string; id: Types.ObjectId; number?: string }; warnings: string[] }> {
  const tenantId = actor.tenantId;
  const item = (ref: ItemRef, price?: number) => resolveItem(tenantId, deskId, ref, { create: true, price, userId: actor.userId }, session).then(i => i!);

  if (ev.type === "sale") {
    const lines = [];
    for (const l of ev.data.lines) {
      const it = await item(l.item, l.unitPrice);
      const components = [];
      for (const c of l.components) components.push({ itemId: String((await item(c.item))._id), quantity: c.quantity });
      lines.push({ itemId: String(it._id), quantity: l.quantity, unitPriceTTC: l.unitPrice, ...(components.length ? { components } : {}) });
    }
    const r = await createSale(actor, {
      deskId, date: ev.occurredAt.toISOString(), lines, payments: ev.data.payments, clientRef: ev.data.saleId,
      external: { source: "easypay" }, ...(ev.data.number ? { customerName: `EasyPay ${ev.data.number}` } : {}),
    }, session);
    return { ref: { kind: "sale", id: r.sale._id as Types.ObjectId, number: r.sale.number as string }, warnings: r.warnings };
  }

  if (ev.type === "sale_void") {
    const sale = await ComptoirSaleModel.findOne({ tenantId, deskId, clientRef: ev.data.saleId }).session(session ?? null)
      .lean<{ _id: Types.ObjectId; number: string; status: string } | null>();
    if (!sale) throw new BusinessRuleError("Vente EasyPay pas encore reçue : rejouez l'annulation quand elle sera arrivée.");
    if (sale.status !== "cancelled") await cancelSale(actor, String(sale._id), `Annulée dans EasyPay${ev.data.reason ? ` : ${ev.data.reason}` : ""}`, session);
    return { ref: { kind: "sale", id: sale._id, number: sale.number }, warnings: [] };
  }

  if (ev.type === "topup") {
    // Recharge de carte encaissée en espèces au comptoir : l'argent entre
    // dans le tiroir mais appartient à Numatech (pas une recette).
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).session(session ?? null)
      .lean<{ _id: Types.ObjectId; name: string; treasuryAccountId?: unknown } | null>();
    if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
    const date = await bookingDate(tenantId, desk._id, ev.occurredAt, session);
    await assertDayOpen(tenantId, desk._id, date, session);
    const label = "Recharge de carte EasyPay";
    const [cash] = await ActivityCashEntryModel.create([{
      tenantId, deskId: desk._id, direction: "in", amount: ev.data.amount, label, method: "cash", category: "easypay_topup", date, createdBy: actor.userId,
    }], { session });
    const ledger = desk.treasuryAccountId ? await treasuryLedger(tenantId, desk.treasuryAccountId, session) : null;
    if (ledger) {
      await registerLedgerAccount(tenantId, EASYPAY_ACCOUNT.accountCode, EASYPAY_ACCOUNT.accountLabel, session);
      const reference = `EPR-${ev.data.topupId.slice(-8).toUpperCase()}`;
      const [entry] = await AccountingEntryModel.create([{
        tenantId, journalCode: ledger.journalCode, entryDate: date, reference, label: `${desk.name} — ${label}`,
        lines: [
          { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: ev.data.amount, credit: 0 },
          { ...EASYPAY_ACCOUNT, debit: 0, credit: ev.data.amount },
        ],
        linkedDocType: "desk_cash", linkedDocId: cash._id, createdBy: actor.userId,
      }], { session });
      const [move] = await TreasuryMovementModel.create([{
        tenantId, accountId: desk.treasuryAccountId, date, amount: ev.data.amount, label: `${desk.name} — ${label}`, reference,
        source: "manual", linkedDocType: "desk_cash", linkedDocId: cash._id, createdBy: actor.userId,
      }], { session });
      cash.entryId = entry._id; cash.movementId = move._id;
      await cash.save({ session });
    }
    return { ref: { kind: "cash", id: cash._id }, warnings: [] };
  }

  if (ev.type === "stock_movement") {
    const it = await item(ev.data.item);
    const date = await bookingDate(tenantId, deskId, ev.occurredAt, session);
    const note = ev.data.reason ? `EasyPay : ${ev.data.reason}` : "EasyPay";
    if (ev.data.kind === "loss") {
      const r = await recordLoss(actor, { deskId, itemId: String(it._id), quantity: ev.data.quantity!, reason: lossReasonFor(ev.data.reason), note, date: date.toISOString(), lenient: true }, session);
      return { ref: { kind: "stock", id: r.move._id as Types.ObjectId }, warnings: [] };
    }
    if (ev.data.kind === "count") {
      await recordCounts(actor, deskId, [{ itemId: String(it._id), counted: ev.data.countedQuantity! }], session, { recount: true, reason: `Inventaire (${note})` });
      return { warnings: [] };
    }
    // Réception : entrée au coût courant de l'article (le prix d'achat se saisit dans Kanoo).
    await assertDayOpen(tenantId, deskId, date, session);
    const qty = ev.data.quantity!;
    let after = (it.quantity || 0) + qty, stockMovementId: unknown;
    if (it.productId) {
      const wh = await deskWarehouse(tenantId, deskId, session);
      const r = await applyMovement({ tenantId, userId: actor.userId, productId: it.productId, warehouseId: wh, type: "entry", quantity: qty, unitCost: it.unitCost || undefined, reason: `Réception (${note})`, linkedDocType: "comptoir", linkedDocId: deskId }, session);
      after = r.after; stockMovementId = r.movement._id;
    }
    const [move] = await ActivityStockMoveModel.create([{
      tenantId, deskId, itemId: it._id, type: "in", quantity: qty, quantityAfter: after, unitCost: it.unitCost || 0,
      reason: `Réception (${note})`, stockMovementId, date, createdBy: actor.userId,
    }], { session });
    it.quantity = Math.max(0, after);
    await it.save({ session });
    return { ref: { kind: "stock", id: move._id }, warnings: it.unitCost ? [] : [`${it.name} : réception sans coût d'achat, à compléter dans Kanoo.`] };
  }

  // Pré-commande : la plus récente de ses mises à jour l'emporte.
  const lines = [];
  for (const l of ev.data.lines) lines.push({ itemId: (await item(l.item))._id, quantity: l.quantity });
  const key = { tenantId, source: SOURCE, externalId: ev.data.orderId };
  const current = await DeskPreorderModel.findOne(key).select("statusAt").session(session ?? null).lean<{ statusAt: Date } | null>();
  // Un état plus ancien arrivé après le suivant (réseau) ne revient pas en arrière.
  if (current && current.statusAt > ev.occurredAt) return { warnings: ["état plus ancien que celui déjà connu : ignoré"] };
  await DeskPreorderModel.updateOne(key,
    { $set: { deskId, status: ev.data.status, pickupDay: ev.data.pickupDay, service: ev.data.service, amount: ev.data.amount, lines, statusAt: ev.occurredAt } },
    { upsert: true, session });
  return { warnings: [] };
}

export interface IngestResult { id?: string; status: "applied" | "failed" | "rejected" | "duplicate"; error?: string; ref?: string; warnings?: string[] }

/**
 * Reçoit un lot d'événements. Chacun est appliqué dans sa propre transaction
 * avec sa trace (une même id n'écrit qu'une fois, même envoyée deux fois en
 * même temps : l'index unique tranche). Un refus de Kanoo ne bloque pas le
 * reste du lot : il est gardé « failed », rejouable depuis le comptoir.
 */
export async function ingestEvents(ctx: ApiV1Context & { deskId: string }, raws: unknown[]): Promise<IngestResult[]> {
  const actor = await easypayActor(ctx);
  const results: IngestResult[] = [];
  for (const raw of raws) {
    const parsed = parseEvent(raw);
    const externalId = parsed.ok ? parsed.event.id : parsed.id;
    if (externalId) {
      const seen = await IntegrationEventModel.findOne({ tenantId: ctx.tenantId, source: SOURCE, externalId }).select("status error").lean<{ status: string; error?: string } | null>();
      if (seen) { results.push({ id: externalId, status: "duplicate", ...(seen.status !== "applied" ? { error: `déjà reçu (${seen.status})` } : {}) }); continue; }
    }
    if (!parsed.ok) {
      if (externalId) await saveTrace(ctx, raw, { status: "rejected", error: parsed.error }).catch(() => undefined);
      results.push({ ...(externalId ? { id: externalId } : {}), status: "rejected", error: parsed.error });
      continue;
    }
    results.push(await applyAndTrace(ctx, actor, parsed.event, raw));
  }
  return results;
}

async function saveTrace(ctx: { tenantId: string; deskId: string; keyId?: string }, raw: unknown, r: { status: string; error?: string; ref?: unknown; occurredAt?: Date; type?: string }, session?: ClientSession) {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  await IntegrationEventModel.create([{
    tenantId: ctx.tenantId, deskId: ctx.deskId, source: SOURCE, externalId: String(o.id).slice(0, 64), type: String(r.type ?? o.type ?? "?").slice(0, 30),
    ...(r.occurredAt ? { occurredAt: r.occurredAt } : {}), payload: o, status: r.status, ...(r.error ? { error: r.error.slice(0, 500) } : {}),
    ...(r.ref ? { ref: r.ref } : {}), ...(ctx.keyId ? { keyId: ctx.keyId } : {}), ...(r.status === "applied" ? { appliedAt: new Date() } : {}),
  }], { session });
}

const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

async function applyAndTrace(ctx: ApiV1Context & { deskId: string }, actor: TokenPayload, ev: ParsedEvent, raw: unknown): Promise<IngestResult> {
  try {
    const out = await withTransaction(async session => {
      const r = await applyEvent(actor, ctx.deskId, ev, session);
      await saveTrace(ctx, raw, { status: "applied", ref: r.ref, occurredAt: ev.occurredAt, type: ev.type }, session);
      return r;
    });
    return { id: ev.id, status: "applied", ...(out.ref?.number ? { ref: out.ref.number } : {}), ...(out.warnings.length ? { warnings: out.warnings } : {}) };
  } catch (e) {
    if (isDup(e) && await IntegrationEventModel.exists({ tenantId: ctx.tenantId, source: SOURCE, externalId: ev.id })) return { id: ev.id, status: "duplicate" };
    const error = e instanceof BusinessRuleError ? e.message : "Erreur interne de Kanoo : l'événement est gardé et pourra être rejoué.";
    if (!(e instanceof BusinessRuleError)) console.error("[easypay] application impossible", ev.type, ev.id, e);
    await saveTrace(ctx, raw, { status: "failed", error, occurredAt: ev.occurredAt, type: ev.type }).catch(() => undefined);
    return { id: ev.id, status: "failed", error };
  }
}

/** Rejoue un événement en échec (après correction dans Kanoo : journée rouverte, article relié…). */
export async function replayEvent(auth: TokenPayload, eventId: string) {
  const doc = await IntegrationEventModel.findOne({ _id: eventId, tenantId: auth.tenantId });
  if (!doc) throw new BusinessRuleError("Événement introuvable.");
  if (doc.status !== "failed") throw new BusinessRuleError("Seul un événement en échec se rejoue.");
  const parsed = parseEvent(doc.payload);
  if (!parsed.ok) throw new BusinessRuleError(`Événement illisible : ${parsed.error}`);
  try {
    const r = await withTransaction(async session => {
      const claim = await IntegrationEventModel.updateOne({ _id: doc._id, status: "failed" }, { $set: { status: "applied", appliedAt: new Date() }, $unset: { error: 1 }, $inc: { attempts: 1 } }, { session });
      if (claim.modifiedCount !== 1) throw new BusinessRuleError("Événement déjà rejoué.");
      const out = await applyEvent(auth, String(doc.deskId), parsed.event, session);
      if (out.ref) await IntegrationEventModel.updateOne({ _id: doc._id }, { $set: { ref: out.ref } }, { session });
      return out;
    });
    return { status: "applied" as const, warnings: r.warnings };
  } catch (e) {
    if (!(e instanceof BusinessRuleError)) throw e;
    await IntegrationEventModel.updateOne({ _id: doc._id, status: "failed" }, { $set: { error: e.message.slice(0, 500) }, $inc: { attempts: 1 } });
    return { status: "failed" as const, error: e.message };
  }
}

/** Catalogue du comptoir pour EasyPay : Kanoo fait foi pour les articles et les prix. */
export async function catalogueFor(tenantId: string, deskId: string) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name").lean<{ _id: Types.ObjectId; name: string } | null>();
  if (!desk) throw new BusinessRuleError("Comptoir introuvable.");
  const rows = await ActivityItemModel.find({ tenantId, deskId, $or: [{ archived: { $ne: true } }, { easypayId: { $type: "string" } }] })
    .select("name category unit salePrice quantity threshold archived easypayId recipe").sort({ category: 1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string; category?: string; unit: string; salePrice?: number; quantity: number; threshold?: number; archived?: boolean; easypayId?: string; recipe?: unknown[] }>>();
  const items = rows.map(r => ({
    id: String(r._id), easypay_id: r.easypayId ?? null, name: r.name, category: r.category ?? null, unit: r.unit,
    price: r.salePrice != null ? Math.round(r.salePrice) : null, archived: !!r.archived,
    stock: r.recipe?.length ? null : r.quantity, low_stock_threshold: r.threshold ?? null, prepared: !!r.recipe?.length,
  }));
  return {
    desk: { id: String(desk._id), name: desk.name },
    version: catalogueVersion(items.map(i => ({ id: i.id, name: i.name, price: i.price ?? undefined, category: i.category ?? undefined, archived: i.archived, easypayId: i.easypay_id ?? undefined }))),
    items,
  };
}

/**
 * Relie les articles d'EasyPay à ceux de Kanoo (première mise en service, ou
 * article créé à la caisse) : par id, puis par nom ; les absents sont créés
 * si demandé. Rend la correspondance que EasyPay garde.
 */
export async function linkCatalogue(ctx: { tenantId: string; deskId: string; userId: string }, rawItems: unknown[], createMissing: boolean) {
  const out: Array<{ easypay_id: string; kanoo_id: string | null; created: boolean; error?: string }> = [];
  for (const raw of rawItems.slice(0, 500)) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "", name = typeof o.name === "string" ? o.name.trim() : "";
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id) || !name) { out.push({ easypay_id: id, kanoo_id: null, created: false, error: "id ou nom invalide" }); continue; }
    const price = Number.isInteger(o.price) && (o.price as number) >= 0 ? (o.price as number) : undefined;
    const ref: ItemRef = { id, name: name.slice(0, 160), ...(typeof o.category === "string" && o.category.trim() ? { category: o.category.trim().slice(0, 60) } : {}), ...(typeof o.kanoo_id === "string" && /^[a-f0-9]{24}$/i.test(o.kanoo_id) ? { kanooId: o.kanoo_id } : {}) };
    let created = false;
    const it = await resolveItem(ctx.tenantId, ctx.deskId, ref, { create: createMissing, price, userId: ctx.userId, onCreate: () => { created = true; } });
    out.push({ easypay_id: id, kanoo_id: it ? String(it._id) : null, created });
  }
  return out;
}

/** Production d'un jour pour EasyPay : quantités à préparer (prévision et pré-commandes), articles reliés. */
export async function productionFor(tenantId: string, deskId: string, day: string) {
  const plan = await productionPlan(tenantId, deskId, day);
  const ids = new Map((await ActivityItemModel.find({ tenantId, deskId }).select("easypayId").lean<Array<{ _id: Types.ObjectId; easypayId?: string }>>()).map(i => [String(i._id), i.easypayId ?? null]));
  const rows = plan.configured
    ? plan.planned.map(p => ({ id: p.itemId, easypay_id: ids.get(p.itemId) ?? null, name: p.name, forecast: p.forecast, preordered: p.preordered, planned: p.planned }))
    : plan.preorders.map(p => ({ id: p.itemId, easypay_id: ids.get(p.itemId) ?? null, name: p.name, forecast: null, preordered: p.quantity, planned: p.quantity }));
  return {
    day, schedule_configured: plan.configured, items: rows,
    ...(plan.configured ? { services: plan.services.map(s => ({ key: s.key, label: s.label, from: s.from, to: s.to, presence: s.presence })) } : {}),
  };
}

/** Solde du compte courant EasyPay (467100) : positif, Numatech doit au comptoir ; négatif, le comptoir doit à Numatech. */
export async function easypayBalance(tenantId: string) {
  const [r] = await AccountingEntryModel.aggregate<{ d: number; c: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), "lines.accountCode": EASYPAY_ACCOUNT.accountCode } },
    { $unwind: "$lines" }, { $match: { "lines.accountCode": EASYPAY_ACCOUNT.accountCode } },
    { $group: { _id: null, d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]);
  return Math.round((r?.d ?? 0) - (r?.c ?? 0));
}

/**
 * Reversement entre Numatech et le comptoir, qui solde le compte courant :
 * « received », Numatech verse au comptoir (ventes payées par carte, moins
 * les recharges encaissées) ; « paid », le comptoir verse à Numatech.
 */
export async function recordRemittance(auth: TokenPayload, input: { treasuryAccountId: string; amount: number; direction: "received" | "paid"; date?: string; reference?: string }) {
  const amount = Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant invalide.");
  if (!["received", "paid"].includes(input.direction)) throw new BusinessRuleError("Sens du reversement invalide.");
  const date = input.date ? new Date(input.date) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  return withTransaction(async session => {
    const ledger = await treasuryLedger(auth.tenantId, input.treasuryAccountId, session);
    if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
    await registerLedgerAccount(auth.tenantId, EASYPAY_ACCOUNT.accountCode, EASYPAY_ACCOUNT.accountLabel, session);
    const received = input.direction === "received";
    const reference = (input.reference ? String(input.reference) : `REV-EP-${localDay(date)}`).slice(0, 60);
    const label = received ? "Reversement EasyPay reçu de Numatech" : "Reversement à Numatech (recharges EasyPay)";
    const [entry] = await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: ledger.journalCode, entryDate: date, reference, label,
      lines: received
        ? [{ accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 }, { ...EASYPAY_ACCOUNT, debit: 0, credit: amount }]
        : [{ ...EASYPAY_ACCOUNT, debit: amount, credit: 0 }, { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount }],
      linkedDocType: "easypay_remittance", createdBy: auth.userId,
    }], { session });
    await TreasuryMovementModel.create([{
      tenantId: auth.tenantId, accountId: input.treasuryAccountId, date, amount: received ? amount : -amount, label, reference,
      source: "manual", linkedDocType: "easypay_remittance", linkedDocId: entry._id, createdBy: auth.userId,
    }], { session });
    return entry;
  });
}
