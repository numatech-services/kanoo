import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ErrorEventModel } from "@/models/ErrorEvent";

export const dynamic = "force-dynamic";

/** GET ?days=7&source=api|render|client|csp&resolved=1 — erreurs regroupées, les plus récentes d'abord. */
export const GET = withAuth("companies", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden("Réservé au super-administrateur.");
  await connectDB();
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const source = url.searchParams.get("source");
  const filter: Record<string, unknown> = { lastAt: { $gte: new Date(Date.now() - days * 86_400_000) } };
  if (source && ["api", "render", "client", "csp"].includes(source)) filter.source = source;
  if (url.searchParams.get("resolved") !== "1") filter.resolvedAt = { $exists: false };
  const [items, totals] = await Promise.all([
    ErrorEventModel.find(filter).sort({ lastAt: -1 }).limit(200).lean(),
    ErrorEventModel.aggregate<{ _id: string; groups: number; occurrences: number }>([
      { $match: { lastAt: filter.lastAt, resolvedAt: { $exists: false } } },
      { $group: { _id: "$source", groups: { $sum: 1 }, occurrences: { $sum: "$count" } } },
    ]),
  ]);
  return ok({ items, totals, days });
});

/** PATCH { id, resolved } — marque une erreur résolue (une nouvelle occurrence la rouvrira). */
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden("Réservé au super-administrateur.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!Types.ObjectId.isValid(String(body.id))) return badRequest("Identifiant invalide.");
  await ErrorEventModel.updateOne({ _id: body.id }, body.resolved === false ? { $unset: { resolvedAt: "" } } : { $set: { resolvedAt: new Date() } });
  return ok({ id: body.id });
});
