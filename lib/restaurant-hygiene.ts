import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { HygieneLogModel } from "@/models/HygieneLog";
import { StockMovementModel } from "@/models/StockMovement";
import { StockLotModel } from "@/models/StockLot";
import { BusinessRuleError } from "@/lib/errors";
import { receiveInReserve } from "@/lib/restaurant-stock";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const DAY = 86_400_000;
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Repères usuels des plans HACCP, à adapter au plan de l'établissement et à
 * la réglementation applicable (non vérifiée pour le Niger) : froid positif
 * 0 à +4 °C, surgelés −18 °C au plus, maintien au chaud +63 °C au moins ;
 * plats témoins gardés 5 jours.
 */
export const UNIT_LIMITS = { fridge: { min: 0, max: 4 }, freezer: { max: -18 }, hot: { min: 63 } } as const;
export const CHAIN_LIMITS = { chilled: 4, frozen: -18 } as const;
export const SAMPLE_DAYS = 5;
export const FREQUENCIES = { service: "À chaque service", daily: "Chaque jour", weekly: "Chaque semaine", monthly: "Chaque mois" } as const;
type Freq = keyof typeof FREQUENCIES;
type UnitKind = keyof typeof UNIT_LIMITS;

interface Unit { _id: Id; name: string; kind: UnitKind; min?: number; max?: number }
interface Task { _id: Id; zone: string; task: string; frequency: Freq }
const limits = (u: Unit) => ({ min: u.min ?? (UNIT_LIMITS[u.kind] as { min?: number }).min, max: u.max ?? (UNIT_LIMITS[u.kind] as { max?: number }).max });
const inRange = (v: number, l: { min?: number; max?: number }) => (l.min === undefined || v >= l.min) && (l.max === undefined || v <= l.max);

/** Début de la période d'une tâche de nettoyage (jour, semaine du lundi, mois). */
function periodStart(freq: Freq, day: string) {
  const d = new Date(`${day}T12:00:00`);
  if (freq === "weekly") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (freq === "monthly") d.setDate(1);
  return dayOf(d);
}

/** Le registre d'hygiène du jour : relevés, contrôles à réception, plats témoins, nettoyage. */
export async function hygieneOverview(tenantId: string, deskId: string, day: string, now = new Date()) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name coldUnits cleaningTasks").lean<{ name: string; coldUnits?: Unit[]; cleaningTasks?: Task[] } | null>();
  if (!desk) throw new BusinessRuleError("Restaurant introuvable.");
  const since30 = dayOf(new Date(new Date(`${day}T12:00:00`).getTime() - 30 * DAY));
  const monthStart = `${day.slice(0, 8)}01`;
  const weekStart = periodStart("weekly", day);
  const [readings, issues, receptions, samples, cleaning] = await Promise.all([
    HygieneLogModel.find({ tenantId, deskId, kind: "temperature", day }).sort({ at: 1 }).lean<Array<{ _id: Id; unitId: Id; value: number; ok: boolean; action?: string; at: Date }>>(),
    HygieneLogModel.find({ tenantId, deskId, ok: false, day: { $gte: since30 }, kind: { $in: ["temperature", "reception"] } }).sort({ at: -1 }).limit(50)
      .lean<Array<{ _id: Id; kind: string; at: Date; unitName?: string; value?: number; action?: string; supplierName?: string; reference?: string; lines?: Array<{ name: string; refused: boolean; reason?: string }> }>>(),
    HygieneLogModel.find({ tenantId, deskId, kind: "reception", day: { $gte: since30 } }).sort({ at: -1 }).limit(50)
      .lean<Array<{ _id: Id; at: Date; supplierName?: string; reference?: string; chain?: string; value?: number; packagingOk?: boolean; datesOk?: boolean; ok: boolean; lines?: Array<{ name: string; quantity: number; refused: boolean; reason?: string }> }>>(),
    HygieneLogModel.find({ tenantId, deskId, kind: "sample", discardedAt: { $exists: false } }).sort({ keepUntil: 1 }).limit(100)
      .lean<Array<{ _id: Id; itemName?: string; day: string; service?: string; keepUntil: Date; at: Date }>>(),
    HygieneLogModel.find({ tenantId, deskId, kind: "cleaning", day: { $gte: weekStart < monthStart ? weekStart : monthStart } }).sort({ at: -1 })
      .lean<Array<{ taskId: Id; day: string; at: Date; note?: string }>>(),
  ]);
  return {
    day, name: desk.name,
    units: (desk.coldUnits ?? []).map(u => ({ _id: String(u._id), name: u.name, kind: u.kind, ...limits(u), readings: readings.filter(r => String(r.unitId) === String(u._id)).map(r => ({ _id: String(r._id), value: r.value, ok: r.ok, action: r.action, at: r.at })) })),
    tasks: (desk.cleaningTasks ?? []).map(t => {
      const from = periodStart(t.frequency === "service" ? "daily" : t.frequency, day);
      const done = cleaning.filter(c => String(c.taskId) === String(t._id) && c.day >= from && c.day <= day);
      return { _id: String(t._id), zone: t.zone, task: t.task, frequency: t.frequency, done: done.length, lastAt: done[0]?.at ?? null };
    }),
    samples: samples.map(s => ({ _id: String(s._id), itemName: s.itemName ?? "—", day: s.day, service: s.service, keepUntil: s.keepUntil, toDiscard: s.keepUntil <= now })),
    receptions: receptions.map(r => ({ ...r, _id: String(r._id) })),
    issues: issues.map(i => ({ ...i, _id: String(i._id) })),
  };
}

/** Enceintes et plan de nettoyage d'un restaurant (une enceinte gardée garde son identifiant). */
export async function saveHygieneSetup(auth: TokenPayload, deskId: string, s: { coldUnits?: unknown; cleaningTasks?: unknown }) {
  const $set: Record<string, unknown> = {};
  const id = (v: unknown) => (typeof v === "string" && /^[a-f0-9]{24}$/i.test(v) ? oid(v) : new Types.ObjectId());
  const num = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
  if (s.coldUnits !== undefined) {
    const list = (Array.isArray(s.coldUnits) ? s.coldUnits : []) as Array<{ _id?: unknown; name?: unknown; kind?: unknown; min?: unknown; max?: unknown }>;
    $set.coldUnits = list.filter(u => typeof u.name === "string" && u.name.trim() && typeof u.kind === "string" && u.kind in UNIT_LIMITS).slice(0, 30).map(u => {
      const min = num(u.min), max = num(u.max);
      if (min !== undefined && max !== undefined && min > max) throw new BusinessRuleError(`${String(u.name)} : limite basse au-dessus de la limite haute.`);
      return { _id: id(u._id), name: String(u.name).trim().slice(0, 80), kind: u.kind, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    });
  }
  if (s.cleaningTasks !== undefined) {
    const list = (Array.isArray(s.cleaningTasks) ? s.cleaningTasks : []) as Array<{ _id?: unknown; zone?: unknown; task?: unknown; frequency?: unknown }>;
    $set.cleaningTasks = list.filter(t => typeof t.zone === "string" && t.zone.trim() && typeof t.task === "string" && t.task.trim() && typeof t.frequency === "string" && t.frequency in FREQUENCIES).slice(0, 100)
      .map(t => ({ _id: id(t._id), zone: String(t.zone).trim().slice(0, 80), task: String(t.task).trim().slice(0, 120), frequency: t.frequency }));
  }
  await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, { $set });
}

/** Relevé de température d'une enceinte : conforme ou non à ses limites. */
export async function recordTemperature(auth: TokenPayload, deskId: string, unitId: string, value: number, action?: string, at = new Date()) {
  if (!Number.isFinite(value) || value < -60 || value > 150) throw new BusinessRuleError("Température invalide.");
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("coldUnits").lean<{ coldUnits?: Unit[] } | null>();
  const unit = desk?.coldUnits?.find(u => String(u._id) === unitId);
  if (!unit) throw new BusinessRuleError("Enceinte introuvable.");
  const l = limits(unit), ok = inRange(value, l);
  await HygieneLogModel.create({ tenantId: auth.tenantId, deskId, kind: "temperature", at, day: dayOf(at), unitId: unit._id, unitName: unit.name, value, ...l, ok, ...(action ? { action: action.slice(0, 300) } : {}), by: auth.userId });
  return { ok, unit: unit.name, ...l };
}

/**
 * Contrôle à réception : chaîne du froid (température à cœur ou en surface),
 * emballages, dates. Non conforme si la température dépasse le repère, si les
 * emballages ou les dates ne vont pas, ou si une ligne est refusée.
 */
export interface ReceptionControl { reference?: string; supplierName?: string; chain?: string; temperature?: number | null; packagingOk?: boolean; datesOk?: boolean; note?: string }
export type ControlLine = { itemId: string; quantity: number; refused?: boolean; reason?: string };

/** Contrôle à réception complet, vérifié avant toute entrée en stock. */
export function checkReceptionControl(c: ReceptionControl, lines: ControlLine[]) {
  const chain = c.chain === "chilled" || c.chain === "frozen" ? c.chain : "ambient";
  if (chain !== "ambient" && (c.temperature === undefined || c.temperature === null || !Number.isFinite(c.temperature))) throw new BusinessRuleError("Produit frais ou surgelé : relevez sa température à la réception.");
  if (lines.some(l => l.refused && !String(l.reason ?? "").trim())) throw new BusinessRuleError("Indiquez le motif de chaque refus.");
  return chain;
}

export async function recordReception(auth: TokenPayload, deskId: string, c: ReceptionControl, lines: ControlLine[], at = new Date()) {
  const chain = checkReceptionControl(c, lines);
  const items = await ActivityItemModel.find({ tenantId: auth.tenantId, deskId, _id: { $in: lines.map(l => l.itemId) } }).select("name").lean<Array<{ _id: Id; name: string }>>();
  const name = (id: string) => items.find(i => String(i._id) === id)?.name ?? "—";
  const tempOk = chain === "ambient" || (c.temperature as number) <= CHAIN_LIMITS[chain];
  const ok = tempOk && c.packagingOk !== false && c.datesOk !== false && !lines.some(l => l.refused);
  const doc = await HygieneLogModel.create({
    tenantId: auth.tenantId, deskId, kind: "reception", at, day: dayOf(at), chain, ...(chain !== "ambient" ? { value: c.temperature, max: CHAIN_LIMITS[chain] } : {}),
    packagingOk: c.packagingOk !== false, datesOk: c.datesOk !== false, ok,
    ...(c.reference ? { reference: c.reference.slice(0, 60) } : {}), ...(c.supplierName ? { supplierName: c.supplierName.slice(0, 120) } : {}), ...(c.note ? { note: c.note.slice(0, 300) } : {}),
    lines: lines.map(l => ({ itemId: l.itemId, name: name(l.itemId), quantity: l.quantity, refused: !!l.refused, ...(l.refused ? { reason: String(l.reason).slice(0, 200) } : {}) })), by: auth.userId,
  });
  return { ok, tempOk, id: String(doc._id) };
}

/**
 * Réception en réserve avec son contrôle : le contrôle est vérifié avant
 * toute entrée ; les lignes refusées n'entrent pas en stock ; le contrôle est
 * noté au registre (y compris quand tout est refusé).
 */
export async function receiveControlled(auth: TokenPayload, deskId: string, lines: Array<Record<string, unknown> & { itemId: string }>, meta: Parameters<typeof receiveInReserve>[3], control: ReceptionControl | null) {
  const controlLines: ControlLine[] = lines.map(l => ({ itemId: String(l.itemId), quantity: Number(l.quantity ?? l.packs ?? 0), refused: l.refused === true, reason: typeof l.reason === "string" ? l.reason : undefined }));
  const ctl = control ?? (controlLines.some(l => l.refused) ? { chain: "ambient" } : null);
  if (ctl) checkReceptionControl(ctl, controlLines);
  const accepted = lines.filter(l => l.refused !== true).map(({ refused: _r, reason: _x, ...l }) => l as typeof lines[number]);
  if (!accepted.length && !ctl) throw new BusinessRuleError("Aucune ligne à recevoir.");
  const received = accepted.length ? await receiveInReserve(auth, deskId, accepted as never, meta) : null;
  const h = ctl ? await recordReception(auth, deskId, { ...ctl, reference: ctl.reference ?? meta.reference, supplierName: ctl.supplierName ?? meta.supplier }, controlLines) : null;
  return { received, accepted, control: h };
}

/** Plat témoin prélevé : à garder jusqu'au jour + 5 (repère usuel), puis à jeter. */
export async function recordSample(auth: TokenPayload, deskId: string, itemId: string, service: string, day: string, at = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BusinessRuleError("Jour invalide.");
  const item = await ActivityItemModel.findOne({ _id: itemId, tenantId: auth.tenantId, deskId }).select("name").lean<{ name: string } | null>();
  if (!item) throw new BusinessRuleError("Plat introuvable.");
  const keepUntil = new Date(`${day}T23:59:59`); keepUntil.setDate(keepUntil.getDate() + SAMPLE_DAYS);
  await HygieneLogModel.create({ tenantId: auth.tenantId, deskId, kind: "sample", at, day, itemId, itemName: item.name, service: String(service).slice(0, 20), keepUntil, by: auth.userId });
}

export async function discardSample(auth: TokenPayload, deskId: string, id: string, now = new Date()) {
  const r = await HygieneLogModel.updateOne({ _id: id, tenantId: auth.tenantId, deskId, kind: "sample", discardedAt: { $exists: false } }, { $set: { discardedAt: now, discardedBy: auth.userId } });
  if (r.modifiedCount !== 1) throw new BusinessRuleError("Plat témoin introuvable ou déjà jeté.");
}

export async function recordCleaning(auth: TokenPayload, deskId: string, taskId: string, note?: string, at = new Date()) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("cleaningTasks").lean<{ cleaningTasks?: Task[] } | null>();
  const t = desk?.cleaningTasks?.find(x => String(x._id) === taskId);
  if (!t) throw new BusinessRuleError("Tâche introuvable.");
  await HygieneLogModel.create({ tenantId: auth.tenantId, deskId, kind: "cleaning", at, day: dayOf(at), taskId: t._id, task: t.task, zone: t.zone, ...(note ? { note: note.slice(0, 300) } : {}), by: auth.userId });
}

/** Lots connus d'un ingrédient (en stock ou déjà sortis), du plus récent au plus ancien. */
export async function itemLots(tenantId: string, deskId: string, itemId: string) {
  const item = await ActivityItemModel.findOne({ _id: itemId, tenantId, deskId }).select("productId").lean<{ productId?: Id } | null>();
  if (!item?.productId) return [];
  const [stock, seen] = await Promise.all([
    StockLotModel.find({ tenantId, productId: item.productId, qty: { $gt: 0 } }).select("lotNumber expiryDate qty").lean<Array<{ lotNumber: string; expiryDate?: Date; qty: number }>>(),
    StockMovementModel.aggregate<{ _id: string; first: Date; expiry?: Date }>([
      { $match: { tenantId: oid(tenantId), productId: item.productId, "lots.0": { $exists: true } } }, { $unwind: "$lots" },
      { $group: { _id: "$lots.lotNumber", first: { $min: "$createdAt" }, expiry: { $max: "$lots.expiryDate" } } }, { $sort: { first: -1 } }, { $limit: 100 },
    ]),
  ]);
  return seen.map(s => ({ lotNumber: s._id, firstSeen: s.first, expiryDate: s.expiry ?? stock.find(x => x.lotNumber === s._id)?.expiryDate ?? null, inStock: stock.filter(x => x.lotNumber === s._id).reduce((t, x) => t + x.qty, 0) }));
}

/**
 * Traçabilité d'un lot d'ingrédient : réception (date, référence), passages
 * réserve → comptoir, puis tickets dont les sorties ont puisé dans ce lot,
 * regroupés par plat ou article vendu. Sert au rappel d'un lot.
 */
export async function traceLot(tenantId: string, deskId: string, itemId: string, lotNumber: string) {
  const item = await ActivityItemModel.findOne({ _id: itemId, tenantId, deskId }).select("name unit productId").lean<{ name: string; unit: string; productId?: Id } | null>();
  if (!item?.productId) throw new BusinessRuleError("Ingrédient sans suivi de stock (non relié au catalogue).");
  const moves = await StockMovementModel.find({ tenantId, productId: item.productId, "lots.lotNumber": lotNumber }).sort({ createdAt: 1 })
    .select("type quantity reason linkedDocType linkedDocNumber createdAt lots").lean<Array<{ _id: Id; type: string; quantity: number; reason: string; linkedDocType?: string; linkedDocNumber?: string; createdAt: Date; lots: Array<{ lotNumber: string; qty: number; expiryDate?: Date }> }>>();
  const qtyOf = (m: typeof moves[number]) => m.lots.filter(l => l.lotNumber === lotNumber).reduce((t, l) => t + l.qty, 0);
  const exitIds = moves.filter(m => m.type === "exit").map(m => m._id);
  const sales = exitIds.length ? await ComptoirSaleModel.find({ tenantId, deskId, $or: [{ "lines.stockMovementId": { $in: exitIds } }, { "lines.ingredients.stockMovementId": { $in: exitIds } }] })
    .select("number date status lines.label lines.quantity lines.stockMovementId lines.ingredients.stockMovementId").sort({ date: 1 })
    .lean<Array<{ number: string; date: Date; status: string; lines: Array<{ label: string; quantity: number; stockMovementId?: Id; ingredients?: Array<{ stockMovementId?: Id }> }> }>>() : [];
  const ids = new Set(exitIds.map(String));
  const dishes = new Map<string, { label: string; quantity: number; tickets: number; first: Date; last: Date }>();
  for (const s of sales) for (const l of s.lines) {
    if (!(l.stockMovementId && ids.has(String(l.stockMovementId))) && !l.ingredients?.some(i => i.stockMovementId && ids.has(String(i.stockMovementId)))) continue;
    const d = dishes.get(l.label) ?? { label: l.label, quantity: 0, tickets: 0, first: s.date, last: s.date };
    d.quantity += l.quantity; d.tickets++; d.last = s.date;
    dishes.set(l.label, d);
  }
  const expiry = moves.flatMap(m => m.lots.filter(l => l.lotNumber === lotNumber && l.expiryDate).map(l => l.expiryDate!))[0] ?? null;
  return {
    item: item.name, unit: item.unit, lotNumber, expiryDate: expiry,
    movements: moves.map(m => ({ date: m.createdAt, type: m.type, quantity: Math.round(qtyOf(m) * 1000) / 1000, reason: m.reason, document: m.linkedDocNumber ?? null })),
    tickets: sales.map(s => ({ number: s.number, date: s.date, cancelled: s.status === "cancelled" })),
    dishes: [...dishes.values()].sort((a, b) => b.quantity - a.quantity),
  };
}
