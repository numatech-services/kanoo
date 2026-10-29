import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { calculerIS, calculerAcomptesIS, type RegimeIS } from "@/lib/niger-fiscal";
import { TokenPayload } from "@/lib/auth";
import { saveDeclaration } from "@/lib/fiscal-declaration";
import { isInternFor } from "@/lib/role-resources";
import { clientIp } from "@/lib/rate-limit";

/**
 * Résultat fiscal d'un exercice : résultat avant impôt (classes 6, 7 et 8,
 * hors 89 « impôts sur le résultat »). Seules les classes 6 et 7 étaient
 * lues : les plus-values de cession et autres produits HAO (82, 84, 86, 88)
 * échappaient à l'impôt, les charges HAO (81, 83, 85) et la participation
 * des travailleurs (87, déductibilité à confirmer) n'en étaient pas déduites. Aucun retraitement fiscal (réintégrations, déductions) : à faire
 * par le déclarant.
 */
async function computeIS(auth: TokenPayload, annee: number, secteur: RegimeIS) {
  const start = new Date(annee, 0, 1);
  const end = new Date(annee, 11, 31, 23, 59, 59, 999);
  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth), entryDate: { $gte: start, $lte: end }, journalCode: { $ne: "AN" },
  }).select("lines.accountCode lines.debit lines.credit").lean<Array<{ lines: Array<{ accountCode?: string; debit?: number; credit?: number }> }>>();

  let produits = 0, charges = 0, chiffreAffaires = 0;
  for (const e of entries) {
    for (const line of e.lines) {
      const code = line.accountCode || "";
      const s = (line.credit || 0) - (line.debit || 0);
      if (code.startsWith("70")) chiffreAffaires += s;
      if (code.startsWith("7") || /^8[2468]/.test(code)) produits += s;
      else if (code.startsWith("6") || /^8[1357]/.test(code)) charges -= s;
    }
  }
  const resultatComptable = Math.round(produits - charges);
  const resultatFiscal = resultatComptable;
  // IMF : sur le chiffre d'affaires HT (comptes 70).
  const calcul = calculerIS(resultatFiscal, { regime: secteur, chiffreAffairesHT: chiffreAffaires });
  return { annee, secteur, chiffreAffaires: Math.round(chiffreAffaires), produits: Math.round(produits), charges: Math.round(charges), resultatComptable, resultatFiscal, calcul, acomptes: calculerAcomptesIS(calcul.montantDu, annee) };
}

// « agricole » (15 %) n'existe plus depuis le CGI 2026 : ramené au régime normal.
const secteurOf = (v: unknown): RegimeIS => (v === "industrie" || v === "reduit" ? v : "normal");

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear() - 1));
  if (!Number.isInteger(annee) || annee < 2000) return badRequest("Exercice invalide");
  const result = await computeIS(auth, annee, secteurOf(url.searchParams.get("secteur")));

  const declaration = await FiscalDeclarationModel.findOne({
    ...tenantFilter(auth), type: "isbic", "period.annee": annee,
  }).lean<{ status?: string } | null>();

  return ok({
    ...result,
    statut: declaration?.status || "non_soumise",
    declaration: declaration || null,
  });
});

export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  // Une déclaration fiscale engage l'organisation : pas par un stagiaire.
  if (isInternFor(auth, "fiscalDeclarations")) return forbidden("Un stagiaire ne dépose pas de déclaration fiscale : demandez à votre chef de service.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const annee = Number(body.annee);
  // Exercice terminé uniquement : avant la fin d'année, la base est incomplète.
  if (!Number.isInteger(annee) || annee < 2000 || annee >= new Date().getFullYear()) return badRequest("Exercice invalide : seul un exercice terminé se déclare.");
  // Montants recalculés ici : ceux envoyés par le navigateur n'étaient pas
  // contrôlés, et la déclaration enregistrée pouvait différer de la comptabilité.
  const { resultatFiscal, calcul } = await computeIS(auth, annee, secteurOf(body.secteur));
  const decl = await saveDeclaration(auth, {
    type: "isbic", annee, motif: body.motif,
    amounts: { base: resultatFiscal, taux: calcul.taux, montant: calcul.montantDu, net: calcul.montantDu },
    trace: { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined },
  });
  return ok(decl);
});
