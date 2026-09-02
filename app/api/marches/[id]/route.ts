import { NextRequest } from "next/server";
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

// --- PATCH: Modifier un marché (Changement de statut, attribution, etc.) ---
export const PATCH = withAuth("publicTenders", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  try {
    const body = await req.json();
    await connectDB();

    // 1. Sécurité : Vérifier l'existence et l'appartenance au tenant
    const existing = await PublicTenderModel.findOne({ _id: params.id, ...tenantFilter(auth) });
    if (!existing) return notFound("Marché introuvable");

    // 2. Nettoyage des données pour éviter les erreurs BSON (Cast ObjectId failed)
    const updates = { ...body };
    const fieldsToClean = ["budgetChapterId", "winnerId", "commissionMemberIds"];
    
    fieldsToClean.forEach(field => {
      if (updates[field] === "" || updates[field] === null) {
        delete updates[field];
      }
    });

    // 3. Mise à jour
    const updatedItem = await PublicTenderModel.findByIdAndUpdate(
      params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    // 4. Audit
    await logAudit(auth, "UPDATE", "marches", { 
      resourceId: params.id,
      before: existing.toObject(),
      after: updatedItem?.toObject()
    });

    return ok(updatedItem);
  } catch (error: any) {
    console.error("💥 [PATCH /api/marches/[id]] Erreur:", error.message);
    return badRequest(error.message);
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