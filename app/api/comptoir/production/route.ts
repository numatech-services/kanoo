import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { productionPlan } from "@/lib/campus-server";
import { localDay } from "@/lib/comptoir-sale";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET ?deskId=&day= — plan de production d'un jour (demain par défaut) :
 * présence attendue par service d'après l'emploi du temps, quantités à
 * préparer, ingrédients à sortir et manques, aperçu de la semaine.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const raw = url.searchParams.get("day");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDay(new Date(Date.now() + 86_400_000));
  return ok(await productionPlan(auth.tenantId, deskId, day));
});
