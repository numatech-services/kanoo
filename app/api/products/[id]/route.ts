import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("products", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const p = await ProductModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!p) return notFound(); return ok(p);
});
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const p = await ProductModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!p) return notFound(); return ok(p);
});
export const DELETE = withAuth("products", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const p = await ProductModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  if (!p) return notFound(); return noContent();
});
