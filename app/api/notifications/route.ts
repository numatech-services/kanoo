import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { NotificationModel } from "@/models/Notification";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("notifications", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";

  const filter: Record<string, unknown> = {
    ...tenantFilter(auth),
    userId: auth.userId,
  };
  if (unreadOnly) filter.read = false;

  const [items, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    NotificationModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});

// PATCH — Marquer tout comme lu
export const PATCH = withAuth("notifications", "update", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await NotificationModel.updateMany(
    { tenantId: auth.tenantId, userId: auth.userId, read: false },
    { $set: { read: true } }
  );
  return ok({ message: "Toutes les notifications marquées comme lues" });
});
