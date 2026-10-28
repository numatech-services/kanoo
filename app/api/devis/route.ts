import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { ClientModel } from "@/models/Client";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { nextDocumentNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { searchCondition, withSearch } from "@/lib/list-search";

export const GET = withAuth("devis", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // Raccourci « Voir les … » de la fiche client.
  const clientId = url.searchParams.get("clientId");
  if (clientId && Types.ObjectId.isValid(clientId)) filter.clientId = new Types.ObjectId(clientId);
  if (status) filter.status = status;
  withSearch(filter, await searchCondition(auth.tenantId, url.searchParams.get("search"), { fields: ["number", "lines.description"], client: "clientId" }));
  const [items, total] = await Promise.all([
    DevisModel.find(filter).populate("clientId", "name code").sort({ issueDate: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    DevisModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("devis", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["clientId", "lines", "issueDate", "validUntil"]);
  if (err) return badRequest(err);
  if (!Array.isArray(body.lines) || body.lines.length === 0) return badRequest("Au moins une ligne.");
  // Le client doit appartenir à l'organisation : sinon son nom et son NIF
  // (populate) s'affichaient, puis passaient sur la facture.
  if (!(await ClientModel.exists({ _id: body.clientId, ...tenantFilter(auth) }))) return badRequest("Client introuvable.");
  // Totaux : somme des lignes arrondies, pour que le pied corresponde à
  // l'addition des lignes imprimées.
  let totalHT = 0, totalTVA = 0;
  const lines = body.lines.map((l: { description: string; quantity: number; unitPrice: number; tvaRate?: number; discount?: number }) => {
    const lineHT = Math.round(l.quantity * l.unitPrice * (1 - (l.discount || 0) / 100));
    const lineTVA = calculerTVA(lineHT, l.tvaRate ?? TVA_TAUX_STANDARD);
    totalHT += lineHT; totalTVA += lineTVA;
    return { ...l, totalHT: lineHT, totalTVA: lineTVA, totalTTC: lineHT + lineTVA };
  });

  const devis = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(auth.tenantId, "quote", { issueDate: body.issueDate, session });
    const [doc] = await DevisModel.create([{
      // Liste blanche : la preuve d'acceptation en ligne et le lien vers un
      // marché sont posés par leurs routes, jamais par le formulaire.
      clientId: body.clientId, issueDate: body.issueDate, validUntil: body.validUntil,
      notes: body.notes === undefined ? undefined : String(body.notes ?? "").slice(0, 4000),
      lines, number, totalHT, totalTVA, totalTTC: totalHT + totalTVA,
      tenantId: auth.tenantId, createdBy: auth.userId,
    }], { session });
    return doc;
  });

  await logAudit(auth, "CREATE", "devis", { resourceId: devis._id.toString(), after: { number: devis.number } });
  return created(devis);
});
