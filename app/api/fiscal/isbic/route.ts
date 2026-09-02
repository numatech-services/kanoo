import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { calculerIS, calculerAcomptesIS } from "@/lib/niger-fiscal";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear() - 1));
  const secteur = (url.searchParams.get("secteur") || "normal") as "normal" | "agricole";

  const start = new Date(annee, 0, 1);
  const end = new Date(annee, 11, 31, 23, 59, 59);

  // Calcul du résultat fiscal : produits − charges (comptes 7xx − comptes 6xx)
  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth), entryDate: { $gte: start, $lte: end },
  }).lean();

  let produits = 0, charges = 0;
  for (const e of entries) {
    for (const line of e.lines) {
      const code = line.accountCode || "";
      if (code.startsWith("7")) { produits += line.credit - line.debit; }
      if (code.startsWith("6")) { charges += line.debit - line.credit; }
    }
  }

  const resultatComptable = produits - charges;
  const resultatFiscal = resultatComptable; // Simplification : pas de retraitements fiscaux pour MVP

  const calcul = calculerIS(resultatFiscal, secteur);
  const acomptes = calculerAcomptesIS(calcul.montantDu);

  const declaration = await FiscalDeclarationModel.findOne({
    ...tenantFilter(auth), type: "isbic", "period.annee": annee,
  }).lean();

  return ok({
    annee, secteur, resultatComptable, resultatFiscal,
    produits, charges,
    calcul, acomptes,
    statut: declaration?.status || "non_soumise",
    declaration: declaration || null,
  });
});

export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  if (!body.annee) return badRequest("annee requis");

  const existing = await FiscalDeclarationModel.findOne({ ...tenantFilter(auth), type: "isbic", "period.annee": body.annee });
  if (existing) {
    existing.status = "submitted";
    existing.submittedAt = new Date();
    await existing.save();
    return ok(existing);
  }

  const decl = await FiscalDeclarationModel.create({
    tenantId: auth.tenantId, type: "isbic",
    period: { annee: body.annee },
    amounts: { base: body.resultatFiscal || 0, montant: body.montantDu || 0, net: body.montantDu || 0 },
    status: "submitted", submittedAt: new Date(), createdBy: auth.userId,
  });
  return ok(decl);
});
