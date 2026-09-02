import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { TokenPayload } from "@/lib/auth";

// GET /api/fiscal/tva?annee=2025&mois=12
// Calcule et retourne la déclaration TVA mensuelle Niger
export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const mois = parseInt(url.searchParams.get("mois") || String(new Date().getMonth() + 1));

  if (!annee || !mois || mois < 1 || mois > 12) {
    return badRequest("Paramètres annee et mois requis (mois: 1-12)");
  }

  const startDate = new Date(annee, mois - 1, 1);
  const endDate = new Date(annee, mois, 0, 23, 59, 59);

  // Agréger les mouvements TVA depuis les écritures comptables
  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: startDate, $lte: endDate },
    "lines.accountCode": { $in: ["443000", "445000"] },
  }).lean();

  let tvaCollectee = 0;
  let tvaDeductible = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode === "443000") {
        tvaCollectee += line.credit - line.debit;
      }
      if (line.accountCode === "445000") {
        tvaDeductible += line.debit - line.credit;
      }
    }
  }

  const tvaNette = tvaCollectee - tvaDeductible;

  // Récupérer la déclaration si elle existe déjà
  const declaration = await FiscalDeclarationModel.findOne({
    ...tenantFilter(auth),
    type: "tva",
    "period.annee": annee,
    "period.mois": mois,
  }).lean();

  return ok({
    periode: { mois, annee },
    tvaCollectee: Math.round(tvaCollectee),
    tvaDeductible: Math.round(tvaDeductible),
    tvaNette: Math.round(tvaNette),
    aVerser: Math.max(0, Math.round(tvaNette)),
    creditReporte: tvaNette < 0 ? Math.round(Math.abs(tvaNette)) : 0,
    declaration: declaration || null,
    statut: declaration?.status || "non_soumise",
  });
});

// POST /api/fiscal/tva — Soumettre la déclaration
export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();

  const decl = await FiscalDeclarationModel.create({
    tenantId: auth.tenantId,
    type: "tva",
    period: { mois: body.mois, annee: body.annee },
    amounts: {
      base: body.baseImposable,
      montant: body.tvaCollectee,
      deductible: body.tvaDeductible,
      net: body.tvaNette,
    },
    status: "submitted",
    submittedAt: new Date(),
    reference: body.reference,
    createdBy: auth.userId,
  });

  return ok(decl);
});
