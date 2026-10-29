import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Types } from "mongoose";
import { withAuth, created, badRequest, notFound, paginatedResponse, getPagination, tenantFilter, requireFields, escapeRegex } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { logAudit } from "@/lib/audit";
import { computeInvoiceLines } from "@/lib/invoice-entry";
import { pickImputation, checkImputations } from "@/lib/imputation";
import { provisionalNumber } from "@/lib/numbering";
import { withTransaction } from "@/lib/db";
import { TokenPayload } from "@/lib/auth";
import { searchCondition, withSearch } from "@/lib/list-search";
import { mentionsFrom } from "@/lib/doc-mentions";

// GET /api/invoices
export const GET = withAuth("invoices", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  const search = escapeRegex(url.searchParams.get("search"));
  const overdue = url.searchParams.get("overdue");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // « overdue » et « unpaid » sont des états calculés, pas des statuts stockés :
  // le statut littéral « overdue » n'est presque jamais posé, et le filtre
  // « En retard » ne renvoyait rien.
  if (status === "unpaid") {
    filter.status = { $in: ["sent", "partial", "overdue"] };
    filter.documentType = { $ne: "credit_note" };
  } else if (status && status !== "overdue") filter.status = status;
  if (clientId && Types.ObjectId.isValid(clientId)) filter.clientId = new Types.ObjectId(clientId);
  // Recherche exacte par numéro (?number=) : ignorée jusqu'ici, la liste
  // renvoyait la première facture venue.
  const number = url.searchParams.get("number");
  if (number) filter.number = { $regex: `^${number.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
  if (overdue === "true" || status === "overdue") {
    // Même définition que le badge de navigation (/api/nav-counters) : une
    // facture non soldée dont l'échéance est passée. Le statut littéral
    // « overdue » (posé par le traitement de nuit) était auparavant exclu, si
    // bien que le badge annonçait 5 impayés et la liste n'en montrait que 2.
    // On exclut aussi les avoirs, qui ne sont pas des créances.
    filter.status = { $in: ["sent", "partial", "overdue"] };
    filter.documentType = { $ne: "credit_note" };
    filter.dueDate = { $lt: new Date() };
  }
  // Numéro, libellés des lignes, nom ou code du client.
  if (search) withSearch(filter, await searchCondition(auth.tenantId, url.searchParams.get("search"), { fields: ["number", "lines.description"], client: "clientId" }));

  const [items, total] = await Promise.all([
    InvoiceModel.find(filter)
      .populate("clientId", "name code nif")
      .sort({ issueDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    InvoiceModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

// POST /api/invoices — Créer un brouillon (comptabilisé à l'émission)
export const POST = withAuth("invoices", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const missing = requireFields(body, ["clientId", "lines", "issueDate", "dueDate"]);
  if (missing) return badRequest(missing);
  if (!Array.isArray(body.lines) || body.lines.length === 0) return badRequest("Au moins une ligne.");

  await connectDB();

  const client = await ClientModel.findOne({ _id: body.clientId, tenantId: auth.tenantId });
  if (!client) return notFound("Client introuvable");

  // Imputation analytique facultative (projet, secteur d'activité).
  const imp = pickImputation(body);
  const impErr = await checkImputations(auth.tenantId, [imp]);
  if (impErr) return badRequest(impErr);

  // Chaque ligne est arrondie au franc, et le total est la SOMME DES LIGNES
  // ARRONDIES — pas l'arrondi de la somme (lib/invoice-entry).
  const { lines, totalHT, totalTVA, totalDTS, totalTTC } = computeInvoiceLines(body.lines);

  const result = await withTransaction(async (session) => {
    // Brouillon : numéro provisoire. Le numéro définitif est tiré à
    // l'émission (lib/invoice-posting), dans la transaction de l'émission :
    // un brouillon supprimé ne laisse plus de trou dans la série.
    const number = provisionalNumber();

    // 1. Créer la facture
    const [invoice] = await InvoiceModel.create(
      [{
        // Liste blanche : le corps recopié laissait passer des champs internes
        // (secef → faux QR « vérifié », creditedAmount → facture soldée sans
        // paiement, kind: deposit → vente en 419, doubtfulAt, documentType,
        // contractId → contournement du plafond du marché…). Ces champs sont
        // posés par leurs routes dédiées (certification, avoir, marché).
        clientId: client._id, issueDate: body.issueDate, dueDate: body.dueDate,
        notes: body.notes === undefined ? undefined : String(body.notes ?? "").slice(0, 4000),
        termsAndConditions: body.termsAndConditions === undefined ? undefined : String(body.termsAndConditions ?? "").slice(0, 4000),
        ...mentionsFrom(body),
        lines, number, totalHT, totalTVA, totalDTS, totalTTC, projectId: imp.projectId, activityId: imp.activityId,
        paidAmount: 0, tenantId: auth.tenantId, createdBy: auth.userId, status: "draft",
      }],
      { session }
    );

    // Pas d'écriture au brouillon : la facture est comptabilisée à son
    // émission (lib/invoice-posting).
    return invoice;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: result._id.toString(),
    after: { number: result.number, totalTTC: result.totalTTC, clientId: body.clientId },
  });

  return created(result);
});
