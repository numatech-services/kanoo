import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { CRMDealModel } from "@/models/CRMDeal";
import { CRMActivityModel } from "@/models/CRMActivity";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

const STAGE_PROBABILITY: Record<string,number> = { prospect:10,contacted:20,qualified:40,proposal:60,negotiation:75,won:100,lost:0 };

export const PATCH = withAuth("clients", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  const update: Record<string,unknown> = { ...body, lastActivityAt: new Date() };

  // Auto-update probabilité quand le stage change
  if (body.stage && !body.probability) update.probability = STAGE_PROBABILITY[body.stage] ?? 50;
  if (body.stage === "won") update.closedAt = new Date();
  if (body.stage === "lost") update.closedAt = new Date();

  const deal = await CRMDealModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, update, { new: true });
  if (!deal) return notFound();

  // Créer une activité de changement de stage si nécessaire
  if (body.stage) {
    await CRMActivityModel.create({
      tenantId: auth.tenantId, dealId: params.id,
      type: "note", title: `Étape → ${body.stage}`,
      notes: body.stageNote || "", createdBy: auth.userId,
    });
  }

  await logAudit(auth, "UPDATE", "clients", { resourceId: params.id, after: body });
  return ok(deal);
});

export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const [deal, activities] = await Promise.all([
    CRMDealModel.findOne({ _id: params.id, ...tenantFilter(auth) })
      .populate("clientId","name code email phone").populate("ownerId","firstName lastName").lean(),
    CRMActivityModel.find({ dealId: params.id, tenantId: auth.tenantId }).sort({ doneAt: -1 }).lean(),
  ]);
  if (!deal) return notFound();
  return ok({ deal, activities });
});
