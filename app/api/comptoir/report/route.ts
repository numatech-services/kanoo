import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, badRequest, notFound, tenantFilter, forbidden } from "@/lib/api-helpers";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { TenantModel } from "@/models/Tenant";
import { isId, ownDesk } from "@/lib/comptoir";
import { syncLinkedItems } from "@/lib/comptoir-stock";
import { generateDeskReportPdf, type DeskReportForPdf, type TenantIdentity } from "@/lib/pdf-document";
import { TokenPayload } from "@/lib/auth";
import { parseFlow } from "@/lib/flow-filter";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";

export const dynamic = "force-dynamic";

/**
 * GET /api/comptoir/report?deskId=&from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Rapport PDF du comptoir (caisse de la période + état du stock), à la marque
 * de l'organisation. Sans période : le mois en cours.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  // Pas d'export ni d'envoi vers l'extérieur pour un stagiaire.
  if (isInternFor(auth, "comptoir")) return forbidden(INTERN_EXPORT_MESSAGE);
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  const desk = await ownDesk(auth, deskId);
  if (!desk) return notFound("Comptoir introuvable");

  // Bornes de période (jour de fin inclus). Par défaut : mois en cours.
  const now = new Date();
  const parse = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);
  const from = parse(url.searchParams.get("from")) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const toDay = parse(url.searchParams.get("to")) ?? now;
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);
  if (from >= to) return badRequest("Période invalide");

  await syncLinkedItems(auth.tenantId, deskId);
  const [cash, items, tenant] = await Promise.all([
    ActivityCashEntryModel.find({ ...tenantFilter(auth), deskId, date: { $gte: from, $lt: to } })
      .sort({ date: 1, createdAt: 1 }).limit(2000)
      .lean<DeskReportForPdf["cash"]>(),
    ActivityItemModel.find({ ...tenantFilter(auth), deskId, archived: { $ne: true } })
      .sort({ name: 1 }).lean<DeskReportForPdf["items"]>(),
    TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean<TenantIdentity | null>(),
  ]);

  const periodLabel = `${from.toLocaleDateString("fr-FR")} au ${toDay.toLocaleDateString("fr-FR")}`;
  const journalFlow = parseFlow(url.searchParams.get("flow")) ?? undefined;
  const buf = await generateDeskReportPdf({ deskName: desk.name, periodLabel, cash, items, journalFlow }, tenant ?? { name: "Organisation" });

  const safe = desk.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "comptoir";
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="rapport-${safe}.pdf"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
});
