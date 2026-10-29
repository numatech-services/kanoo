import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields, serverError } from "@/lib/api-helpers";
import { PublicTenderModel } from "@/models/PublicTender";
import { determineProcedureMarche, LIBELLES_PROCEDURES, type ProcedureMarche } from "@/lib/niger-fiscal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { errorMessage, errorName } from "@/lib/errors";
import { nextSerial } from "@/lib/serial";

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
  } catch (error) {
    console.error("💥 [GET /api/marches] Erreur:", errorMessage(error));
    return badRequest("Impossible de charger les marchés.");
  }
});

// --- POST /api/marches : Créer un nouveau marché ---
/** Libellé d'une procédure, ou la valeur brute si elle n'est pas reconnue. */
function procedureLabel(value: unknown): string {
  const key = String(value);
  return key in LIBELLES_PROCEDURES
    ? LIBELLES_PROCEDURES[key as ProcedureMarche]
    : key;
}

export const POST = withAuth("publicTenders", "create", async (req: NextRequest, auth: TokenPayload) => {
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

    // Référence : plus grand numéro de l'année + 1, et non « nombre de marchés
    // + 1 » — après une suppression, ce dernier ressortait un numéro existant
    // (index unique → erreur 500). Nouvelle tentative en cas de collision.
    const year = new Date().getFullYear();
    const reference = await nextSerial(auth.tenantId, { prefix: "MRC", year, digits: 4, model: PublicTenderModel as never, field: "reference" });

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
      // `procedure` peut venir du corps de la requête : on ne l'indexe qu'après
      // avoir vérifié qu'il fait bien partie des procédures connues.
      procedureLabel: procedureLabel(procedure),
    });

  } catch (error) {
    console.error("💥 [POST /api/marches] Erreur Fatale:", errorMessage(error));
    
    // Si l'ID est mal formé (CastError), on renvoie un message clair
    if (errorName(error) === "CastError") {
      return badRequest("Un ID de référence (chapitre, entité) est invalide.");
    }
    
    return serverError(error);
  }
});