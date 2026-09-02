import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { PublicRevenueModel } from "@/models/PublicRevenue";
import { errorMessage } from "@/lib/errors";
import { TokenPayload } from "@/lib/auth";
import { randomBytes } from "crypto";

export const GET = withAuth("publicRevenues", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const revenues = await PublicRevenueModel.find(tenantFilter(auth))
    .populate("budgetChapterId", "code label")
    .sort({ createdAt: -1 })
    .lean();
  return ok(revenues);
});
export const POST = withAuth("publicRevenues", "create", async (req: NextRequest, auth: TokenPayload) => {
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
      collectedBy: auth.userId,
      status: "collected", 
      date: new Date(),
      // Génération d'une référence unique si non fournie
      // Référence de quittance : tirée cryptographiquement plutôt que par
      // Math.random, dont l'espace et la prévisibilité conviennent mal à un
      // document fiscal. L'index unique reste le garde-fou en cas de collision.
      reference: body.reference || `Q-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`
    });

    return NextResponse.json({ data: revenue }, { status: 201 });
  } catch (error) {
    console.error("Erreur insertion MongoDB:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
});