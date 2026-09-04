import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PublicTenderModel } from "@/models/PublicTender";
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { EngagementModel } from "@/models/Engagement";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/marches/[id]/engagement — crée l'engagement budgétaire correspondant
 * à un marché attribué, et le rattache au marché. Fait le pont, jusque-là
 * manquant, entre l'attribution d'un marché public et l'exécution budgétaire.
 */
export const POST = withAuth("budgetChapters", "create", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const tender = await PublicTenderModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!tender) return notFound("Marché introuvable");
  if (tender.status !== "attributed") return badRequest("Le marché doit être attribué avant l'engagement.");
  if (tender.engagementId) return conflict("Un engagement a déjà été créé pour ce marché.");
  if (!tender.budgetChapterId) return badRequest("Rattachez d'abord un chapitre budgétaire au marché.");
  if (!tender.winnerAmount || !tender.winnerName) return badRequest("Titulaire ou montant d'attribution manquant.");

  const chapter = await BudgetChapterModel.findOne({ _id: tender.budgetChapterId, ...tenantFilter(auth) });
  if (!chapter) return badRequest("Chapitre budgétaire introuvable.");

  const engagement = await EngagementModel.create({
    tenantId: auth.tenantId,
    reference: `ENG-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
    chapterId: chapter._id,
    chapterCode: chapter.code,
    description: `Marché ${tender.reference} — ${tender.object}`,
    provider: tender.winnerName,
    amount: tender.winnerAmount,
    status: "en_attente",
    createdBy: auth.userId,
  });

  tender.engagementId = engagement._id;
  await tender.save();
  await logAudit(auth, "CREATE", "budgetChapters", { resourceId: String(engagement._id), metadata: { fromTender: tender.reference } });

  return created({ engagementId: engagement._id, reference: engagement.reference });
});
