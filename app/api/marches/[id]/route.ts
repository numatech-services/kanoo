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