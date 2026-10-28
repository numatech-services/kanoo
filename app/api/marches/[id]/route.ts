import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  ok, 
  notFound, 
  noContent, 
  badRequest, 
  tenantFilter 
} from "@/lib/api-helpers";
import { PublicTenderModel } from "@/models/PublicTender";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

// --- GET: Récupérer un marché par son ID ---
export const GET = withAuth("publicTenders", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  
  const item = await PublicTenderModel.findOne({ 
    _id: params.id, 
    ...tenantFilter(auth) 
  }).lean();

  if (!item) return notFound("Marché introuvable");
  return ok(item);
});

// --- PATCH: Modifier un marché (Changement de statut, dépouillement, attribution) ---
const SCALAR_FIELDS = ["object", "procedure", "estimatedAmount", "status", "publishDate", "bidsDeadline", "openingDate", "attributionDate", "winnerName", "winnerAmount", "notes", "cancelReason", "bids"];
const OID_FIELDS = ["budgetChapterId", "winnerId", "engagementId"];

export const PATCH = withAuth("publicTenders", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  try {
    const body = await req.json();
    await connectDB();

    const existing = await PublicTenderModel.findOne({ _id: params.id, ...tenantFilter(auth) });
    if (!existing) return notFound("Marché introuvable");

    // Liste blanche + traitement sûr des ObjectId : un champ ObjectId ne reçoit
    // que des identifiants valides (un nom saisi en clair partait autrefois dans
    // `winnerId` → CastError, l'attribution échouait systématiquement).
    const set: Record<string, unknown> = {};
    for (const f of SCALAR_FIELDS) if (f in body) set[f] = body[f];
    for (const f of OID_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v && Types.ObjectId.isValid(String(v))) set[f] = v;
      else set[f] = undefined; // vide ou invalide → on retire le lien
    }
    // Cycle de vie : statut connu, et pas de retour en arrière après
    // attribution (hors annulation) ; on n'attribue qu'une offre conforme.
    if ("status" in set) {
      const ORDER = ["planning", "draft", "published", "bids_open", "bids_closed", "evaluation", "attributed", "completed"];
      const to = String(set.status), from = String(existing.status);
      if (to !== "cancelled" && !ORDER.includes(to)) return badRequest("Statut invalide.");
      if (from === "cancelled" || from === "completed") return badRequest("Marché clos : son statut ne change plus.");
      if (to !== "cancelled" && ORDER.indexOf(to) < ORDER.indexOf(from) && ["attributed"].includes(from)) return badRequest("Marché attribué : il ne revient pas en arrière (annulez-le si besoin).");
      if (to === "attributed") {
        const bids = (Array.isArray(body.bids) ? body.bids : existing.bids ?? []) as Array<{ _id?: unknown; bidderName: string; supplierId?: unknown; amount: number; compliant?: boolean }>;
        const winner = body.winnerBidId ? bids.find(b => String(b._id) === String(body.winnerBidId)) : bids.find(b => b.bidderName === (set.winnerName ?? existing.winnerName));
        if (!winner) return badRequest("Désignez l'offre retenue parmi les offres dépouillées.");
        if (winner.compliant === false) return badRequest("Une offre non conforme ne peut pas être retenue.");
        // L'attributaire est reporté depuis l'offre (fournisseur et montant) :
        // l'écran n'envoyait que le nom, le fournisseur restait inconnu.
        set.winnerName = winner.bidderName;
        set.winnerAmount = winner.amount;
        if (winner.supplierId && Types.ObjectId.isValid(String(winner.supplierId))) set.winnerId = winner.supplierId;
        if (!set.attributionDate && !existing.attributionDate) set.attributionDate = new Date();
      }
    }
    if (Array.isArray(body.commissionMemberIds)) {
      set.commissionMemberIds = body.commissionMemberIds.filter((x: unknown) => typeof x === "string" && Types.ObjectId.isValid(x));
    }

    const updatedItem = await PublicTenderModel.findByIdAndUpdate(
      params.id,
      { $set: set },
      { new: true, runValidators: true }
    );

    // 4. Audit
    await logAudit(auth, "UPDATE", "marches", { 
      resourceId: params.id,
      before: existing.toObject(),
      after: updatedItem?.toObject()
    });

    return ok(updatedItem);
  } catch (error) {
    console.error("💥 [PATCH /api/marches/[id]] Erreur:", errorMessage(error));
    return badRequest(errorMessage(error));
  }
});

// --- DELETE: Supprimer un marché ---
export const DELETE = withAuth("publicTenders", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const item = await PublicTenderModel.findOneAndDelete({ 
    _id: params.id, 
    ...tenantFilter(auth) 
  });

  if (!item) return notFound("Marché introuvable ou déjà supprimé");

  await logAudit(auth, "DELETE", "marches", { 
    resourceId: params.id,
    before: item.toObject() 
  });

  return noContent();
});