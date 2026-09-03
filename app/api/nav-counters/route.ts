import { NextRequest } from "next/server";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { NotificationModel } from "@/models/Notification";
import { ProductModel } from "@/models/Product";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/nav-counters
 *
 * Les compteurs affichés dans la navigation.
 *
 * Un menu qui annonce « 7 » en face de « Factures » économise le clic qui
 * servait à découvrir qu'il n'y avait rien à faire. Trois règles :
 *
 * 1. **Seulement ce qui appelle une action.** Le nombre total de factures
 *    n'apprend rien ; le nombre de factures en retard, si.
 * 2. **Aucun zéro affiché.** Une pastille « 0 » attire l'œil pour dire qu'il
 *    n'y a rien — exactement l'inverse de ce qu'on attend d'elle.
 * 3. **Rien ne bloque l'écran.** Les compteurs sont un supplément : leur échec
 *    ne doit pas empêcher la navigation de s'afficher.
 */
export const GET = withAuth("notifications", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const tf = tenantFilter(auth);
  const now = new Date();

  const [overdue, unread, lowStock] = await Promise.all([
    InvoiceModel.countDocuments({
      ...tf, documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial", "overdue"] }, dueDate: { $lt: now },
    }),
    NotificationModel.countDocuments({ ...tf, userId: auth.userId, read: false }),
    ProductModel.countDocuments({
      ...tf, isActive: true, $expr: { $lte: ["$stockQty", "$stockMinAlert"] },
    }),
  ]);

  // Les entrées sans compteur sont omises plutôt que renvoyées à zéro : c'est
  // au serveur de décider ce qui mérite une pastille, pas à l'affichage de
  // filtrer après coup.
  const counters: Record<string, number> = {};
  if (overdue > 0) counters["/invoices"] = overdue;
  if (overdue > 0) counters["/relances"] = overdue;
  if (unread > 0) counters["/notifications"] = unread;
  if (lowStock > 0) counters["/stock"] = lowStock;

  return ok(counters);
});
