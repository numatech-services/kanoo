import { NextRequest } from "next/server";
import { parseKeyDates, checkOwner } from "@/lib/appel-dates";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/appels?status= — liste (sans les documents joints, lourds). */
export const GET = withAuth("appels", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  // Le tableau de bord des offres (étapes, taux de réussite) lit toute la liste : jusqu'à 1 000 appels.
  const pagination = getPagination(req);
  const wanted = Number(url.searchParams.get("limit"));
  if (Number.isInteger(wanted) && wanted > pagination.limit) { pagination.limit = Math.min(wanted, 1000); pagination.skip = (pagination.page - 1) * pagination.limit; }
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    AppelCandidatureModel.find(filter).select("-documents").sort({ submissionDeadline: 1, createdAt: -1 })
      .populate("ownerId", "firstName lastName")
      .skip(pagination.skip).limit(pagination.limit).lean(),
    AppelCandidatureModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

/** POST /api/appels — créer un appel. */
export const POST = withAuth("appels", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return badRequest("L'intitulé de l'appel est obligatoire.");

  const keyDates = parseKeyDates(body);
  if ("error" in keyDates) return badRequest(keyDates.error);
  const owner = await checkOwner(auth.tenantId, body.ownerId);
  if (owner === false) return badRequest("Responsable introuvable dans l'organisation.");

  const appel = await AppelCandidatureModel.create({
    ...keyDates.dates,
    ...(owner ? { ownerId: owner } : {}),
    stageChangedAt: new Date(),
    tenantId: auth.tenantId,
    title: title.slice(0, 250),
    organism: String(body.organism || "").slice(0, 200),
    reference: String(body.reference || "").slice(0, 100),
    submissionDeadline: body.submissionDeadline ? new Date(body.submissionDeadline) : undefined,
    estimatedAmount: Math.max(0, Number(body.estimatedAmount) || 0),
    requiredDocuments: Array.isArray(body.requiredDocuments)
      ? body.requiredDocuments.filter((d: unknown) => typeof d === "string" && d).slice(0, 50).map((label: string) => ({ label: label.slice(0, 200), provided: false }))
      : [],
    notes: String(body.notes || "").slice(0, 4000),
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "appels", { resourceId: appel._id.toString(), metadata: { title } });
  return created(appel);
});
