import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { calculerRetenueDetaillee, RETENUES_DETAILLEES } from "@/lib/niger-fiscal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { Schema, model, models } from "mongoose";

// Modèle inline pour les retenues
const RetenueSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, required: true },
  beneficiaire: { type: String, required: true },
  nifBeneficiaire: String,
  montantBrut: { type: Number, required: true },
  taux: Number,
  montantRetenue: { type: Number, required: true },
  montantNet: Number,
  article: String,
  date: { type: Date, default: Date.now },
  reference: String,
  invoiceId: Schema.Types.ObjectId,
  marchéId: Schema.Types.ObjectId,
  isPaid: { type: Boolean, default: false },
  paidAt: Date,
  createdBy: Schema.Types.ObjectId,
}, { timestamps: true });

const RetenueModel = models.Retenue || model("Retenue", RetenueSchema);

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const annee = url.searchParams.get("annee");
  const mois = url.searchParams.get("mois");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (type) filter.type = type;
  if (annee) {
    const start = new Date(parseInt(annee), mois ? parseInt(mois) - 1 : 0, 1);
    const end = mois
      ? new Date(parseInt(annee), parseInt(mois), 0, 23, 59, 59)
      : new Date(parseInt(annee), 11, 31, 23, 59, 59);
    filter.date = { $gte: start, $lte: end };
  }

  const [items, total] = await Promise.all([
    RetenueModel.find(filter).sort({ date: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    RetenueModel.countDocuments(filter),
  ]);

  const totalRetenues = items.reduce((s, r) => s + r.montantRetenue, 0);
  const nonVersees = items.filter(r => !r.isPaid).reduce((s, r) => s + r.montantRetenue, 0);

  return ok({
    items,
    pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    totalRetenues, nonVersees,
    typesDisponibles: Object.entries(RETENUES_DETAILLEES).map(([k, v]) => ({ key: k, ...v })),
  });
});

export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["type", "beneficiaire", "montantBrut"]);
  if (err) return badRequest(err);

  if (!RETENUES_DETAILLEES[body.type]) return badRequest(`Type inconnu. Valeurs: ${Object.keys(RETENUES_DETAILLEES).join(", ")}`);

  const calcul = calculerRetenueDetaillee(body.montantBrut, body.type);

  const retenue = await RetenueModel.create({
    ...body,
    tenantId: auth.tenantId,
    taux: calcul.taux,
    montantRetenue: calcul.montantRetenue,
    montantNet: calcul.montantNet,
    article: calcul.article,
    createdBy: auth.userId,
  });

  // Écriture comptable automatique
  await AccountingEntryModel.create({
    tenantId: auth.tenantId, journalCode: "OD",
    entryDate: new Date(),
    reference: `RTS-${retenue._id.toString().slice(-6).toUpperCase()}`,
    label: `Retenue à la source — ${body.beneficiaire} (${RETENUES_DETAILLEES[body.type].description})`,
    lines: [
      { accountCode: "401000", accountLabel: "Fournisseurs / Tiers", debit: body.montantBrut, credit: 0 },
      { accountCode: "4471000", accountLabel: "Retenues à la source DGI", debit: 0, credit: calcul.montantRetenue },
      { accountCode: "521000", accountLabel: "Banque / Trésorerie", debit: 0, credit: calcul.montantNet },
    ],
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "retenues", { resourceId: retenue._id.toString(), after: { type: body.type, montantRetenue: calcul.montantRetenue } });
  return created(retenue);
});
