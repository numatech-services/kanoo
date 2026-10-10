import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement";
// Importe ton modèle Mandat si tu en as un, sinon on utilise Engagement
import { TokenPayload } from "@/lib/auth";

// Engagements : droit « commitmentOrders » (ordonnateur) ; mandatements : droit
// « paymentOrders » (comptable public). Les deux routes exigeaient le droit sur
// les chapitres budgétaires : le comptable public ne pouvait pas mandater, et le
// DAF (lecture seule des engagements) pouvait engager et mandater.

/** GET — engagements mandatés (tableau de bord, écran Mandatements). */
export const GET = withAuth("paymentOrders", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const items = await EngagementModel.find({ ...tenantFilter(auth), status: "mandate" }).sort({ mandatedAt: -1, updatedAt: -1 }).limit(200).lean();
  return ok(items);
});

export const POST = withAuth("paymentOrders", "create", async (req: NextRequest, auth: TokenPayload) => {
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