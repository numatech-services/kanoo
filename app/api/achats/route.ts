import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, tenantFilter, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PurchaseModel } from "@/models/Purchase";
import { CommandeModel } from "@/models/Commande";
import { nextDocumentNumber } from "@/lib/numbering";
import { buildPurchaseLines, checkSupplier, validatePurchase, payPurchase, PurchaseError } from "@/lib/purchases";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/achats?status=&kind=&supplierId=&projectId=&from=&to=&q=&due=overdue
 * Factures fournisseurs et dépenses, avec totaux (engagé, payé, reste à payer).
 */
export const GET = withAuth("purchases", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const pagination = getPagination(req);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const status = url.searchParams.get("status");
  if (status === "unpaid") filter.status = { $in: ["validated", "partial"] };
  else if (status) filter.status = status;
  const kind = url.searchParams.get("kind");
  if (kind === "invoice" || kind === "cash") filter.kind = kind;
  for (const k of ["supplierId", "projectId"]) {
    const v = url.searchParams.get(k);
    if (v && Types.ObjectId.isValid(v)) filter[k === "projectId" ? "lines.projectId" : k] = new Types.ObjectId(v);
  }
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  if (from || to) filter.date = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59`) } : {}) };
  if (url.searchParams.get("due") === "overdue") { filter.status = { $in: ["validated", "partial"] }; filter.dueDate = { $lt: new Date() }; }
  const q = (url.searchParams.get("q") || "").trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ number: rx }, { supplierRef: rx }, { payee: rx }, { "lines.description": rx }];
  }

  const [items, total, sums] = await Promise.all([
    PurchaseModel.find(filter).sort({ date: -1, createdAt: -1 }).skip(pagination.skip).limit(pagination.limit)
      .populate("supplierId", "name code").lean(),
    PurchaseModel.countDocuments(filter),
    PurchaseModel.aggregate([
      { $match: { ...filter, status: { $ne: "cancelled" } } },
      { $group: { _id: null, totalTTC: { $sum: "$totalTTC" }, paid: { $sum: "$paidAmount" } } },
    ]),
  ]);
  const s = sums[0] ?? { totalTTC: 0, paid: 0 };
  return ok({
    items, pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    totals: { totalTTC: s.totalTTC, paid: s.paid, remaining: s.totalTTC - s.paid },
  });
});

/**
 * POST — création. `validate: true` passe l'écriture d'achat ; une dépense au
 * comptant (`kind: "cash"`) avec `payment` est validée ET réglée d'un coup.
 */
export const POST = withAuth("purchases", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    const kind = body.kind === "cash" ? "cash" : "invoice";
    const supplier = await checkSupplier(auth.tenantId, body.supplierId);
    if (!supplier && !String(body.payee ?? "").trim()) throw new PurchaseError("Indiquez le fournisseur ou le bénéficiaire.");
    const date = body.date ? new Date(body.date) : new Date();
    if (isNaN(date.getTime())) throw new PurchaseError("Date invalide.");
    const built = await buildPurchaseLines(auth.tenantId, body.lines, body);
    let sourceDesk: unknown;
    let commandeId: unknown;
    if (body.commandeId) {
      const cmd = await CommandeModel.findOne({ _id: body.commandeId, ...tenantFilter(auth) }).select("_id purchaseId supplierId sourceDeskId").lean<{ _id: unknown; purchaseId?: unknown; sourceDeskId?: unknown; supplierId: unknown } | null>();
      if (!cmd) throw new PurchaseError("Bon de commande introuvable.");
      if (cmd.purchaseId) throw new PurchaseError("Ce bon de commande a déjà sa facture fournisseur.");
      commandeId = cmd._id;
      sourceDesk = cmd.sourceDeskId;
    }

    const purchase = await withTransaction(async session => {
      const number = await nextDocumentNumber(auth.tenantId, "purchase", { issueDate: date, session });
      const [p] = await PurchaseModel.create([{
        tenantId: auth.tenantId, number, kind,
        supplierId: supplier?._id, payee: supplier ? supplier.name : String(body.payee).trim().slice(0, 160),
        supplierRef: body.supplierRef ? String(body.supplierRef).slice(0, 80) : undefined,
        date, dueDate: body.dueDate ? new Date(body.dueDate) : kind === "cash" ? date : undefined,
        commandeId, ...(sourceDesk ? { deskId: sourceDesk } : {}), ...built, notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
        status: "draft", createdBy: auth.userId,
      }], { session });
      if (commandeId) await CommandeModel.updateOne({ _id: commandeId }, { $set: { purchaseId: p._id } }, { session });
      if (body.validate || (kind === "cash" && body.payment)) await validatePurchase(auth, p, session, { force: body.force === true });
      if (kind === "cash" && body.payment) await payPurchase(auth, p, { ...body.payment, date: body.payment.date ?? date }, session);
      return p;
    });
    await logAudit(auth, "CREATE", "purchases", { resourceId: String(purchase._id), after: { number: purchase.number, totalTTC: purchase.totalTTC, status: purchase.status } });
    return created(purchase);
  } catch (e) {
    if (e instanceof PurchaseError) return badRequest(e.message);
    throw e;
  }
});
