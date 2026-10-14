/**
 * Chiffres agrégés d'une organisation, pour l'assistant IA « rapport
 * d'activité ». On ne remonte que des **totaux** : aucun nom de client, de
 * fournisseur ou d'adhérent ne quitte la base. Ce sont ces agrégats — et eux
 * seuls — qui sont transmis au fournisseur d'IA à la génération.
 *
 * Chaque bloc est isolé : un modèle qui échoue n'empêche pas les autres
 * chiffres de remonter (`safe`). La période par défaut est l'année civile en
 * cours.
 */
import { Types } from "mongoose";
import { TokenPayload } from "./auth";
import { authCan } from "./role-resources";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { ClientModel } from "@/models/Client";
import { MemberModel } from "@/models/Member";
import { MembershipModel } from "@/models/Membership";
import { DonationModel } from "@/models/Donation";
import { ProjectModel } from "@/models/Project";
import { EmployeeModel } from "@/models/Employee";
import { PublicTenderModel } from "@/models/PublicTender";
import { LetterModel } from "@/models/Letter";

export interface ReportContext {
  period: string;
  stats: Record<string, string | number>;
}

function fmtCfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
}

async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch {
    return fallback;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sum(model: { aggregate: (p: any[]) => Promise<Array<{ total: number }>> }, match: Record<string, unknown>, field: string): Promise<number> {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: field } } }]);
  return rows[0]?.total || 0;
}

/**
 * Rassemble les indicateurs pertinents selon le type d'organisation. Le tenant
 * est un ObjectId (indispensable aux pipelines `aggregate`, cf. tenantFilter).
 */
export async function gatherReportContext(auth: TokenPayload): Promise<ReportContext> {
  const tenantId = new Types.ObjectId(auth.tenantId);
  const year = new Date().getFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const stats: Record<string, string | number> = {};

  // Commun à tous : effectif salarié.
  stats["Effectif (salariés)"] = await safe(
    () => EmployeeModel.countDocuments({ tenantId, status: { $ne: "terminated" } }),
    0
  );

  if (auth.tenantType === "association") {
    const [adherents, cotisations, dons, projets] = await Promise.all([
      safe(() => MemberModel.countDocuments({ tenantId, status: "active" }), 0),
      safe(() => sum(MembershipModel, { tenantId, year, paidAt: { $ne: null } }, "$amount"), 0),
      safe(() => sum(DonationModel, { tenantId, date: { $gte: yearStart, $lt: yearEnd } }, "$amount"), 0),
      safe(() => ProjectModel.countDocuments({ tenantId, status: { $in: ["todo", "in_progress", "blocked"] } }), 0),
    ]);
    stats["Adhérents actifs"] = adherents;
    // Montants : seulement pour qui a accès aux ressources correspondantes.
    if (authCan(auth, "cotisations", "read")) stats["Cotisations encaissées"] = fmtCfa(cotisations);
    if (authCan(auth, "dons", "read")) stats["Dons reçus"] = fmtCfa(dons);
    stats["Projets en cours"] = projets;
  } else {
    // PME et administration : activité commerciale / facturation.
    const salesMatch = { tenantId, documentType: { $ne: "credit_note" }, issueDate: { $gte: yearStart, $lt: yearEnd } };
    const [caFacture, encaisse, nbFactures, nbDevis, nbClients, impayes] = await Promise.all([
      safe(() => sum(InvoiceModel, salesMatch, "$totalTTC"), 0),
      safe(() => sum(InvoiceModel, salesMatch, "$paidAmount"), 0),
      safe(() => InvoiceModel.countDocuments(salesMatch), 0),
      safe(() => DevisModel.countDocuments({ tenantId, issueDate: { $gte: yearStart, $lt: yearEnd } }), 0),
      safe(() => ClientModel.countDocuments({ tenantId }), 0),
      safe(
        () =>
          InvoiceModel.aggregate([
            { $match: { tenantId, documentType: { $ne: "credit_note" }, status: { $in: ["sent", "partial", "overdue"] } } },
            { $group: { _id: null, total: { $sum: { $subtract: ["$totalTTC", { $ifNull: ["$paidAmount", 0] }] } } } },
          ]).then((r) => r[0]?.total || 0),
        0
      ),
    ]);
    // Chiffre d'affaires, encaissements, impayés : informations financières,
    // réservées au gérant et à la comptabilité — jamais injectées dans un
    // rapport rédigé par un autre service.
    if (authCan(auth, "invoices", "read")) {
      stats["Chiffre d'affaires facturé"] = fmtCfa(caFacture);
      stats["Encaissements"] = fmtCfa(encaisse);
      stats["Factures émises"] = nbFactures;
      }
    stats["Devis émis"] = nbDevis;
    stats["Clients au portefeuille"] = nbClients;
    stats["Encours impayé"] = fmtCfa(impayes);

    if (auth.tenantType === "administration") {
      stats["Appels d'offres publiés"] = await safe(
        () => PublicTenderModel.countDocuments({ tenantId, createdAt: { $gte: yearStart, $lt: yearEnd } }),
        0
      );
    }
  }

  // Commun : production de courriers/rapports de l'année.
  stats["Courriers et rapports produits"] = await safe(
    () => LetterModel.countDocuments({ tenantId, createdAt: { $gte: yearStart, $lt: yearEnd } }),
    0
  );

  return { period: `année ${year}`, stats };
}
