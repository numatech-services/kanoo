import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { TokenPayload } from "@/lib/auth";

// GET /api/stock — État global du stock avec KPIs et alertes
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const alertOnly = url.searchParams.get("alertOnly") === "true";
  const search = url.searchParams.get("search") || "";

  // 1. Construction du filtre (Multi-locataire + Recherche + Alertes)
  const filter: Record<string, any> = { 
    ...tenantFilter(auth), 
    isActive: true 
  };

  if (alertOnly) {
    // Utilise $expr pour comparer deux champs du même document (stockQty <= stockMinAlert)
    filter.$expr = { $lte: ["$stockQty", "$stockMinAlert"] };
  }

  if (search) {
    filter.$or = [
      { label: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } }
    ];
  }

  // 2. Récupération des données et du total
  const [items, total] = await Promise.all([
    ProductModel.find(filter)
      .sort({ stockQty: 1 }) // Priorité aux stocks bas
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ProductModel.countDocuments(filter),
  ]);

  // 3. Calcul du nombre global de produits en alerte (indépendant des filtres de page)
  const alertCount = await ProductModel.countDocuments({
    ...tenantFilter(auth),
    isActive: true,
    $expr: { $lte: ["$stockQty", "$stockMinAlert"] },
  });

  // 4. Enrichissement des données (Calcul valeur et flag alerte)
  const enriched = items.map(p => ({
    ...p,
    isAlert: p.stockQty <= p.stockMinAlert,
    stockValue: (p.stockQty || 0) * (p.unitPrice || 0),
  }));

  // 5. Calcul de la valeur totale du stock (pour l'ensemble du catalogue)
  // Note: Pour une performance optimale sur de gros stocks, utilisez un .aggregate()
  const allProducts = await ProductModel.find({ ...tenantFilter(auth), isActive: true }).select("stockQty unitPrice");
  const totalStockValue = allProducts.reduce((sum, p) => sum + ((p.stockQty || 0) * (p.unitPrice || 0)), 0);

  return ok({
    items: enriched,
    pagination: { 
      page: pagination.page, 
      limit: pagination.limit, 
      total, 
      totalPages: Math.ceil(total / pagination.limit) 
    },
    alertCount,
    totalStockValue,
  });
});