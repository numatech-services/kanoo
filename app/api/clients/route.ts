import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, conflict, paginatedResponse, getPagination, tenantFilter, requireFields, escapeRegex } from "@/lib/api-helpers";
import { ClientModel, CLIENT_PROTECTED } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

// GET /api/clients — Liste paginée avec recherche
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = escapeRegex(url.searchParams.get("search"));
  const isActive = url.searchParams.get("isActive");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
      { nif: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (isActive !== null) filter.isActive = isActive === "true";

  // Mode sélecteur (listes déroulantes des formulaires) : tous les clients,
  // champs utiles seulement. La pagination plafonne à 100 : le 101e client ne
  // pouvait pas être facturé.
  if (url.searchParams.get("picker") === "1") {
    const items = await ClientModel.find(filter).sort({ name: 1 }).limit(5000)
      .select("name code nif email phone address type buyerType isActive paymentTermDays").lean();
    return paginatedResponse(items, items.length, { page: 1, limit: items.length || 1, skip: 0 });
  }

  const [items, total] = await Promise.all([
    ClientModel.find(filter)
      .sort({ name: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean<Array<{ _id: unknown; currentBalance?: number }>>(),
    ClientModel.countDocuments(filter),
  ]);

  // Le solde est **calculé**, pas stocké.
  //
  // `currentBalance` était mis à zéro à la création, protégé en écriture, et
  // incrémenté par aucune route : la colonne « Solde » affichait zéro pour
  // tout le monde, y compris pour un client devant plusieurs millions.
  //
  // Restant dû = TTC − règlements − avoirs. Omettre les avoirs gonflerait la
  // créance d'un montant déjà crédité au client.
  // Solde : information financière, réservée à qui lit les factures.
  if (!authCan(auth, "invoices", "read")) {
    return paginatedResponse(items.map(({ currentBalance: _hidden, ...c }) => c), total, pagination);
  }
  const ids = items.map(c => c._id);
  const balances = await InvoiceModel.aggregate<{ _id: unknown; due: number }>([
    { $match: {
      ...tenantFilter(auth),
      clientId: { $in: ids },
      documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial", "overdue"] },
    } },
    { $group: {
      _id: "$clientId",
      due: { $sum: { $subtract: [
        "$totalTTC",
        { $add: ["$paidAmount", { $ifNull: ["$creditedAmount", 0] }] },
      ] } },
    } },
  ]);
  const dueBy = new Map(balances.map(b => [String(b._id), Math.max(0, b.due)]));

  return paginatedResponse(
    items.map(c => ({ ...c, currentBalance: dueBy.get(String(c._id)) ?? 0 })),
    total, pagination
  );
});

// POST /api/clients — Créer un client
export const POST = withAuth("clients", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["name", "code"]);
  if (missing) return badRequest(missing);

  await connectDB();

  // Unicité du code dans le tenant
  const existing = await ClientModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Un client avec le code '${body.code}' existe déjà`);

  for (const k of CLIENT_PROTECTED) delete body[k];
  const client = await ClientModel.create({
    ...body,
    tenantId: auth.tenantId,
    currentBalance: 0,
  });

  await logAudit(auth, "CREATE", "clients", {
    resourceId: client._id.toString(),
    after: { name: client.name, code: client.code },
  });

  return created(client);
});
