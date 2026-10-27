import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { allDesks } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { ProductModel } from "@/models/Product";
import { WarehouseModel } from "@/models/Warehouse";
import { ActivityModel } from "@/models/Activity";
import { defaultWarehouse } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET — ce dont le comptoir a besoin du catalogue, sans coûts d'achat (prix de vente seul, pour préremplir) :
 * articles stockables (pour relier un article du comptoir) et, pour qui peut
 * approvisionner (magasin ou chef The Spot), les entrepôts hors comptoirs.
 * Évite d'ouvrir tout le module Stock aux équipes du comptoir.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const search = (new URL(req.url).searchParams.get("search") || "").trim();
  const filter: Record<string, unknown> = { ...tenantFilter(auth), isActive: true, isService: { $ne: true } };
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ label: rx }, { code: rx }, { barcode: rx }];
  }
  const canSupply = authCan(auth, "products", "update") || allDesks(auth);
  const [products, warehouses] = await Promise.all([
    ProductModel.find(filter).select("code label unit unitPrice tvaRate trackingMode").sort({ label: 1 }).limit(500).lean(),
    canSupply
      ? defaultWarehouse(auth.tenantId).then(() => WarehouseModel.find({ ...tenantFilter(auth), isActive: true, kind: { $ne: "comptoir" } })
          .select("code name kind isDefault").sort({ isDefault: -1, name: 1 }).lean())
      : Promise.resolve([]),
  ]);
  // Secteurs analytiques (noms seulement) pour rattacher un comptoir : le chef
  // The Spot crée les comptoirs mais n'a pas accès à l'analytique.
  const sectors = allDesks(auth) ? await ActivityModel.find({ ...tenantFilter(auth) }).select("name").sort({ name: 1 }).lean() : [];
  return ok({ products, warehouses, canSupply, sectors });
});
