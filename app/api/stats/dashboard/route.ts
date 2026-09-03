import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { MemberModel } from "@/models/Member";
import { MembershipModel } from "@/models/Membership";
import { DonationModel } from "@/models/Donation";
import { ProjectModel } from "@/models/Project";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/dashboard — indicateurs du tableau de bord associatif.
 *
 * Cette route **n'existait pas**. Le tableau de bord des associations
 * l'appelait pourtant depuis l'origine : chaque appel tombait en 404, la page
 * avalait l'erreur dans son `catch`, et affichait des zéros partout. Une
 * association voyait donc « 0 adhérent, 0 cotisation » quels que soient ses
 * effectifs réels.
 *
 * Les sommes passent par `aggregate` avec le `tenantFilter` corrigé (ObjectId)
 * — sans quoi elles renverraient elles aussi zéro, en silence.
 */
export const GET = withAuth("notifications", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();

  const tf = tenantFilter(auth);
  const year = new Date().getFullYear();

  const [activeMembers, contributions, donations, activeProjects, paidThisYear] = await Promise.all([
    MemberModel.countDocuments({ ...tf, status: "active" }),

    // Cotisations encaissées cette année : on ne somme que celles réellement
    // réglées (paidAt renseigné). Une cotisation due mais impayée gonflerait
    // le collecté d'un argent qui n'est pas rentré.
    MembershipModel.aggregate([
      { $match: { ...tf, year, paidAt: { $ne: null } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),

    DonationModel.aggregate([
      { $match: { ...tf, date: { $gte: new Date(year, 0, 1) } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),

    ProjectModel.countDocuments({ ...tf, status: { $in: ["todo", "in_progress", "blocked"] } }),

    MembershipModel.countDocuments({ ...tf, year, paidAt: { $ne: null } }),
  ]);

  // En attente = membres actifs qui n'ont pas de cotisation réglée cette année.
  // Jamais négatif : un membre peut régler plusieurs années d'un coup.
  const pendingContributionsCount = Math.max(0, activeMembers - paidThisYear);

  return ok({
    activeMembers,
    totalContributions: contributions[0]?.total || 0,
    totalDonations: donations[0]?.total || 0,
    activeProjects,
    pendingContributionsCount,
  });
});
