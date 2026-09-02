import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { 
  withAuth, 
  ok, 
  created, 
  badRequest, 
  tenantFilter, 
  requireFields 
} from "@/lib/api-helpers";
import { EngagementModel } from "@/models/Engagement"; // À créer si inexistant
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// GET /api/budget/engagements — Liste des engagements
export const GET = withAuth("budgetChapters", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  
  // On récupère les engagements du tenant
  const engagements = await EngagementModel.find({
    ...tenantFilter(auth),
  }).sort({ createdAt: -1 }).lean();

  return ok(engagements);
});

// POST /api/budget/engagements — Créer un engagement et impacter le budget
export const POST = withAuth("budgetChapters", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["chapterId", "objet", "montant", "beneficiaire"]);
  if (missing) return badRequest(missing);

  await connectDB();

  // 1. Vérifier que le chapitre existe et appartient au tenant
  const chapter = await BudgetChapterModel.findOne({
    _id: body.chapterId,
    ...tenantFilter(auth)
  });

  if (!chapter) return badRequest("Chapitre budgétaire introuvable");

  // 2. Vérification optionnelle de disponibilité (Avertissement ou Blocage)
  const disponible = chapter.allocatedAmount - chapter.engagedAmount;
  if (disponible < body.montant) {
    // Ici on laisse passer mais on pourrait bloquer si la règle est stricte
    console.warn(`Dépassement de crédit sur le chapitre ${chapter.code}`);
  }

  // 3. Création de l'engagement
  const engagement = await EngagementModel.create({
    tenantId: auth.tenantId,
    reference: `ENG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
    chapterId: body.chapterId,
    chapterCode: chapter.code,
    description: body.objet,
    provider: body.beneficiaire,
    amount: Number(body.montant),
    status: "en_attente",
    notes: body.description,
    createdBy: auth.userId
  });

  // 4. Mise à jour atomique du montant engagé dans le chapitre
  await BudgetChapterModel.findByIdAndUpdate(body.chapterId, {
    $inc: { engagedAmount: Number(body.montant) }
  });

  // 5. Audit
  await logAudit(auth, "CREATE", "engagements", {
    resourceId: engagement._id.toString(),
    after: { 
      ref: engagement.reference, 
      amount: engagement.amount, 
      chapter: chapter.code 
    },
  });

  return created(engagement);
});