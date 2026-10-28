import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { DeskCustomerModel } from "@/models/DeskCustomer";
import { creditAllowance } from "@/lib/spot";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** GET ?deskId= — clients à l'ardoise : dû, plafond, reste autorisé, ancienneté de la dette. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const rows = await DeskCustomerModel.find({ ...tenantFilter(auth), deskId: new Types.ObjectId(deskId) }).sort({ balance: -1, name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string; phone?: string; creditLimit: number; balance: number; oldestDebtAt?: Date; active: boolean }>>();
  const items = rows.map(c => ({ ...c, ...creditAllowance(c.balance, c.creditLimit), debtDays: c.balance > 0 && c.oldestDebtAt ? Math.floor((Date.now() - new Date(c.oldestDebtAt).getTime()) / DAY) : 0 }));
  return ok({ items, totalDue: items.reduce((t, c) => t + Math.max(0, c.balance), 0) });
});

/** POST { deskId, name, phone?, creditLimit } — nouveau client à l'ardoise. */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return badRequest("Nom du client obligatoire.");
  const limit = Math.round(Number(body.creditLimit ?? 0));
  if (!(limit >= 0)) return badRequest("Plafond invalide.");
  const c = await DeskCustomerModel.create({ tenantId: auth.tenantId, deskId: body.deskId, name, phone: body.phone ? String(body.phone).slice(0, 30) : undefined, creditLimit: limit, notes: body.notes ? String(body.notes).slice(0, 300) : undefined, createdBy: auth.userId });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: String(c._id), metadata: { deskCustomer: name, limit } });
  return created(c);
});
