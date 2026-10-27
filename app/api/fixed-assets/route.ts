import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { PurchaseModel } from "@/models/Purchase";
import { SupplierModel } from "@/models/Supplier";
import { SUPPLIER_ACCOUNT } from "@/lib/purchases";
import { Types } from "mongoose";
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
  const acquisitionCost = Math.round(Number(body.acquisitionCost));
  if (!(acquisitionCost > 0)) return badRequest("Valeur d'acquisition invalide.");

  // L'origine décide de l'écriture d'entrée. Un bien acheté via Achats est déjà
  // en comptabilité (compte 2…) : l'écrire une seconde fois au registre le
  // comptait deux fois au bilan, contre un « fournisseur » sans nom.
  const origin = ["purchase", "existing"].includes(body.origin) ? body.origin : "supplier";
  let purchaseId: unknown, supplierId: unknown;
  if (origin === "purchase") {
    if (!Types.ObjectId.isValid(String(body.purchaseId))) return badRequest("Choisissez l'achat qui a acquis ce bien.");
    const p = await PurchaseModel.findOne({ _id: body.purchaseId, tenantId: auth.tenantId, status: { $in: ["validated", "partial", "paid"] } })
      .select("lines supplierId").lean<{ lines: Array<{ accountCode: string }>; supplierId?: unknown } | null>();
    if (!p) return badRequest("Achat introuvable ou non validé.");
    if (!p.lines.some(l => /^2/.test(l.accountCode))) return badRequest("Cet achat n'est imputé à aucun compte d'immobilisation (2…).");
    purchaseId = body.purchaseId; supplierId = p.supplierId;
  } else if (origin === "supplier" && body.supplierId) {
    if (!Types.ObjectId.isValid(String(body.supplierId)) || !(await SupplierModel.exists({ _id: body.supplierId, tenantId: auth.tenantId }))) {
      return badRequest("Fournisseur introuvable.");
    }
    supplierId = body.supplierId;
  }

  // Utiliser les taux par défaut si non fournis
  const catInfo = AMORTISSEMENT_TAUX[body.category] || AMORTISSEMENT_TAUX.other;
  const usefulLife = body.usefulLifeYears || catInfo.duree || 5;
  const acquisitionYear = new Date(body.acquisitionDate).getFullYear();

  // Calculer le plan d'amortissement
  // Le prorata court à compter de la mise en service ; à défaut, de la date
  // d'acquisition. Une annuité pleine la première année surévaluait la dotation.
  const serviceDate = new Date(body.serviceDate || body.acquisitionDate);
  const schedule = calculerAmortissementLineaire(
    acquisitionCost,
    body.residualValue || 0,
    usefulLife,
    acquisitionYear,
    serviceDate
  );

  // Fiche et écriture d'acquisition dans la MÊME transaction : si l'écriture
  // est refusée (période verrouillée…), la fiche n'est pas créée non plus.
  // Avant, elle restait sans écriture et son code était ensuite « déjà
  // utilisé ». Champs d'état (statut, sortie) jamais repris du formulaire.
  const { status: _s, disposalDate: _d, disposalPrice: _p, disposalReason: _r, currentNetValue: _v, depreciationSchedule: _sch, ...fields } = body as Record<string, unknown>;
  const asset = await withTransaction(async session => {
    const [a] = await FixedAssetModel.create([{
      ...fields,
      acquisitionCost, origin, purchaseId, supplierId,
      tenantId: auth.tenantId,
      usefulLifeYears: usefulLife,
      depreciationSchedule: schedule,
      currentNetValue: acquisitionCost, // VNC initiale = coût d'acquisition
      accountCode: body.accountCode || catInfo.compte,
      createdBy: auth.userId,
    }], { session });

    // Écriture d'acquisition : seulement pour une dette fournisseur, sur le
    // compte fournisseur commun (401100) et au nom du fournisseur s'il est connu.
    if (origin === "supplier") {
      await AccountingEntryModel.create([{
        tenantId: auth.tenantId,
        journalCode: "AC",
        entryDate: new Date(body.acquisitionDate),
        reference: body.code,
        label: `Acquisition ${body.name}`,
        lines: [
          { accountCode: a.accountCode, accountLabel: body.name, debit: acquisitionCost, credit: 0 },
          { ...SUPPLIER_ACCOUNT, debit: 0, credit: acquisitionCost, ...(supplierId ? { thirdPartyId: supplierId } : {}) },
        ],
        linkedDocType: "fixed_asset", linkedDocId: a._id,
        createdBy: auth.userId,
      }], { session });
    }
    return a;
  });

  await logAudit(auth, "CREATE", "fixedAssets", { resourceId: asset._id.toString(), after: { code: body.code, name: body.name, cost: body.acquisitionCost } });
  return created(asset);
});
