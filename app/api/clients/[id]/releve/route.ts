import { NextRequest } from "next/server";
import { withAuth, forbidden, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { TenantModel } from "@/models/Tenant";
import { clientStatementData } from "@/lib/statement-server";
import {
  buildStatement, withOpenItems, summarySentence,
} from "@/lib/statement";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

export const dynamic = "force-dynamic";



/**
 * GET /api/clients/:id/releve?from=…&to=…
 *
 * Le relevé de compte d'un client sur une période.
 *
 * Deux points sur lesquels ce genre de document se trompe habituellement :
 *
 * 1. **Le solde d'ouverture se calcule sur tout l'antérieur**, pas sur la
 *    période affichée. Un relevé d'octobre qui commence à zéro nie ce que le
 *    client devait déjà en septembre, et se fait renvoyer.
 * 2. **Les avoirs se retranchent.** Ils vivent dans la même collection que les
 *    factures, avec des montants positifs : sans le signe, un avoir gonfle la
 *    créance qu'il devait réduire.
 */
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  // Relevé de compte = factures et règlements : réservé à qui lit les factures.
  if (!authCan(auth, "invoices", "read")) return forbidden("Relevé réservé à la comptabilité et au gérant.");
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("name code email phone address nif paymentTermDays")
    .lean<{ name: string; code?: string; email?: string; phone?: string;
            address?: string; nif?: string; paymentTermDays?: number } | null>();
  if (!client) return notFound("Client introuvable");

  const url = new URL(req.url);
  const now = new Date();
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : new Date(now.getFullYear(), 0, 1);
  const to = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return badRequest("Période invalide.");
  }
  if (from > to) return badRequest("La date de début est postérieure à la date de fin.");

  const [{ sources, openItems }, tenant] = await Promise.all([
    clientStatementData(tenantFilter(auth).tenantId, String(params.id), to),
    TenantModel.findById(auth.tenantId).select("name address phone email nif rccm").lean(),
  ]);

  // Solde d'ouverture : tous les mouvements strictement antérieurs à `from`.
  const openingBalance = sources
    .filter(s => new Date(s.date) < new Date(from.getFullYear(), from.getMonth(), from.getDate()))
    .reduce((sum, s) => sum + s.amount, 0);

  const statement = withOpenItems(
    buildStatement(sources, openingBalance, from, to),
    openItems,
    to
  );

  return ok({
    client,
    tenant,
    statement,
    summary: summarySentence(statement.totals),
  });
});
