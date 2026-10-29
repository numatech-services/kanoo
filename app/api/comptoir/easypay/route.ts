import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, created, badRequest, forbidden, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { hasFinanceAccess } from "@/lib/role-resources";
import { generateApiKey } from "@/lib/api-key";
import { ApiKeyModel } from "@/models/ApiKey";
import { IntegrationEventModel } from "@/models/IntegrationEvent";
import { easypayBalance, recordRemittance, SOURCE } from "@/lib/easypay-server";
import { EASYPAY_ACCOUNT } from "@/lib/easypay";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Durée de vie d'une clé EasyPay (renouvelée depuis cet écran). */
const KEY_DAYS = 730;

/**
 * GET ?deskId&status — liaison EasyPay du comptoir : clés (sans leur valeur),
 * événements reçus (100 derniers, filtrables), compteurs par état, solde du
 * compte courant Numatech. Réservé au chef du comptoir et à la finance.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const status = url.searchParams.get("status");
  const base = { ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), source: SOURCE };
  const [keys, events, counts, balance] = await Promise.all([
    ApiKeyModel.find({ ...tenantFilter(auth), deskId, source: SOURCE }).select("-keyHash").sort({ createdAt: -1 }).lean(),
    IntegrationEventModel.find({ ...base, ...(status && ["applied", "failed", "rejected", "ignored"].includes(status) ? { status } : {}) })
      .select("-payload").sort({ createdAt: -1 }).limit(100).lean(),
    IntegrationEventModel.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    hasFinanceAccess(auth) ? easypayBalance(auth.tenantId) : Promise.resolve(null),
  ]);
  const daily = await dailyReconciliation(auth.tenantId, deskId, hasFinanceAccess(auth));
  const last = await IntegrationEventModel.findOne(base).sort({ createdAt: -1 }).select("createdAt").lean<{ createdAt: Date } | null>();
  return ok({ keys, events, counts: Object.fromEntries(counts.map(c => [c._id, c.n])), balance, daily, lastEventAt: last?.createdAt ?? null });
});

/**
 * Rapprochement des 7 derniers jours (heure de Niamey), jour par jour : ce
 * qu'EasyPay a envoyé (événements reçus, appliqués, en attente) et ce que
 * Kanoo en a fait (ventes par carte, annulations, recharges encaissées au
 * comptoir), le solde du jour dû par Numatech et les reversements enregistrés.
 */
async function dailyReconciliation(tenantId: string, deskId: string, finance: boolean) {
  const tid = new Types.ObjectId(tenantId), did = new Types.ObjectId(deskId);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(today.getTime() - 6 * 86_400_000);
  const day = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: "Africa/Niamey" } });
  const cardOf = { $sum: { $map: { input: { $filter: { input: "$payments", as: "p", cond: { $eq: ["$$p.method", "easypay"] } } }, as: "p", in: "$$p.amount" } } };
  const [sales, voids, topups, events, remits] = await Promise.all([
    ComptoirSaleModel.aggregate<{ _id: string; n: number; card: number }>([
      { $match: { tenantId: tid, deskId: did, date: { $gte: from }, "payments.method": "easypay" } },
      { $group: { _id: day("$date"), n: { $sum: 1 }, card: { $sum: cardOf } } },
    ]),
    ComptoirSaleModel.aggregate<{ _id: string; n: number; card: number }>([
      { $match: { tenantId: tid, deskId: did, status: "cancelled", cancelledAt: { $gte: from }, "payments.method": "easypay" } },
      { $group: { _id: day("$cancelledAt"), n: { $sum: 1 }, card: { $sum: cardOf } } },
    ]),
    ActivityCashEntryModel.aggregate<{ _id: string; n: number; amount: number }>([
      { $match: { tenantId: tid, deskId: did, category: "easypay_topup", date: { $gte: from } } },
      { $group: { _id: day("$date"), n: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    IntegrationEventModel.aggregate<{ _id: { d: string; s: string }; n: number }>([
      { $match: { tenantId: tid, deskId: did, source: SOURCE, createdAt: { $gte: from } } },
      { $group: { _id: { d: day("$createdAt"), s: "$status" }, n: { $sum: 1 } } },
    ]),
    finance ? AccountingEntryModel.aggregate<{ _id: string; received: number; paid: number }>([
      { $match: { tenantId: tid, linkedDocType: "easypay_remittance", entryDate: { $gte: from }, reversedBy: { $exists: false } } },
      { $unwind: "$lines" }, { $match: { "lines.accountCode": EASYPAY_ACCOUNT.accountCode } },
      { $group: { _id: day("$entryDate"), received: { $sum: "$lines.credit" }, paid: { $sum: "$lines.debit" } } },
    ]) : Promise.resolve([]),
  ]);
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(today.getTime() - i * 86_400_000); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); }
  return days.map(d => {
    const s = sales.find(x => x._id === d), v = voids.find(x => x._id === d), t = topups.find(x => x._id === d), r = remits.find(x => x._id === d);
    const ev = (st: string) => events.find(x => x._id.d === d && x._id.s === st)?.n ?? 0;
    const card = s?.card ?? 0, voided = v?.card ?? 0, topup = t?.amount ?? 0;
    return {
      day: d, sales: s?.n ?? 0, card, voids: v?.n ?? 0, voided, topups: t?.n ?? 0, topup,
      // Ce que Numatech doit au comptoir pour la journée : cartes encaissées − annulations − recharges reçues au comptoir.
      net: card - voided - topup,
      received: r?.received ?? 0, paid: r?.paid ?? 0,
      events: { applied: ev("applied"), pending: ev("failed") + ev("rejected"), ignored: ev("ignored") },
    };
  });
}

/**
 * POST { deskId, action } :
 *  - create_key { name? } : clé de l'API pour EasyPay (montrée une seule fois) ;
 *  - revoke_key { keyId } ;
 *  - remittance { treasuryAccountId, amount, direction: received|paid, date?, reference? } (finance).
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");

  if (body.action === "create_key") {
    const { key, hash, prefix } = generateApiKey();
    const doc = await ApiKeyModel.create({
      tenantId: auth.tenantId, userId: auth.userId, name: String(body.name || "EasyPay").slice(0, 80),
      keyHash: hash, keyPrefix: prefix, scopes: ["spot:read", "spot:write"], deskId: body.deskId, source: SOURCE,
      expiresAt: new Date(Date.now() + KEY_DAYS * 86_400_000),
    });
    await logAudit(auth, "CREATE", "api_key", { metadata: { keyId: String(doc._id), deskId: String(body.deskId), source: SOURCE } });
    return created({ key, prefix, expiresAt: doc.expiresAt, warning: "Cette clé ne sera plus affichée : copiez-la dans EasyPay maintenant." });
  }
  if (body.action === "revoke_key") {
    if (!isId(body.keyId)) return badRequest("Clé invalide.");
    const r = await ApiKeyModel.updateOne({ _id: body.keyId, ...tenantFilter(auth), deskId: body.deskId, source: SOURCE, isActive: true }, { $set: { isActive: false, revokedAt: new Date() } });
    if (r.modifiedCount !== 1) return notFound("Clé introuvable ou déjà révoquée.");
    await logAudit(auth, "UPDATE", "api_key", { metadata: { keyId: String(body.keyId), revoked: true } });
    return ok({ revoked: true });
  }
  if (body.action === "remittance") {
    if (!hasFinanceAccess(auth)) return forbidden("Les reversements sont réservés à la finance.");
    if (!isId(body.treasuryAccountId)) return badRequest("Choisissez le compte de trésorerie.");
    const entry = await recordRemittance(auth, { treasuryAccountId: body.treasuryAccountId, amount: Number(body.amount), direction: body.direction, date: body.date, reference: body.reference });
    await logAudit(auth, "CREATE", "easypay_remittance", { metadata: { entryId: String(entry._id), amount: Number(body.amount), direction: body.direction } });
    return created({ entryId: entry._id, balance: await easypayBalance(auth.tenantId) });
  }
  return badRequest("Action inconnue.");
});
