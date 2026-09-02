import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST /api/fixed-assets/:id/depreciation
 * Passe l'écriture comptable d'amortissement pour une année donnée
 */
export const POST = withAuth("fixedAssets", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { year } = await req.json();
  if (!year) return badRequest("Année requise");

  const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!asset) return notFound();

  const entry = asset.depreciationSchedule.find(
    (e: { year: number; posted: boolean }) => e.year === year
  );
  if (!entry) return badRequest(`Aucune annuité pour l'année ${year}`);
  if (entry.posted) return badRequest(`L'amortissement ${year} a déjà été comptabilisé`);

  // Créer l'écriture comptable
  const accountingEntry = await AccountingEntryModel.create({
    tenantId: auth.tenantId,
    journalCode: "OD",
    entryDate: new Date(year, 11, 31),
    reference: `AMT-${asset.code}-${year}`,
    label: `Dotation amortissement — ${asset.name} (${year})`,
    lines: [
      { accountCode: asset.dotationAccount || "681", accountLabel: "Dotations aux amortissements", debit: entry.annuity, credit: 0 },
      { accountCode: asset.depreciationAccount || "28", accountLabel: `Amort. ${asset.name}`, debit: 0, credit: entry.annuity },
    ],
    createdBy: auth.userId,
  });

  // Marquer l'entrée comme passée + mettre à jour VNC
  await FixedAssetModel.findOneAndUpdate(
    { _id: params.id, "depreciationSchedule.year": year },
    {
      $set: {
        "depreciationSchedule.$.posted": true,
        "depreciationSchedule.$.postedAt": new Date(),
        "depreciationSchedule.$.accountingEntryId": accountingEntry._id,
        currentNetValue: entry.netValue,
        status: entry.netValue <= 0 ? "fully_depreciated" : "active",
      },
    }
  );

  await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "depreciation_posted", year, annuity: entry.annuity } });
  return ok({ message: `Amortissement ${year} comptabilisé`, annuity: entry.annuity, accountingEntry });
});
