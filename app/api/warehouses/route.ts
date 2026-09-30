import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductStockModel } from "@/models/ProductStock";
import { ProductModel } from "@/models/Product";
import { defaultWarehouse } from "@/lib/stock";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const KINDS = ["main", "depot", "store", "comptoir", "vehicle", "other"];

/** GET ?all=true — entrepôts, avec nombre d'articles et valeur au coût. */
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await defaultWarehouse(auth.tenantId);
  const all = new URL(req.url).searchParams.get("all") === "true";
  const items = await WarehouseModel.find({ ...tenantFilter(auth), ...(all ? {} : { isActive: true }) }).sort({ isDefault: -1, kind: 1, name: 1 }).lean<Array<{ _id: Types.ObjectId }>>();
  const agg = await ProductStockModel.aggregate<{ _id: Types.ObjectId; articles: number; units: number; value: number }>([
    { $match: { ...tenantFilter(auth), qty: { $ne: 0 } } },
    { $lookup: { from: ProductModel.collection.name, localField: "productId", foreignField: "_id", as: "p" } },
    { $unwind: "$p" },
    { $group: { _id: "$warehouseId", articles: { $sum: 1 }, units: { $sum: "$qty" }, value: { $sum: { $multiply: ["$qty", { $ifNull: ["$p.purchaseCost", 0] }] } } } },
  ]);
  const by = new Map(agg.map(a => [String(a._id), a]));
  return ok(items.map(w => ({ ...w, articles: by.get(String(w._id))?.articles ?? 0, units: by.get(String(w._id))?.units ?? 0, value: by.get(String(w._id))?.value ?? 0 })));
});

/** POST — { code, name, kind, address?, isDefault? } */
export const POST = withAuth("products", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim().toUpperCase().slice(0, 20);
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!code || !name) return badRequest("Code et nom obligatoires.");
  const kind = KINDS.includes(body.kind) ? body.kind : "depot";
  if (kind === "comptoir") return badRequest("La réserve d'un comptoir se crée depuis le comptoir (The Spot).");
  if (await WarehouseModel.exists({ ...tenantFilter(auth), code })) return conflict(`Le code ${code} est déjà utilisé.`);
  if (body.isDefault) await WarehouseModel.updateMany({ ...tenantFilter(auth) }, { $set: { isDefault: false } });
  const w = await WarehouseModel.create({ tenantId: auth.tenantId, code, name, kind, address: body.address, notes: body.notes, isDefault: !!body.isDefault });
  await logAudit(auth, "CREATE", "products", { resourceId: String(w._id), metadata: { warehouse: code } });
  return created(w);
});
