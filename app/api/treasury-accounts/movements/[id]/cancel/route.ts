import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { DeskFundingModel } from "@/models/DeskFunding";
import { reverseEntry } from "@/lib/accounting-reversal";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Move { _id: Types.ObjectId; accountId: Types.ObjectId; amount: number; label: string; reference?: string; source: string; linkedDocType?: string; entryId?: Types.ObjectId; transferPeerId?: Types.ObjectId; statementLineId?: unknown; cancelledAt?: Date; reversalOf?: unknown }

/**
 * POST { reason } — annule une saisie manuelle ou un virement interne :
 * écriture extournée, mouvement contraire (les deux jambes d'un virement).
 * Une saisie manuelle erronée ne se corrigeait que par une seconde saisie,
 * à la main, sans lien avec la première. Les mouvements nés d'une pièce
 * (règlement, paie, dépense) s'annulent par leur pièce.
 */
export const POST = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Mouvement introuvable");
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim().slice(0, 300);
  if (reason.length < 3) return badRequest("Motif d'annulation obligatoire.");
  const m = await TreasuryMovementModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<Move | null>();
  if (!m) return notFound("Mouvement introuvable");
  if (!["manual", "transfer"].includes(m.source)) return badRequest("Ce mouvement vient d'une pièce (règlement, paie, dépense…) : annulez-la depuis sa pièce.");
  if (m.reversalOf) return badRequest("Ce mouvement est lui-même une annulation.");
  if (m.cancelledAt) return badRequest("Mouvement déjà annulé.");
  const legs = [m];
  if (m.source === "transfer" && m.transferPeerId) {
    const peer = await TreasuryMovementModel.findOne({ _id: m.transferPeerId, ...tenantFilter(auth) }).lean<Move | null>();
    if (peer) legs.push(peer);
  }
  if (m.linkedDocType === "cash_closing") return badRequest("Ce mouvement vient d'un arrêté de caisse : il ne s'annule pas ici.");
  // Mouvement relié à une caisse de site ou à un financement : son annulation passe par sa pièce, sinon la caisse et la comptabilité divergent.
  const ids = legs.map(l => l._id);
  if (await DeskFundingModel.exists({ tenantId: auth.tenantId, movementIds: { $in: ids } })) return badRequest("Ce mouvement vient de la situation de départ d'un site : annulez-le depuis Ouverture des sites.");
  if (await ActivityCashEntryModel.exists({ tenantId: auth.tenantId, movementId: { $in: ids } })) return badRequest("Ce mouvement touche la caisse d'un site : saisissez un mouvement contraire pour garder les espèces attendues justes.");
  if (legs.some(l => l.statementLineId)) return badRequest("Mouvement rapproché d'un relevé : défaites d'abord le rapprochement.");

  await withTransaction(async session => {
    for (const l of legs) {
      const claim = await TreasuryMovementModel.updateOne({ _id: l._id, cancelledAt: { $exists: false } },
        { $set: { cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: reason } }, { session });
      if (claim.modifiedCount !== 1) throw new BusinessRuleError("Mouvement déjà annulé.");
      await TreasuryMovementModel.create([{
        tenantId: auth.tenantId, accountId: l.accountId, date: new Date(), amount: -l.amount,
        label: `Annulation — ${l.label}`.slice(0, 200), reference: l.reference, source: l.source, linkedDocType: l.linkedDocType,
        reversalOf: l._id, createdBy: auth.userId,
      }], { session });
    }
    // Une seule écriture pour les deux jambes d'un virement.
    if (m.entryId) await reverseEntry({ tenantId: auth.tenantId, userId: auth.userId, entryId: m.entryId, reason }, session);
  });
  await logAudit(auth, "UPDATE", "treasuryAccounts", { resourceId: params.id, metadata: { cancelled: m.source, amount: m.amount, reason } });
  return ok({ cancelled: legs.length });
});
