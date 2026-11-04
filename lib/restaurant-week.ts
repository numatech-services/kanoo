import { ActivityDeskModel } from "@/models/ActivityDesk";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { DeskTransferModel } from "@/models/DeskTransfer";
import { DeskWeekCloseModel, type IDeskWeekClose } from "@/models/DeskWeekClose";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { BusinessRuleError } from "@/lib/errors";
import { restaurantStock } from "@/lib/restaurant-stock";
import { localDay } from "@/lib/format";
import type { TokenPayload } from "@/lib/auth";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Où en est la semaine d'un site : ce qui bloque sa clôture (transferts à
 * recevoir, inventaire ouvert, pas d'inventaire depuis la dernière clôture) et
 * ce qui mérite un regard (réceptions sans prix).
 */
export async function weekStatus(tenantId: string, deskId: string, day = localDay(new Date())) {
  const last = await DeskWeekCloseModel.findOne({ tenantId, deskId, status: "closed" }).sort({ weekEnd: -1 }).select("weekEnd closedAt summary").lean<Pick<IDeskWeekClose, "weekEnd" | "closedAt" | "summary"> | null>();
  const since = last ? new Date(last.closedAt) : new Date(0);
  const [toReceive, gaps, open, counted, unvalued] = await Promise.all([
    DeskTransferModel.countDocuments({ tenantId, toDeskId: deskId, status: { $in: ["sent", "transit"] } }),
    DeskTransferModel.countDocuments({ tenantId, status: "gap", $or: [{ fromDeskId: deskId }, { toDeskId: deskId }] }),
    DeskInventoryModel.countDocuments({ tenantId, deskId, status: "open" }),
    DeskInventoryModel.countDocuments({ tenantId, deskId, status: "validated", opening: { $ne: true }, validatedAt: { $gt: since } }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId, unitCost: 0, date: { $gt: since } }),
  ]);
  const blockers = [
    ...(toReceive ? [`${toReceive} transfert(s) à recevoir`] : []),
    ...(gaps ? [`${gaps} écart(s) de transfert à trancher`] : []),
    ...(open ? ["un inventaire est ouvert : validez-le ou annulez-le"] : []),
    ...(!counted ? ["aucun inventaire validé depuis la dernière clôture"] : []),
  ];
  return { last: last ? { weekEnd: last.weekEnd, closedAt: last.closedAt, summary: last.summary } : null, day, blockers, warnings: unvalued ? [`${unvalued} réception(s) sans prix : la valeur du stock est sous-estimée`] : [], canClose: !blockers.length && (!last || last.weekEnd < day) };
}

/** Clôture de la semaine jusqu'au jour donné, une fois l'inventaire validé. Le stock restant reste tel quel. */
export async function closeWeek(auth: TokenPayload, deskId: string, day = localDay(new Date()), note?: string) {
  if (!isDay(day) || day > localDay(new Date())) throw new BusinessRuleError("Date de clôture invalide.");
  const s = await weekStatus(auth.tenantId, deskId, day);
  if (s.blockers.length) throw new BusinessRuleError(`Clôture impossible : ${s.blockers.join(" ; ")}.`);
  if (s.last && s.last.weekEnd >= day) throw new BusinessRuleError(`Période déjà close jusqu'au ${s.last.weekEnd}.`);
  const since = s.last ? new Date(s.last.closedAt) : new Date(0);
  const invs = await DeskInventoryModel.find({ tenantId: auth.tenantId, deskId, status: "validated", opening: { $ne: true }, validatedAt: { $gt: since } }).select("gapValue").lean<Array<{ gapValue?: number }>>();
  const stock = await restaurantStock(auth.tenantId, deskId, true);
  const summary = { stockValue: (stock.totals.desk ?? 0) + (stock.totals.reserve ?? 0), gapValue: invs.reduce((t, i) => t + (i.gapValue ?? 0), 0), inventories: invs.length };
  const now = new Date();
  await DeskWeekCloseModel.findOneAndUpdate({ tenantId: auth.tenantId, deskId, weekEnd: day },
    { $set: { status: "closed", summary, closedBy: auth.userId, closedAt: now, ...(note ? { note: note.slice(0, 400) } : {}) } }, { upsert: true });
  return { weekEnd: day, summary };
}

/** Réouverture motivée (chef, direction, comptabilité) : l'historique garde qui a clos et qui a rouvert. */
export async function reopenWeek(auth: TokenPayload, deskId: string, weekEnd: string, reason: string) {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 5) throw new BusinessRuleError("Motif de réouverture obligatoire.");
  const c = await DeskWeekCloseModel.findOne({ tenantId: auth.tenantId, deskId, weekEnd, status: "closed" }).lean<IDeskWeekClose | null>();
  if (!c) throw new BusinessRuleError("Cette semaine n'est pas close.");
  if (await DeskWeekCloseModel.exists({ tenantId: auth.tenantId, deskId, status: "closed", weekEnd: { $gt: weekEnd } })) throw new BusinessRuleError("Une semaine suivante est close : rouvrez d'abord la plus récente.");
  await DeskWeekCloseModel.updateOne({ _id: c._id }, { $set: { status: "reopened" }, $push: { history: { closedBy: c.closedBy, closedAt: c.closedAt, reopenedBy: auth.userId, reopenedAt: new Date(), reason: why } } });
}

/** Seuil de validation renforcée d'un site. */
export async function setGapThreshold(auth: TokenPayload, deskId: string, value: number | null) {
  if (value !== null && !(value >= 0)) throw new BusinessRuleError("Seuil invalide.");
  await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, value === null ? { $unset: { gapApprovalThreshold: 1 } } : { $set: { gapApprovalThreshold: Math.round(value) } });
}
