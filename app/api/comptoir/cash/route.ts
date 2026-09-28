import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const METHODS = ["cash", "bank_transfer", "orange_money", "card", "check", "other"];

// Écritures de caisse d'un comptoir (comptabilité argent).
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!deskId) return badRequest("deskId requis");
  const entries = await ActivityCashEntryModel.find({ ...tenantFilter(auth), deskId })
    .sort({ date: -1, createdAt: -1 }).limit(300).lean();
  return ok(entries);
});

export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["deskId", "direction", "amount", "label"]);
  if (err) return badRequest(err);
  if (!["in", "out"].includes(body.direction)) return badRequest("Sens invalide");
  const amount = Number(body.amount);
  if (!(amount > 0)) return badRequest("Montant invalide");
  const entry = await ActivityCashEntryModel.create({
    tenantId: auth.tenantId,
    deskId: body.deskId,
    direction: body.direction,
    amount,
    label: String(body.label).slice(0, 200).trim(),
    method: METHODS.includes(body.method) ? body.method : "cash",
    date: body.date ? new Date(body.date) : new Date(),
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: entry._id.toString(), metadata: { cash: body.direction } });
  return created(entry);
});
