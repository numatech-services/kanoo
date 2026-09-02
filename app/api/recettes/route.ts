import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { PublicRevenueModel } from "@/models/PublicRevenue";
import { logAudit } from "@/lib/audit";

export const GET = withAuth("publicRevenues", "read", async (req: NextRequest, auth: any) => {
  await connectDB();
  const revenues = await PublicRevenueModel.find(tenantFilter(auth))
    .populate("budgetChapterId", "code label")
    .sort({ createdAt: -1 })
    .lean();
  return ok(revenues);
});
export const POST = withAuth("publicRevenues", "create", async (req: NextRequest, auth: any) => {
  try {
    await connectDB();
    const body = await req.json();

    // Log pour debugger (regarde ton terminal VS Code)
    console.log("Données reçues API Recettes:", body);

    // Validation plus souple pour identifier le coupable
    if (!body.budgetChapterId || !body.amount || !body.payerName) {
      return badRequest(`Champs manquants : ${!body.budgetChapterId ? 'Chapitre ' : ''}${!body.amount ? 'Montant ' : ''}${!body.payerName ? 'Contribuable' : ''}`);
    }

    const revenue = await PublicRevenueModel.create({
      ...body,
      tenantId: auth.tenantId,
      collectedBy: auth.id || auth.userId, 
      status: "collected", 
      date: new Date(),
      // Génération d'une référence unique si non fournie
      reference: body.reference || `Q-${new Date().getFullYear()}-${Math.random().toString(36).toUpperCase().substr(2, 6)}`
    });

    return NextResponse.json({ data: revenue }, { status: 201 });
  } catch (error: any) {
    console.error("Erreur insertion MongoDB:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});