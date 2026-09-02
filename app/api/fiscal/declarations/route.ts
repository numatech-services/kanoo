import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const annee = url.searchParams.get("annee");
  const type = url.searchParams.get("type");
  const pagination = getPagination(req);

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (annee) filter["period.annee"] = parseInt(annee);
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    FiscalDeclarationModel.find(filter).sort({ "period.annee": -1, "period.mois": -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    FiscalDeclarationModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});
