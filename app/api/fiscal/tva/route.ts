import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { TokenPayload } from "@/lib/auth";
import { VAT_LINES_MATCH, vatFromEntries } from "@/lib/vat";
import { saveDeclaration } from "@/lib/fiscal-declaration";
import { vatCreditAt, settlementReference, vatDueOf } from "@/lib/vat-settlement";
import { settleVatMonth, type SettlementResult } from "@/lib/vat-settlement-server";
import { isInternFor } from "@/lib/role-resources";
import { clientIp } from "@/lib/rate-limit";

/** TVA d'un mois, calculée sur les écritures (jamais reprise du navigateur). */
async function monthlyVat(auth: TokenPayload, annee: number, mois: number) {
  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: new Date(annee, mois - 1, 1), $lte: new Date(annee, mois, 0, 23, 59, 59, 999) },
    ...VAT_LINES_MATCH,
  }).lean<Array<{ journalCode?: string; lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>>();
  return vatFromEntries(entries);
}

const periodOf = (annee: unknown, mois: unknown) => {
  const a = Number(annee), m = Number(mois);
  return Number.isInteger(a) && a >= 2000 && a <= new Date().getFullYear() + 1 && Number.isInteger(m) && m >= 1 && m <= 12 ? { annee: a, mois: m } : null;
};

// GET /api/fiscal/tva?annee=2025&mois=12
// Calcule et retourne la déclaration TVA mensuelle Niger
export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const period = periodOf(url.searchParams.get("annee") || new Date().getFullYear(), url.searchParams.get("mois") || new Date().getMonth() + 1);
  if (!period) return badRequest("Paramètres annee et mois requis (mois: 1-12)");
  const { annee, mois } = period;

  const [vat, credit, settled] = await Promise.all([
    monthlyVat(auth, annee, mois),
    vatCreditAt(auth.tenantId, new Date(annee, mois - 1, 1)),
    AccountingEntryModel.exists({ ...tenantFilter(auth), linkedDocType: "vat_settlement", reference: settlementReference(annee, mois), reversedBy: { $exists: false }, reverses: { $exists: false } }),
  ]);
  const paiement = settled ? await vatDueOf(auth.tenantId, annee, mois) : null;
  const declaration = await FiscalDeclarationModel.findOne({
    ...tenantFilter(auth), type: "tva", "period.annee": annee, "period.mois": mois,
  }).sort({ updatedAt: -1 }).lean<{ status?: string; amounts?: { net?: number } } | null>();

  return ok({
    periode: { mois, annee },
    tvaCollectee: vat.collected,
    tvaDeductible: vat.deductible,
    tvaNette: vat.net,
    // Crédit de TVA des mois précédents (4449), imputé sur la TVA nette du mois.
    creditAnterieur: credit,
    aVerser: Math.max(0, vat.net - credit),
    creditReporte: Math.max(0, credit - Math.max(0, vat.net)) + (vat.net < 0 ? -vat.net : 0),
    liquidee: !!settled,
    // TVA due par la liquidation et déjà payée (4441).
    paiement,
    // Comptabilité du mois modifiée depuis la liquidation : à repasser avant de payer.
    liquidationPerimee: !!paiement && Math.abs(paiement.settledNet - vat.net) >= 1,
    declaration: declaration || null,
    statut: declaration?.status || "non_soumise",
    // Écart entre la déclaration enregistrée et la comptabilité d'aujourd'hui.
    ecartDeclaration: declaration && declaration.status !== "draft" && declaration.amounts?.net !== undefined ? vat.net - (declaration.amounts.net ?? 0) : 0,
  });
});

// POST /api/fiscal/tva — Enregistrer la déclaration du mois (montants recalculés)
export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  if (isInternFor(auth, "fiscalDeclarations")) return forbidden("Un stagiaire ne dépose pas de déclaration fiscale : demandez à votre chef de service.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const period = periodOf(body.annee, body.mois);
  if (!period) return badRequest("Paramètres annee et mois requis (mois: 1-12)");
  // Un mois se déclare une fois écoulé.
  if (new Date(period.annee, period.mois, 1) > new Date()) return badRequest("Ce mois n'est pas terminé.");
  const vat = await monthlyVat(auth, period.annee, period.mois);
  const decl = await saveDeclaration(auth, {
    type: "tva", ...period, motif: body.motif, reference: typeof body.reference === "string" ? body.reference.slice(0, 60) : undefined,
    amounts: { montant: vat.collected, deductible: vat.deductible, net: vat.net },
    trace: { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined },
  });
  // Liquidation sur demande explicite (case cochée) : 443/445 soldés vers 4441 ou 4449.
  // Refusée avec sa raison, la déclaration restant enregistrée ; « Passer la liquidation » la reprend.
  let settlement: SettlementResult | null = null, warning: string | undefined;
  if (body.settle === true) {
    const r = await settleVatMonth(auth, period.annee, period.mois, decl._id);
    settlement = r.settlement; warning = r.warning && `Déclaration enregistrée, liquidation non passée : ${r.warning}`;
  }
  return ok({ ...(decl.toObject ? decl.toObject() : decl), settlement, warning });
});
