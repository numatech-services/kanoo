import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel } from "@/models/IsicBatch";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/isic?status=&universityId= — liste des lots (sans les fichiers, lourds). */
export const GET = withAuth("isic", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const pagination = getPagination(req);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  const universityId = url.searchParams.get("universityId");
  if (status) filter.status = status;
  if (universityId) filter.universityId = universityId;

  const [items, total] = await Promise.all([
    IsicBatchModel.find(filter).select("-receivedFile -isicFile").sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit).lean(),
    IsicBatchModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

/** POST /api/isic — créer un lot. */
export const POST = withAuth("isic", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const universityName = String(body.universityName || "").trim();
  if (!universityName) return badRequest("Le nom de l'université est obligatoire.");

  const batch = await IsicBatchModel.create({
    tenantId: auth.tenantId,
    reference: `ISIC-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`,
    universityName,
    universityId: body.universityId && /^[0-9a-fA-F]{24}$/.test(body.universityId) ? body.universityId : undefined,
    academicYear: String(body.academicYear || "").slice(0, 20),
    totalCards: Math.max(0, Number(body.totalCards) || 0),
    unitLicenseFee: Math.max(0, Number(body.unitLicenseFee) || 0),
    unitSalePrice: Math.max(0, Number(body.unitSalePrice) || 0),
    notes: String(body.notes || "").slice(0, 4000),
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "isic", { resourceId: batch._id.toString(), metadata: { university: universityName } });
  return created(batch);
});
