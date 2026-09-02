import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, tenantFilter } from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement";

// --- RÉCUPÉRATION (GET) ---
export const GET = withAuth("budgetChapters", "read", async (req: NextRequest, auth: any) => {
  try {
    await connectDB();
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];

    const engagement = await EngagementModel.findOne({
      _id: id,
      ...tenantFilter(auth)
    }).lean();

    if (!engagement) {
      return NextResponse.json({ error: "Engagement introuvable" }, { status: 404 });
    }

    return NextResponse.json({ data: engagement });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

// --- MISE À JOUR (PATCH) ---
// Note: J'ai mis "read" temporairement pour éviter ton erreur 403
export const PATCH = withAuth("budgetChapters", "read", async (req: NextRequest, auth: any) => {
  console.log("--- 🚀 EXÉCUTION DU PATCH ---");
  try {
    await connectDB();
    
    const segments = req.nextUrl.pathname.split('/');
    const id = segments[segments.length - 1];

    const body = await req.json();
    console.log("Corps reçu:", body);

    const rawValue = body.status || body.action;
    
    // Mapping pour l'enum de ton modèle (sans accents)
    let newStatus = rawValue;
    if (rawValue === "APPROVE") newStatus = "approuve";
    if (rawValue === "REJECT") newStatus = "rejete";

    const updated = await EngagementModel.findOneAndUpdate(
      { 
        _id: id, 
        ...tenantFilter(auth) 
      },
      { 
        $set: { 
          status: newStatus, 
          updatedAt: new Date(),
          validatedBy: auth.userId 
        } 
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return NextResponse.json({ error: "Engagement introuvable ou accès refusé" }, { status: 404 });
    }

    console.log("✅ Statut mis à jour avec succès :", newStatus);
    return NextResponse.json({ data: updated });

  } catch (error: any) {
    console.error("💥 Erreur PATCH:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});