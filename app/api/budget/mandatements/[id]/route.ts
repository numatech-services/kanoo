import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// --- RÉCUPÉRATION (GET) ---
export const GET = withAuth("budgetChapters", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  
  try {
    // Extraction sécurisée de l'ID depuis l'URL (car params est souvent écrasé par withAuth)
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];

    console.log(`🔎 GET Engagement ID: ${id}`);

    const engagement = await EngagementModel.findOne({
      _id: id,
      ...tenantFilter(auth)
    }).lean();

    if (!engagement) {
      return badRequest("Engagement introuvable");
    }

    return ok({ data: engagement }); 
    
  } catch (error) {
    console.error("Erreur GET:", error);
    return badRequest("ID invalide ou erreur serveur");
  }
});

// --- MISE À JOUR (PATCH) ---
export const PATCH = withAuth("budgetChapters", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  
  try {
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];
    
    const body = await req.json();
    console.log("📦 Body reçu:", body);

    // On accepte 'status' ou 'action' du frontend
    const rawValue = body.status || body.action;
    
    // Mapping pour l'enum Mongoose (sans accents)
    let newStatus = rawValue;
    if (rawValue === "APPROVE") newStatus = "approuve";
    if (rawValue === "REJECT") newStatus = "rejete";

    const allowedStatus = ['en_attente', 'approuve', 'rejete', 'mandate'];
    if (!allowedStatus.includes(newStatus)) {
      return badRequest(`Statut invalide: ${newStatus}`);
    }

    const engagement = await EngagementModel.findOneAndUpdate(
      { _id: id, ...tenantFilter(auth) },
      { 
        $set: {
          status: newStatus,
          updatedAt: new Date(),
          validatedBy: auth.userId,
          ...(newStatus === 'mandate' ? { mandatedAt: new Date() } : {})
        }
      },
      { new: true, runValidators: true }
    );

    if (!engagement) {
      return badRequest("Engagement introuvable ou accès refusé");
    }

    // Audit Log
    await logAudit(auth, "UPDATE", "engagements", {
      resourceId: id,
      message: `Passage au statut ${newStatus.toUpperCase()}`,
      after: { status: newStatus }
    });

    console.log(`✅ Statut mis à jour: ${newStatus}`);
    return ok({ data: engagement });

  } catch (error: any) {
    console.error("💥 Erreur PATCH:", error.message);
    return badRequest(error.message);
  }
});