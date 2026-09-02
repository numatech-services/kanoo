import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  ok, 
  created, 
  badRequest, 
  getPagination, 
  paginatedResponse, 
  tenantFilter, 
  requireFields 
} from "@/lib/api-helpers";
import { PublicTenderModel } from "@/models/PublicTender";
import { determineProcedureMarche, LIBELLES_PROCEDURES } from "@/lib/niger-fiscal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Note : La ressource "publicTenders" doit correspondre à tes permissions.
 */

// --- GET /api/marches : Liste des marchés ---
export const GET = withAuth("publicTenders", "read", async (req: NextRequest, auth: TokenPayload) => {
  console.log("🔍 [GET /api/marches] Récupération de la liste...");
  await connectDB();
  
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;

  try {
    const [items, total] = await Promise.all([
      PublicTenderModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      PublicTenderModel.countDocuments(filter),
    ]);

    return paginatedResponse(items, total, pagination);
  } catch (error: any) {
    console.error("💥 [GET /api/marches] Erreur:", error.message);
    return badRequest("Impossible de charger les marchés.");
  }
});

// --- POST /api/marches : Créer un nouveau marché ---
export const POST = withAuth("publicTenders", "update", async (req: NextRequest, auth: TokenPayload) => {
  console.log("🚀 [POST /api/marches] Création d'un nouveau marché...");
  
  try {
    const body = await req.json();

    // 1. Validation des champs critiques
    const missing = requireFields(body, ["object", "estimatedAmount"]);
    if (missing) return badRequest(missing);

    // 2. NETTOYAGE DES DONNÉES (Évite les erreurs BSON d'ID vides)
    const cleanedData = { ...body };
    const fieldsToClean = ["budgetChapterId", "winnerId", "entityId"];
    
    fieldsToClean.forEach(field => {
      if (cleanedData[field] === "" || cleanedData[field] === undefined) {
        delete cleanedData[field];
      }
    });

    await connectDB();

    // 3. Logique métier : Procédure & Référence
    const amount = Number(body.estimatedAmount);
    const procedure = body.procedure || determineProcedureMarche(amount);

    const year = new Date().getFullYear();
    const count = await PublicTenderModel.countDocuments({ 
      tenantId: auth.tenantId,
      createdAt: { $gte: new Date(`${year}-01-01`) } 
    });
    
    const reference = `MRC-${year}-${String(count + 1).padStart(4, "0")}`;

    // 4. Création du document
    const tender = await PublicTenderModel.create({
      ...cleanedData,
      estimatedAmount: amount,
      tenantId: auth.tenantId,
      reference,
      procedure,
      status: body.status || "planning",
    });

    // 5. Audit Log
    await logAudit(auth, "CREATE", "publicTender", {
      resourceId: tender._id,
      after: { reference, object: body.object, amount }
    });

    console.log(`✅ [POST /api/marches] Marché créé : ${reference}`);

    return created({
      ...tender.toObject(),
      procedureLabel: (LIBELLES_PROCEDURES as any)[procedure] || procedure,
    });

  } catch (error: any) {
    console.error("💥 [POST /api/marches] Erreur Fatale:", error.message);
    
    // Si l'ID est mal formé (CastError), on renvoie un message clair
    if (error.name === "CastError") {
      return badRequest("Un ID de référence (chapitre, entité) est invalide.");
    }
    
    return badRequest(`Erreur : ${error.message}`);
  }
});