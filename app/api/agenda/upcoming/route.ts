import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CalendarEventModel } from "@/models/CalendarEvent";
import { visibleFilter } from "@/lib/agenda";

export const dynamic = "force-dynamic";

/**
 * GET /api/agenda/upcoming?limit=5 — prochaines entrées visibles, pour l'aperçu
 * du tableau de bord. On inclut ce qui est en cours (débuté mais pas terminé).
 */
export const GET = withAuth("agenda", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const limit = Math.min(20, Math.max(1, parseInt(new URL(req.url).searchParams.get("limit") || "5", 10)));
  const now = new Date();

  const items = await CalendarEventModel.find({
    ...visibleFilter(auth),
    status: { $ne: "cancelled" },
    $and: [{ $or: [{ startAt: { $gte: now } }, { endAt: { $gte: now } }] }],
  })
    .sort({ startAt: 1 })
    .limit(limit)
    .populate("ownerId", "firstName lastName")
    .lean();

  return ok(items);
});
