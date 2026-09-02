import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { calculerAmortissementLineaire, AMORTISSEMENT_TAUX } from "@/lib/niger-fiscal";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fixedAssets", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status") || "active";

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (category) filter.category = category;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    FixedAssetModel.find(filter).sort({ acquisitionDate: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    FixedAssetModel.countDocuments(filter),
  ]);

  // Calcul des totaux
  const totalAcquisition = items.reduce((s, a) => s + a.acquisitionCost, 0);
  const currentYear = new Date().getFullYear();
  const totalDotation = items.reduce((s, a) => {
    const entry = (a.depreciationSchedule || []).find((e: {year: number}) => e.year === currentYear);
    return s + (entry?.annuity || 0);
  }, 0);

  return paginatedResponse(items, total, pagination, { totalAcquisition, totalDotation });
});

export const POST = withAuth("fixedAssets", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["code", "name", "category", "acquisitionDate", "acquisitionCost"]);
  if (err) return badRequest(err);

  const existing = await FixedAssetModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);

  // Utiliser les taux par défaut si non fournis
  const catInfo = AMORTISSEMENT_TAUX[body.category] || AMORTISSEMENT_TAUX.other;
  const usefulLife = body.usefulLifeYears || catInfo.duree || 5;
  const acquisitionYear = new Date(body.acquisitionDate).getFullYear();

  // Calculer le plan d'amortissement
  const schedule = calculerAmortissementLineaire(
    body.acquisitionCost,
    body.residualValue || 0,
    usefulLife,
    acquisitionYear
  );

  const asset = await FixedAssetModel.create({
    ...body,
    tenantId: auth.tenantId,
    usefulLifeYears: usefulLife,
    depreciationSchedule: schedule,
    currentNetValue: body.acquisitionCost, // VNC initiale = coût d'acquisition
    accountCode: body.accountCode || catInfo.compte,
    createdBy: auth.userId,
  });

  // Écriture comptable d'acquisition
  await AccountingEntryModel.create({
    tenantId: auth.tenantId,
    journalCode: "OD",
    entryDate: new Date(body.acquisitionDate),
    reference: body.code,
    label: `Acquisition ${body.name}`,
    lines: [
      { accountCode: catInfo.compte, accountLabel: body.name, debit: body.acquisitionCost, credit: 0 },
      { accountCode: "401000", accountLabel: "Fournisseur", debit: 0, credit: body.acquisitionCost },
    ],
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "fixedAssets", { resourceId: asset._id.toString(), after: { code: body.code, name: body.name, cost: body.acquisitionCost } });
  return created(asset);
});
