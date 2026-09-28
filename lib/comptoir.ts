import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ActivityDeskModel } from "@/models/ActivityDesk";

export const isId = (v: unknown): v is string =>
  typeof v === "string" && Types.ObjectId.isValid(v);

/**
 * Le comptoir demandé, s'il existe ET appartient à l'organisation de
 * l'appelant. Toute écriture (article, mouvement, caisse) passe par ce contrôle :
 * un `deskId` d'une autre organisation — ou mal formé — est refusé proprement
 * au lieu de produire une donnée orpheline ou une erreur 500.
 */
export async function ownDesk(auth: TokenPayload, deskId: unknown) {
  if (!isId(deskId)) return null;
  return ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) })
    .select("_id name activityId").lean<{ _id: Types.ObjectId; name: string; activityId?: Types.ObjectId } | null>();
}
