import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, serverError, tenantFilter } from "@/lib/api-helpers";
import { PublicRevenueModel } from "@/models/PublicRevenue";
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { ProductModel } from "@/models/Product";
import { checkTenantRefs } from "@/lib/tenant-refs";
import { logAudit } from "@/lib/audit";
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
  await connectDB();
  const body = await req.json().catch(() => ({}));

  if (!body.budgetChapterId || !body.amount || !body.payerName) {
    return badRequest(`Champs manquants : ${[!body.budgetChapterId && "chapitre", !body.amount && "montant", !body.payerName && "contribuable"].filter(Boolean).join(", ")}.`);
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("Montant invalide.");
  // Le chapitre (et le service) doivent appartenir à l'organisation : sinon le
  // populate affichait le chapitre budgétaire d'une autre collectivité.
  const refErr = await checkTenantRefs(auth.tenantId, [
    { model: BudgetChapterModel, ids: body.budgetChapterId, label: "Chapitre budgétaire" },
    { model: ProductModel, ids: body.serviceId, label: "Service" },
  ]);
  if (refErr) return badRequest(refErr);

  try {
    // Liste blanche ; plus de journalisation des données du contribuable en
    // console (NIF, nom) : elles finissaient dans les journaux de l'hébergeur.
    const revenue = await PublicRevenueModel.create({
      budgetChapterId: body.budgetChapterId,
      serviceId: body.serviceId || undefined,
      payerName: String(body.payerName).trim().slice(0, 200),
      payerNIF: body.payerNIF ? String(body.payerNIF).trim().slice(0, 40) : undefined,
      amount: Math.round(amount),
      type: body.type,
      paymentMethod: body.paymentMethod,
      notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
      tenantId: auth.tenantId,
      collectedBy: auth.userId,
      status: "collected",
      date: new Date(),
      // Référence de quittance : tirée cryptographiquement plutôt que par
      // Math.random, dont l'espace et la prévisibilité conviennent mal à un
      // document fiscal. L'index unique reste le garde-fou en cas de collision.
      reference: `Q-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
    });
    await logAudit(auth, "CREATE", "publicRevenues", { resourceId: String(revenue._id), after: { reference: revenue.reference, amount: revenue.amount } });
    return NextResponse.json({ data: revenue }, { status: 201 });
  } catch (error) {
    // Erreur de validation (type ou moyen de paiement hors liste) : message
    // métier, jamais le message brut de Mongoose.
    if (error instanceof Error && error.name === "ValidationError") return badRequest("Type de recette ou moyen de paiement invalide.");
    return serverError(error);
  }
});
