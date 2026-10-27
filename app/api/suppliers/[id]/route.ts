import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { SupplierModel, SUPPLIER_PROTECTED } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("suppliers", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const s = await SupplierModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!s) return notFound();
  return ok(s);
});
export const PATCH = withAuth("suppliers", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const update = sanitizeBody(body, ["code", ...SUPPLIER_PROTECTED]);
  const before = await SupplierModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("bankName bankAccount").lean<{ bankName?: string; bankAccount?: string } | null>();
  if (!before) return notFound();
  const s = await SupplierModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, update, { new: true, runValidators: true });
  if (!s) return notFound();
  // Changement de coordonnées bancaires : tracé avant / après. C'est le
  // vecteur classique de la fraude au faux fournisseur (« notre RIB change »).
  const ribChanged = ("bankAccount" in update && (update.bankAccount ?? "") !== (before.bankAccount ?? ""))
    || ("bankName" in update && (update.bankName ?? "") !== (before.bankName ?? ""));
  await logAudit(auth, "UPDATE", "suppliers", {
    resourceId: params.id,
    ...(ribChanged ? {
      before: { bankName: before.bankName, bankAccount: before.bankAccount },
      after: { bankName: s.bankName, bankAccount: s.bankAccount },
      metadata: { ribChanged: true },
    } : {}),
  });
  return ok(s);
});
export const DELETE = withAuth("suppliers", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const s = await SupplierModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  if (!s) return notFound();
  await logAudit(auth, "DELETE", "suppliers", { resourceId: params.id });
  return noContent();
});
