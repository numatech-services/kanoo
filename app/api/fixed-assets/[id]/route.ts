import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fixedAssets", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!asset) return notFound();
  return ok(asset);
});

export const PATCH = withAuth("fixedAssets", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();

  // Si on passe une dotation en comptabilité
  if (body.action === "post_depreciation") {
    const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) });
    if (!asset) return notFound();
    const year = body.year || new Date().getFullYear();
    const entry = asset.depreciationSchedule?.find((e: {year: number; posted: boolean}) => e.year === year && !e.posted);
    if (!entry) return ok({ message: "Aucune dotation à passer pour cet exercice" });

    const acEntry = await AccountingEntryModel.create({
      tenantId: auth.tenantId, journalCode: "OD",
      entryDate: new Date(year, 11, 31), // 31 décembre
      reference: `AMORT-${asset.code}-${year}`,
      label: `Dotation amortissement ${asset.name} — ${year}`,
      lines: [
        { accountCode: asset.dotationAccount || "681", accountLabel: "Dotations aux amortissements", debit: entry.annuity, credit: 0 },
        { accountCode: asset.depreciationAccount || "28", accountLabel: `Amort. ${asset.name}`, debit: 0, credit: entry.annuity },
      ],
      createdBy: auth.userId,
    });

    await FixedAssetModel.updateOne(
      { _id: params.id, "depreciationSchedule.year": year },
      { $set: { "depreciationSchedule.$.posted": true, "depreciationSchedule.$.postedAt": new Date(), "depreciationSchedule.$.accountingEntryId": acEntry._id, currentNetValue: entry.netValue } }
    );

    await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "depreciation_posted", year, amount: entry.annuity } });
    return ok({ message: `Dotation ${entry.annuity.toLocaleString("fr-FR")} XOF passée en comptabilité`, entry: acEntry });
  }

  const updated = await FixedAssetModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!updated) return notFound();
  return ok(updated);
});
