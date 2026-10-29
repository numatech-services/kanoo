import { NextRequest } from "next/server";
import { withAuth, getPagination, paginatedResponse, tenantFilter, ok } from "@/lib/api-helpers";
import { AttachmentModel } from "@/models/Attachment";
import { ProjectModel } from "@/models/Project";
import { authCan } from "@/lib/role-resources";
import { projectScope } from "@/lib/project-scope";
import { scopeEmployees } from "@/lib/leave-scope";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Documents porteurs dont l'accès suit le seul droit de lecture de la ressource. */
const PLAIN_HOSTS = [
  "contracts", "subscriptions", "invoices", "devis", "commandes", "marches", "employees",
  "clients", "suppliers", "payslips", "treasuryAccounts", "documents", "purchases", "accountingEntries",
];

/**
 * GET /api/documents — la GED : toutes les pièces jointes de l'organisation que
 * l'utilisateur a le droit de voir, quel que soit le document porteur.
 *
 * Mêmes règles que /api/attachments (lib/attachment-access.ts), appliquées en
 * filtre plutôt que pièce par pièce : droit « documents » + droit de lecture du
 * porteur ; notes de frais et congés, documents personnels, seulement pour qui
 * les voit tous ; projets, seulement ceux du périmètre de l'utilisateur.
 *
 * Paramètres : q (nom du fichier), host, category, from, to (AAAA-MM-JJ).
 */
export const GET = withAuth("documents", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);

  const visible: Array<Record<string, unknown>> = [];
  const plain = PLAIN_HOSTS.filter(h => authCan(auth, h, "read"));
  if (plain.length) visible.push({ host: { $in: plain } });
  if (authCan(auth, "expenses", "update")) visible.push({ host: "expenses" });
  if ((await scopeEmployees(auth)) === null && authCan(auth, "leaves", "read")) visible.push({ host: "leaves" });
  if (authCan(auth, "projects", "read")) {
    const ids = await ProjectModel.find({ ...tenantFilter(auth), ...projectScope(auth) }).distinct("_id");
    if (ids.length) visible.push({ host: "projects", hostId: { $in: ids } });
  }
  if (visible.length === 0) {
    return url.searchParams.get("stats") === "1" ? ok({ total: 0, size: 0, thisMonth: 0, byCategory: {} }) : paginatedResponse([], 0, pagination);
  }

  const filter: Record<string, unknown> = { ...tenantFilter(auth), $or: visible };
  // ?stats=1 : la synthèse de la GED visible (indicateurs et onglets par nature), sans les filtres de recherche.
  if (url.searchParams.get("stats") === "1") {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [agg] = await AttachmentModel.aggregate<{ all: Array<{ n: number; size: number }>; month: Array<{ n: number }>; cats: Array<{ _id: string | null; n: number }> }>([
      { $match: filter },
      { $facet: {
        all: [{ $group: { _id: null, n: { $sum: 1 }, size: { $sum: { $ifNull: ["$size", 0] } } } }],
        month: [{ $match: { createdAt: { $gte: monthStart } } }, { $count: "n" }],
        cats: [{ $group: { _id: "$category", n: { $sum: 1 } } }],
      } },
    ]);
    return ok({
      total: agg?.all[0]?.n ?? 0, size: agg?.all[0]?.size ?? 0, thisMonth: agg?.month[0]?.n ?? 0,
      // Sans nature précisée : comptés avec « autre ».
      byCategory: (agg?.cats ?? []).reduce<Record<string, number>>((m, c) => { const k = c._id || "autre"; m[k] = (m[k] ?? 0) + c.n; return m; }, {}),
    });
  }
  const host = url.searchParams.get("host");
  if (host) filter.host = host;
  const category = url.searchParams.get("category");
  // « Autre » regroupe aussi les pièces sans nature précisée (comme la synthèse).
  if (category) filter.category = category === "autre" ? { $in: ["autre", null] } : category;
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$and = [{ $or: [{ filename: rx }, { label: rx }] }];
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from && !isNaN(Date.parse(from))) range.$gte = new Date(from);
    if (to && !isNaN(Date.parse(to))) range.$lte = new Date(`${to}T23:59:59.999Z`);
    if (Object.keys(range).length) filter.createdAt = range;
  }

  const [items, total] = await Promise.all([
    AttachmentModel.find(filter)
      .select("-storageKey -sha256")   // la clé de stockage ne sort jamais
      .sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit)
      .populate("uploadedBy", "firstName lastName")
      .lean(),
    AttachmentModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});
