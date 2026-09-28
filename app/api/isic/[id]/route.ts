import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel } from "@/models/IsicBatch";
import { hasIsicFinance, stripIsicFinance, ISIC_FINANCE_FIELDS } from "@/lib/isic";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUS = ["received", "processing", "submitted", "numbered", "printing", "printed", "delivering", "completed", "cancelled"];
const SCALARS = ["universityName", "academicYear", "totalCards", "unitLicenseFee", "unitSalePrice", "notes", "receivedFile", "isicFile"];

export const GET = withAuth("isic", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("universityId", "name code").lean();
  if (!item) return notFound("Lot ISIC introuvable");
  return ok(hasIsicFinance(auth) ? item : stripIsicFinance(item));
});

export const PATCH = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const existing = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!existing) return notFound("Lot ISIC introuvable");

  const finance = hasIsicFinance(auth);
  const set: Record<string, unknown> = {};
  for (const f of SCALARS) {
    if (!(f in body)) continue;
    // Les montants ne sont modifiables que par un rôle financier.
    if ((ISIC_FINANCE_FIELDS as readonly string[]).includes(f) && !finance) continue;
    set[f] = body[f];
  }
  if ("universityId" in body) {
    set.universityId = body.universityId && Types.ObjectId.isValid(String(body.universityId)) ? body.universityId : undefined;
  }
  if ("invoiceId" in body) {
    set.invoiceId = body.invoiceId && Types.ObjectId.isValid(String(body.invoiceId)) ? body.invoiceId : undefined;
  }
  if (body.status !== undefined) {
    if (!STATUS.includes(body.status)) return badRequest("Statut invalide.");
    set.status = body.status;
    // Horodatage automatique des étapes clés.
    if (body.status === "submitted" && !existing.submittedAt) set.submittedAt = new Date();
    if (body.status === "numbered" && !existing.numberedAt) set.numberedAt = new Date();
  }

  const item = await IsicBatchModel.findByIdAndUpdate(params.id, { $set: set }, { new: true, runValidators: true }).lean();
  await logAudit(auth, "UPDATE", "isic", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("isic", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const res = await IsicBatchModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  if (!res.deletedCount) return notFound("Lot ISIC introuvable");
  await logAudit(auth, "DELETE", "isic", { resourceId: String(params.id) });
  return noContent();
});
