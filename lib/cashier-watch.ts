import { Types } from "mongoose";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { UserModel } from "@/models/User";
import { cancellationAlert } from "@/lib/spot";
import { notify, getAdmins } from "@/lib/cron-helpers";
import { localDay } from "@/lib/comptoir-sale";
import type { TokenPayload } from "@/lib/auth";

/**
 * Après une annulation : si le caissier du ticket dépasse le seuil du jour
 * (3 annulations, ou plus de 10 % de ses tickets), le gérant et le chef du
 * comptoir sont prévenus (une fois : la notification est dédoublonnée).
 */
export async function cancellationWatch(auth: TokenPayload, deskId: unknown, cashierId: unknown) {
  try {
    const day = localDay(new Date());
    const range = { $gte: new Date(`${day}T00:00:00.000`), $lte: new Date(`${day}T23:59:59.999`) };
    const base = { tenantId: new Types.ObjectId(auth.tenantId), deskId, cashierId, date: range };
    const [total, cancelled] = await Promise.all([ComptoirSaleModel.countDocuments(base), ComptoirSaleModel.countDocuments({ ...base, status: "cancelled" })]);
    if (!cancellationAlert(cancelled, total)) return;
    const who = await UserModel.findById(cashierId).select("firstName lastName").lean<{ firstName?: string; lastName?: string } | null>();
    const tid = new Types.ObjectId(auth.tenantId);
    for (const a of await getAdmins(tid, ["pme_admin", "pme_manager", "svc_spot"])) {
      await notify(tid, a._id, "desk_cancellations", "Comptoir : annulations inhabituelles",
        `${who?.firstName ?? ""} ${who?.lastName ?? ""} : ${cancelled} ticket(s) annulé(s) sur ${total} aujourd'hui (${day}).`, "comptoir", new Types.ObjectId(String(cashierId)));
    }
  } catch (e) { console.error("[Comptoir] surveillance des annulations :", e); }
}
