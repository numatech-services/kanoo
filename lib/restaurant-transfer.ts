import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { DeskTransferModel } from "@/models/DeskTransfer";
import { WarehouseModel } from "@/models/Warehouse";
import { BusinessRuleError } from "@/lib/errors";
import { applyMovement, transferStock } from "@/lib/stock";
import { syncLinkedItems } from "@/lib/comptoir-stock";
import { assertMonthOpen } from "@/lib/comptoir-sale";
import { deskReserve, ensureLinked } from "@/lib/restaurant-stock";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function checkSignature(name: unknown, signature: unknown) {
  if (typeof name !== "string" || name.trim().length < 2) throw new BusinessRuleError("Nom du signataire obligatoire.");
  if (typeof signature !== "string" || !SIG_RE.test(signature) || signature.length < 200) throw new BusinessRuleError("Signature manquante : signez dans le cadre.");
  if (signature.length > 200_000) throw new BusinessRuleError("Signature trop lourde : effacez et signez à nouveau.");
}

/**
 * Article du restaurant destinataire pour un produit : celui déjà relié au
 * même produit, sinon l'article de même nom encore vide (relié au passage),
 * sinon une copie de la fiche (nom, unité, famille, conditionnement, seuils).
 */
async function targetItem(auth: TokenPayload, toDeskId: Id, src: { name: string; unit: string; category?: string; pack?: unknown; threshold?: number; reserveThreshold?: number; salePrice?: number; unitCost?: number }, productId: Id, session?: ClientSession) {
  const linked = await ActivityItemModel.findOne({ tenantId: auth.tenantId, deskId: toDeskId, productId, archived: { $ne: true } }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
  if (linked) return linked._id;
  const same = await ActivityItemModel.findOne({ tenantId: auth.tenantId, deskId: toDeskId, name: new RegExp(`^${esc(src.name)}$`, "i"), productId: { $exists: false }, archived: { $ne: true } }).select("_id quantity recipe").session(session ?? null).lean<{ _id: Id; quantity?: number; recipe?: unknown[] } | null>();
  if (same && !same.recipe?.length) {
    if ((same.quantity ?? 0) > 0) throw new BusinessRuleError(`« ${src.name} » existe déjà au restaurant destinataire avec du stock hors réserve : reliez-le d'abord au catalogue (une réception ou un approvisionnement suffit).`);
    await ActivityItemModel.updateOne({ _id: same._id, tenantId: auth.tenantId }, { $set: { productId } }, { session });
    return same._id;
  }
  const [it] = await ActivityItemModel.create([{
    tenantId: auth.tenantId, deskId: toDeskId, name: src.name, unit: src.unit, quantity: 0, unitCost: src.unitCost ?? 0, productId,
    ...(src.category ? { category: src.category } : {}), ...(src.pack ? { pack: src.pack } : {}),
    ...(src.threshold != null ? { threshold: src.threshold } : {}), ...(src.reserveThreshold != null ? { reserveThreshold: src.reserveThreshold } : {}),
    ...(src.salePrice != null ? { salePrice: src.salePrice } : {}), createdBy: auth.userId,
  }], { session });
  return it._id as Id;
}

/**
 * Emplacement « en transit » de l'organisation : ce qui a quitté un site et
 * n'est pas encore reçu n'est disponible nulle part, et n'est compté qu'une
 * fois dans le total de l'entreprise.
 */
export async function transitWarehouse(tenantId: string, session?: ClientSession): Promise<Id> {
  const hit = await WarehouseModel.findOne({ tenantId, code: "TRANSIT" }).select("_id").session(session ?? null).lean<{ _id: Id } | null>();
  if (hit) return hit._id;
  const [w] = await WarehouseModel.create([{ tenantId, code: "TRANSIT", name: "Marchandises en transit", kind: "other" }], { session });
  return w._id as Id;
}

/** Lots d'une ligne pour une quantité donnée, dans l'ordre d'envoi. */
function takeLots(lots: Array<{ lotNumber: string; qty: number; expiryDate?: Date }>, quantity: number) {
  const out: Array<{ lotNumber: string; qty: number; expiryDate?: Date }> = [];
  let left = quantity;
  for (const l of lots) {
    if (left <= 0) break;
    const q = Math.min(l.qty, left);
    out.push({ ...l, qty: q }); left = Math.round((left - q) * 1000) / 1000;
  }
  return out;
}

/**
 * Envoie de la marchandise de la réserve d'un restaurant vers un autre : elle
 * passe en transit, lots et coût conservés (les plus proches de la péremption
 * d'abord, un lot périmé ne part pas), bon numéroté signé par l'expéditeur.
 * Elle n'entre dans la réserve du destinataire qu'à sa réception.
 */
export async function sendTransfer(auth: TokenPayload, fromDeskId: string, toDeskId: string, lines: Array<{ itemId: string; quantity?: number; packs?: number }>, signer: { name: unknown; signature: unknown }, note?: string) {
  if (fromDeskId === toDeskId) throw new BusinessRuleError("Choisissez un autre restaurant destinataire.");
  if (!lines.length) throw new BusinessRuleError("Aucun article.");
  checkSignature(signer.name, signer.signature);
  const [from, to] = await Promise.all([
    ActivityDeskModel.findOne({ _id: fromDeskId, tenantId: auth.tenantId, archived: { $ne: true } }).select("name").lean<{ _id: Id; name: string } | null>(),
    ActivityDeskModel.findOne({ _id: toDeskId, tenantId: auth.tenantId, archived: { $ne: true } }).select("name").lean<{ _id: Id; name: string } | null>(),
  ]);
  if (!from || !to) throw new BusinessRuleError("Restaurant introuvable.");
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const number = `TR-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(from._id).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const doc = await withTransaction(async session => {
    await assertMonthOpen(auth.tenantId, fromDeskId, d, session);
    await assertMonthOpen(auth.tenantId, toDeskId, d, session);
    const [fromRes, transit] = await Promise.all([deskReserve(auth.tenantId, fromDeskId, session), transitWarehouse(auth.tenantId, session)]);
    await deskReserve(auth.tenantId, toDeskId, session);
    const out: Array<{ fromItemId: Id; toItemId: Id; productId: Id; name: string; unit: string; quantity: number; unitCost: number; lots: Array<{ lotNumber: string; qty: number; expiryDate?: Date }> }> = [];
    for (const l of lines) {
      const it = await ActivityItemModel.findOne({ _id: l.itemId, tenantId: auth.tenantId, deskId: fromDeskId }).session(session ?? null)
        .lean<{ _id: Id; name: string; unit: string; category?: string; pack?: { size?: number }; threshold?: number; reserveThreshold?: number; salePrice?: number; unitCost?: number; recipe?: unknown[] } | null>();
      if (!it) throw new BusinessRuleError("Article introuvable.");
      if (it.recipe?.length) throw new BusinessRuleError(`${it.name} : une préparation ne se transfère pas ; transférez ses ingrédients.`);
      const qty = Number(l.packs) > 0 ? Number(l.packs) * (it.pack?.size ?? NaN) : Number(l.quantity);
      if (!(qty > 0)) throw new BusinessRuleError(`${it.name} : quantité invalide.`);
      const productId = await ensureLinked(auth, fromDeskId, it._id, session);
      const toItemId = await targetItem(auth, to._id, it, productId, session);
      const r = await transferStock({ tenantId: auth.tenantId, userId: auth.userId, productId, fromWarehouseId: fromRes, toWarehouseId: transit, quantity: qty,
        reason: `Transfert ${from.name} → ${to.name} (${number})`, linkedDocType: "transfer", linkedDocNumber: number }, session);
      const mv = r.out.movement as { unitCost?: number };
      out.push({ fromItemId: it._id, toItemId, productId, name: it.name, unit: it.unit, quantity: qty, unitCost: Number(mv.unitCost) || 0,
        lots: ((r.out.lots ?? []) as Array<{ lotNumber: string; qty: number; expiryDate?: Date }>).map(x => ({ lotNumber: x.lotNumber, qty: Math.abs(x.qty), ...(x.expiryDate ? { expiryDate: x.expiryDate } : {}) })) });
    }
    const [t] = await DeskTransferModel.create([{
      tenantId: auth.tenantId, number, fromDeskId: from._id, fromName: from.name, toDeskId: to._id, toName: to.name, lines: out,
      value: Math.round(out.reduce((s, x) => s + x.quantity * x.unitCost, 0)), status: "transit",
      sentBy: auth.userId, senderName: String(signer.name).trim().slice(0, 120), senderSignature: signer.signature, sentAt: d, ...(note ? { note: note.slice(0, 300) } : {}),
    }], { session });
    return t;
  });
  await syncLinkedItems(auth.tenantId, fromDeskId);
  return { _id: String(doc._id), number };
}

interface TransferLine { fromItemId: Id; toItemId: Id; productId: Id; name: string; unit: string; quantity: number; receivedQty?: number; unitCost: number; lots: Array<{ lotNumber: string; qty: number; expiryDate?: Date }> }

/**
 * Le destinataire signe la réception, avec les quantités réellement reçues
 * (toutes, par défaut). Elles entrent dans sa réserve ; ce qui manque reste en
 * transit et ouvre une anomalie, tranchée ensuite par `resolveTransferGap`.
 */
export async function receiveTransfer(auth: TokenPayload, id: string, toDeskScope: (deskId: string) => Promise<boolean>, signer: { name: unknown; signature: unknown }, gapNote?: string, received?: Array<{ fromItemId: string; quantity: number }>) {
  checkSignature(signer.name, signer.signature);
  const pre = await DeskTransferModel.findOne({ _id: id, tenantId: auth.tenantId }).select("toDeskId status").lean<{ toDeskId: Id; status: string } | null>();
  if (!pre) throw new BusinessRuleError("Bon de transfert introuvable.");
  if (!(await toDeskScope(String(pre.toDeskId)))) throw new BusinessRuleError("Seul le restaurant destinataire signe la réception.");
  const stamp = { receivedBy: auth.userId, receiverName: String(signer.name).trim().slice(0, 120), receiverSignature: signer.signature, receivedAt: new Date(), ...(gapNote ? { gapNote: gapNote.slice(0, 400) } : {}) };
  // Ancien bon : le stock est déjà chez le destinataire, seule la signature manque.
  if (pre.status === "sent") {
    const r = await DeskTransferModel.updateOne({ _id: id, tenantId: auth.tenantId, status: "sent" }, { $set: { status: "received", ...stamp } });
    if (r.modifiedCount !== 1) throw new BusinessRuleError("Réception déjà signée.");
    return;
  }
  await withTransaction(async session => {
    const t = await DeskTransferModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, status: "transit" }, { $set: { status: "received", ...stamp } }, { session, new: true })
      .lean<{ number: string; fromName: string; toName: string; toDeskId: Id; lines: TransferLine[] } | null>();
    if (!t) throw new BusinessRuleError("Réception déjà signée.");
    await assertMonthOpen(auth.tenantId, t.toDeskId, new Date(), session);
    const [transit, toRes] = await Promise.all([transitWarehouse(auth.tenantId, session), deskReserve(auth.tenantId, t.toDeskId, session)]);
    let gap = false;
    for (const l of t.lines) {
      const said = received?.find(x => String(x.fromItemId) === String(l.fromItemId));
      const q = said === undefined ? l.quantity : Number(said.quantity);
      if (!(q >= 0) || q > l.quantity) throw new BusinessRuleError(`${l.name} : quantité reçue invalide (envoyé : ${l.quantity}). Un surplus se traite par l'inventaire.`);
      l.receivedQty = q;
      if (q < l.quantity) gap = true;
      if (q > 0) await transferStock({ tenantId: auth.tenantId, userId: auth.userId, productId: l.productId, fromWarehouseId: transit, toWarehouseId: toRes, quantity: q, ...(l.lots?.length ? { lots: takeLots(l.lots, q) } : {}),
        reason: `Réception du transfert ${t.number} — ${t.fromName} → ${t.toName}`, linkedDocType: "transfer", linkedDocNumber: t.number }, session);
    }
    if (gap && !gapNote?.trim()) throw new BusinessRuleError("Il manque de la marchandise : dites ce qui s'est passé.");
    await DeskTransferModel.updateOne({ _id: id, tenantId: auth.tenantId }, { $set: { lines: t.lines, ...(gap ? { status: "gap" } : {}) } }, { session });
  });
  await syncLinkedItems(auth.tenantId, String(pre.toDeskId));
}

/**
 * Écart d'un transfert, tranché par le chef ou la finance : la marchandise
 * retrouvée revient à l'expéditeur, ou elle est perdue (perte de l'expéditeur,
 * au coût de l'envoi, visible à son résultat). Le transit est alors vide.
 */
export async function resolveTransferGap(auth: TokenPayload, id: string, decision: "return" | "loss", note?: string) {
  if (decision !== "return" && decision !== "loss") throw new BusinessRuleError("Décision invalide.");
  const value = await withTransaction(async session => {
    const t = await DeskTransferModel.findOneAndUpdate({ _id: id, tenantId: auth.tenantId, status: "gap" }, { $set: { status: "received" } }, { session, new: true })
      .lean<{ _id: Id; number: string; fromDeskId: Id; lines: TransferLine[] } | null>();
    if (!t) throw new BusinessRuleError("Aucun écart à trancher sur ce bon.");
    await assertMonthOpen(auth.tenantId, t.fromDeskId, new Date(), session);
    const [transit, fromRes] = await Promise.all([transitWarehouse(auth.tenantId, session), deskReserve(auth.tenantId, t.fromDeskId, session)]);
    let total = 0;
    for (const l of t.lines) {
      const miss = Math.round((l.quantity - (l.receivedQty ?? l.quantity)) * 1000) / 1000;
      if (!(miss > 0)) continue;
      const lots = l.lots?.length ? takeLots([...l.lots].reverse(), miss) : undefined;
      total += Math.round(miss * l.unitCost);
      if (decision === "return") {
        await transferStock({ tenantId: auth.tenantId, userId: auth.userId, productId: l.productId, fromWarehouseId: transit, toWarehouseId: fromRes, quantity: miss, ...(lots ? { lots } : {}), reason: `Retour de l'écart du transfert ${t.number}`, linkedDocType: "transfer", linkedDocNumber: t.number }, session);
      } else {
        const reason = `Écart du transfert ${t.number}${note ? ` — ${note.slice(0, 120)}` : ""}`;
        const r = await applyMovement({ tenantId: auth.tenantId, userId: auth.userId, productId: l.productId, warehouseId: transit, type: "loss", quantity: miss, ...(lots ? { lots } : {}), reason, linkedDocType: "transfer", linkedDocNumber: t.number }, session);
        await ActivityStockMoveModel.create([{ tenantId: auth.tenantId, deskId: t.fromDeskId, itemId: l.fromItemId, type: "out", quantity: miss, quantityAfter: 0, unitCost: l.unitCost, reason, stockMovementId: r.movement._id, lossReason: "unknown", lossValue: Math.round(miss * l.unitCost), date: new Date(), createdBy: auth.userId }], { session });
      }
    }
    await DeskTransferModel.updateOne({ _id: t._id }, { $set: { gapResolution: { decision, ...(note ? { note: note.slice(0, 300) } : {}), by: auth.userId, at: new Date(), value: total } } }, { session });
    return { total, fromDeskId: String(t.fromDeskId) };
  });
  await syncLinkedItems(auth.tenantId, value.fromDeskId);
  return value.total;
}

/** Bons d'un restaurant (envoyés et reçus), les plus récents d'abord ; signatures seulement sur demande d'un bon. */
export async function listTransfers(tenantId: string, deskIds: string[] | null, costs: boolean) {
  const q = deskIds ? { $or: [{ fromDeskId: { $in: deskIds } }, { toDeskId: { $in: deskIds } }] } : {};
  const list = await DeskTransferModel.find({ tenantId, ...q }).select("-senderSignature -receiverSignature").sort({ sentAt: -1 }).limit(200).lean<Array<Record<string, unknown> & { lines: Array<Record<string, unknown>> }>>();
  return list.map(t => costs ? t : { ...t, value: undefined, lines: t.lines.map(l => ({ ...l, unitCost: undefined })) });
}

export async function getTransfer(tenantId: string, id: string, costs: boolean) {
  const t = await DeskTransferModel.findOne({ _id: id, tenantId }).lean<(Record<string, unknown> & { fromDeskId: Id; toDeskId: Id; lines: Array<Record<string, unknown>> }) | null>();
  if (!t) return null;
  return costs ? t : { ...t, value: undefined, lines: t.lines.map(l => ({ ...l, unitCost: undefined })) };
}
