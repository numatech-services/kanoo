import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ledgerFor, treasuryKind, recordMovement } from "@/lib/treasury";
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

  // Cession / mise au rebut : sortie de l'actif en comptabilité.
  if (body.action === "dispose") {
    const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) });
    if (!asset) return notFound();
    if (asset.status === "disposed") return badRequest("Immobilisation déjà sortie de l'actif.");
    const date = body.date ? new Date(body.date) : new Date();
    if (isNaN(date.getTime())) return badRequest("Date invalide.");
    const reason = ["sale", "scrap", "transfer", "other"].includes(body.reason) ? body.reason : "other";
    const price = Math.max(0, Math.round(Number(body.price) || 0));
    const cumulated = (asset.depreciationSchedule ?? []).filter((e: { posted?: boolean }) => e.posted)
      .reduce((m: number, e: { cumulative: number }) => Math.max(m, e.cumulative), 0);
    const vnc = Math.max(0, asset.acquisitionCost - cumulated);
    let ledger: { accountCode: string; accountLabel: string } = { accountCode: "485000", accountLabel: "Créances sur cessions d'immobilisations" };
    if (price > 0 && body.treasuryAccountId) {
      const kind = await treasuryKind(auth.tenantId, body.treasuryAccountId);
      if (!kind) return badRequest("Compte de trésorerie introuvable.");
      ledger = ledgerFor(kind);
    }
    await withTransaction(async session => {
      const lines = [
        ...(cumulated > 0 ? [{ accountCode: asset.depreciationAccount || "28", accountLabel: `Amortissements ${asset.name}`, debit: cumulated, credit: 0 }] : []),
        ...(vnc > 0 ? [{ accountCode: "812000", accountLabel: "Valeur comptable des cessions d'immobilisations", debit: vnc, credit: 0 }] : []),
        { accountCode: asset.accountCode || "24", accountLabel: asset.name, debit: 0, credit: asset.acquisitionCost },
        ...(price > 0 ? [
          { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: price, credit: 0 },
          { accountCode: "822000", accountLabel: "Produits des cessions d'immobilisations", debit: 0, credit: price },
        ] : []),
      ];
      await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: `CESS-${asset.code}`,
        label: `${reason === "sale" ? "Cession" : "Sortie"} de l'immobilisation ${asset.name}`, lines,
        linkedDocType: "fixed_asset", linkedDocId: asset._id, createdBy: auth.userId,
      }], { session });
      if (price > 0 && body.treasuryAccountId) {
        await recordMovement({ tenantId: auth.tenantId, accountId: String(body.treasuryAccountId), date, amount: price, label: `Cession ${asset.name}`, source: "manual", linkedDocType: "manual", createdBy: auth.userId }, session);
      }
      asset.set({ status: "disposed", disposalDate: date, disposalValue: price, disposalReason: reason, currentNetValue: 0 });
      await asset.save({ session });
    });
    await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "disposed", price, vnc } });
    return ok({ message: `Immobilisation sortie de l'actif (VNC ${vnc.toLocaleString("fr-FR")} XOF, prix ${price.toLocaleString("fr-FR")} XOF)` });
  }

  // Fiche : descriptif seulement — valeur, durée et plan d'amortissement ne se
  // réécrivent pas (ils ont déjà produit des écritures).
  const EDITABLE = ["name", "description", "location", "serialNumber", "supplier", "invoiceRef", "notes"];
  const set = Object.fromEntries(Object.entries(sanitizeBody(body)).filter(([k]) => EDITABLE.includes(k)));
  const updated = await FixedAssetModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true });
  if (!updated) return notFound();
  await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: set });
  return ok(updated);
});
