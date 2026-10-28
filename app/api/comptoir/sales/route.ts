import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { createSale, hideCosts } from "@/lib/comptoir-sale";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { hasFinanceAccess } from "@/lib/role-resources";
import { parsePeriod, periodMatch } from "@/lib/flow-filter";
import { notifyRoles } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Tickets d'un comptoir (période `from` / `to`). Coûts et marges : rôles financiers seulement. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const sales = await ComptoirSaleModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), ...periodMatch("date", parsePeriod(url)) })
    .populate("cashierId", "firstName lastName")
    .sort({ date: -1, createdAt: -1 }).limit(300).lean<Array<Record<string, unknown>>>();
  return ok({ items: hasFinanceAccess(auth) ? sales : sales.map(hideCosts), showCosts: hasFinanceAccess(auth) });
});

/** Nouveau ticket : lignes, paiements (un ou plusieurs moyens), client facultatif. */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const { sale, warnings } = await withTransaction(session => createSale(auth, body, session));
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(sale._id), metadata: { sale: sale.number, total: sale.totalTTC } });
  // Vente à perte : la direction et la comptabilité sont prévenues.
  const loss = (sale.lines as Array<{ label: string; marginHT: number | null }>).filter(l => l.marginHT !== null && l.marginHT < 0);
  if (loss.length) {
    await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta"], {
      type: "stock_alert", title: "Comptoir : vente sous le coût",
      message: `Ticket ${sale.number} : ${loss.map(l => l.label).join(", ")} vendu(s) sous le coût d'achat.`,
      linkedTo: "comptoir", linkedId: String(body.deskId),
    });
  }
  const out = sale.toObject();
  return created({ sale: hasFinanceAccess(auth) ? out : hideCosts(out), warnings: hasFinanceAccess(auth) ? warnings : warnings.filter(w => !/coût/.test(w)) });
});
