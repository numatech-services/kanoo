import type { ClientSession } from "mongoose";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { BusinessRuleError } from "@/lib/errors";

export class DepreciationError extends BusinessRuleError {
  constructor(message: string, readonly notFound = false) { super(message); }
}

interface ScheduleEntry { year: number; annuity: number; netValue: number; posted?: boolean }

/**
 * Passe l'écriture de dotation d'une annuité (OD, datée du 31/12 de l'année) :
 * 681 au débit, 28x au crédit, puis marque l'annuité comptabilisée et met à
 * jour la valeur nette.
 *
 * Une seule implémentation pour le bouton « Comptabiliser » (route
 * /api/fixed-assets/:id/depreciation) et pour la passation automatique de fin
 * d'exercice (lib/automation-jobs.ts).
 *
 * L'annuité est d'abord « réservée » par une mise à jour conditionnelle
 * (posted: false → true) : deux exécutions simultanées ne peuvent pas passer
 * deux dotations. Dans une transaction, l'échec de l'écriture (période
 * verrouillée…) annule la réservation.
 */
export async function postDepreciation(
  actor: { tenantId: string; userId: string },
  assetId: unknown, year: number, session?: ClientSession,
) {
  const asset = await FixedAssetModel.findOne({ _id: assetId, tenantId: actor.tenantId }).session(session ?? null);
  if (!asset) throw new DepreciationError("Immobilisation introuvable.", true);
  const entry = (asset.depreciationSchedule as ScheduleEntry[]).find(e => e.year === year);
  if (!entry) throw new DepreciationError(`Aucune annuité pour l'année ${year}`);
  if (entry.posted) throw new DepreciationError(`L'amortissement ${year} a déjà été comptabilisé`);
  if (!(entry.annuity > 0)) throw new DepreciationError(`Annuité ${year} nulle : rien à comptabiliser.`);

  const claimed = await FixedAssetModel.updateOne(
    { _id: asset._id, depreciationSchedule: { $elemMatch: { year, posted: { $ne: true } } } },
    { $set: { "depreciationSchedule.$.posted": true, "depreciationSchedule.$.postedAt": new Date() } },
    { session },
  );
  if (claimed.modifiedCount !== 1) throw new DepreciationError(`L'amortissement ${year} a déjà été comptabilisé`);

  try {
    const [accountingEntry] = await AccountingEntryModel.create([{
      tenantId: actor.tenantId,
      journalCode: "OD",
      entryDate: new Date(year, 11, 31),
      reference: `AMT-${asset.code}-${year}`,
      label: `Dotation amortissement — ${asset.name} (${year})`,
      lines: [
        { accountCode: asset.dotationAccount || "681", accountLabel: "Dotations aux amortissements", debit: entry.annuity, credit: 0 },
        { accountCode: asset.depreciationAccount || "28", accountLabel: `Amort. ${asset.name}`, debit: 0, credit: entry.annuity },
      ],
      linkedDocType: "fixed_asset",
      linkedDocId: asset._id,
      createdBy: actor.userId,
    }], { session });

    await FixedAssetModel.updateOne(
      { _id: asset._id, "depreciationSchedule.year": year },
      {
        $set: {
          "depreciationSchedule.$.accountingEntryId": accountingEntry._id,
          currentNetValue: entry.netValue,
          status: entry.netValue <= 0 ? "fully_depreciated" : "active",
        },
      },
      { session },
    );
    return { annuity: entry.annuity, accountingEntry, assetName: asset.name as string };
  } catch (err) {
    // Hors transaction, on libère l'annuité réservée pour ne pas la perdre.
    if (!session) {
      await FixedAssetModel.updateOne(
        { _id: asset._id, "depreciationSchedule.year": year },
        { $set: { "depreciationSchedule.$.posted": false }, $unset: { "depreciationSchedule.$.postedAt": "" } },
      ).catch(() => undefined);
    }
    throw err;
  }
}
