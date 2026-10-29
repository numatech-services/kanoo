import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { reorderPlan } from "@/lib/spot-server";
import { createReorderOrders } from "@/lib/comptoir-reorder";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?deskId= — réassort conseillé : ventes moyennes, jours de stock restants, quantité à commander (en paquets). */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const plan = await reorderPlan(auth.tenantId, deskId);
  if (canSeeDeskCosts(auth)) return ok(plan);
  return ok({ ...plan, totalCost: undefined, lines: plan.lines.map(l => ({ ...l, estimatedCost: undefined })), toOrder: plan.toOrder.map(l => ({ ...l, estimatedCost: undefined })) });
});

/**
 * POST { deskId, lines: [{ itemId, quantity }] } — transforme le réassort en
 * bons de commande brouillon, un par fournisseur habituel (articles du
 * catalogue). Les articles propres au comptoir forment la liste de courses.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (!authCan(auth, "commandes", "create")) return forbidden("Bons de commande réservés aux achats et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const wanted = (Array.isArray(body.lines) ? body.lines : []).filter((l: { itemId?: string; quantity?: number }) => isId(l.itemId) && Number(l.quantity) > 0);
  if (!wanted.length) return badRequest("Rien à commander.");
  const r = await createReorderOrders(auth, String(body.deskId), wanted.map((l: { itemId: string; quantity: number }) => ({ itemId: l.itemId, quantity: Number(l.quantity) })));
  if ("error" in r) return badRequest(r.error ?? "Bon de commande impossible.");
  const { orders, shopping, noSupplier } = r;
  return created({ orders, shopping, noSupplier });
});
