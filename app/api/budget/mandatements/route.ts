import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement";
// Importe ton modèle Mandat si tu en as un, sinon on utilise Engagement
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("budgetChapters", "update", async (req: NextRequest, { params }: any, auth: TokenPayload) => {
  await connectDB();
  const { engagementId, dateMandatement, observations } = await req.json();

  // 1. Trouver l'engagement et vérifier s'il est approuvé
  const engagement = await EngagementModel.findOne({
    _id: engagementId,
    status: 'approuve',
    ...tenantFilter(auth)
  });

  if (!engagement) {
    return badRequest("Engagement introuvable ou non approuvé pour mandatement");
  }

  // 2. Mettre à jour l'engagement en "mandaté"
  // (Ou créer une entrée dans une collection Mandatements)
  engagement.status = 'mandate';
  engagement.mandatedAt = new Date(dateMandatement);
  engagement.mandateNotes = observations;
  
  await engagement.save();

  return ok({ message: "Mandatement effectué avec succès", engagement });
});