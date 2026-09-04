import { Types } from "mongoose";
import { TokenPayload } from "./auth";
import { tenantFilter } from "./api-helpers";

/**
 * Portée de lecture de l'agenda pour un utilisateur : ses propres entrées,
 * celles où il est convié (participants), et tout ce qui est partagé au sein de
 * son organisation.
 */
export function visibleFilter(auth: TokenPayload): Record<string, unknown> {
  const me = new Types.ObjectId(auth.userId);
  return {
    ...tenantFilter(auth),
    $or: [{ visibility: "shared" }, { ownerId: me }, { participants: me }],
  };
}
