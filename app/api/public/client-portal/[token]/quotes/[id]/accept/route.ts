import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { DevisModel } from "@/models/Devis";
import { NotificationModel } from "@/models/Notification";
import { UserModel } from "@/models/User";
import { portalGate } from "@/lib/client-portal-server";
import { clientIp } from "@/lib/rate-limit";

type Params = { params: Promise<{ token: string; id: string }> | { token: string; id: string } };

/**
 * POST { name } — le client accepte un devis depuis son portail : nom du
 * signataire, date et adresse sont conservés comme trace de l'acceptation, et
 * l'émetteur du devis est prévenu.
 */
export async function POST(req: NextRequest, ctx: Params) {
  const { token, id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const gate = await portalGate(req, token);
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (name.length < 2) return NextResponse.json({ success: false, error: "Indiquez le nom de la personne qui accepte le devis." }, { status: 400 });
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Devis introuvable." }, { status: 404 });
  const startOfToday = new Date(new Date().toDateString());
  const devis = await DevisModel.findOneAndUpdate(
    { _id: id, tenantId: gate.client.tenantId, clientId: gate.client._id, status: "sent", validUntil: { $gte: startOfToday } },
    { $set: { status: "accepted", acceptedOnline: { at: new Date(), name, ip: clientIp(req) } } },
    { new: true },
  ).select("number createdBy").lean<{ number: string; createdBy: unknown } | null>();
  if (!devis) return NextResponse.json({ success: false, error: "Ce devis ne peut plus être accepté (déjà traité ou expiré)." }, { status: 409 });
  try {
    const author = await UserModel.findById(devis.createdBy).select("_id").lean<{ _id: unknown } | null>();
    if (author) await NotificationModel.create({ tenantId: gate.client.tenantId, userId: author._id, type: "devis_accepted",
      title: "Devis accepté en ligne", message: `${gate.client.name} a accepté le devis ${devis.number} (signé par ${name}).`, linkedTo: "devis", linkedId: id });
  } catch { /* la notification est un plus : l'acceptation est enregistrée */ }
  return NextResponse.json({ success: true, data: { number: devis.number, status: "accepted" } });
}
