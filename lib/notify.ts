import { Types } from "mongoose";
import { NotificationModel } from "@/models/Notification";
import { UserModel } from "@/models/User";

type Id = Types.ObjectId | string;

/**
 * Notifie tous les utilisateurs actifs d'un tenant portant l'un des rôles
 * donnés. Best-effort : un échec n'interrompt jamais l'action métier appelante.
 */
export async function notifyRoles(
  tenantId: Id,
  roles: string[],
  payload: { type: string; title: string; message: string; linkedTo?: string; linkedId?: Id }
): Promise<void> {
  try {
    const users = await UserModel.find({
      tenantId,
      isActive: true,
      $or: [{ role: { $in: roles } }, { roles: { $in: roles } }],
    }).select("_id").lean<Array<{ _id: Types.ObjectId }>>();
    if (users.length === 0) return;
    await NotificationModel.insertMany(
      users.map(u => ({ tenantId, userId: u._id, read: false, ...payload }))
    );
  } catch (err) {
    console.error("[notify] notification non créée:", err);
  }
}
