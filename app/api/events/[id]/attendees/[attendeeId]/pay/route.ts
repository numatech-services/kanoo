import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { EventModel } from "@/models/Event";
import { AttendeeModel } from "@/models/Attendee";
import { createPaydunyaInvoice } from "@/lib/paydunya";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Initie le paiement en ligne (mobile money / carte via PayDunya) d'un billet.
 * Retourne l'URL de paiement. La confirmation arrive par le webhook, qui marque
 * le billet « payé » et déclenche l'envoi (email + WhatsApp).
 */
export const POST = withAuth("events", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const [ev, at] = await Promise.all([
    EventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean(),
    AttendeeModel.findOne({ _id: params.attendeeId, eventId: params.id, ...tenantFilter(auth) }),
  ]);
  if (!ev || !at) return notFound("Billet introuvable");
  const e = ev as unknown as { _id: unknown; title: string; isPaid: boolean };

  if (!e.isPaid || !at.amount || at.amount <= 0) return badRequest("Ce billet n'est pas payant");
  if (at.status === "paid" || at.status === "present") return badRequest("Ce billet est déjà réglé");

  const orderId = `EVT-${at._id.toString()}-${Date.now()}`;
  const baseUrl = process.env.APP_BASE_URL || "https://kanoo.ne";

  const r = await createPaydunyaInvoice({
    totalAmount: at.amount,
    description: `Billet — ${e.title}`,
    items: [{
      name: e.title,
      quantity: 1,
      unit_price: String(at.amount),
      total_price: String(at.amount),
      description: at.ticketTypeName,
    }],
    customerName: `${at.firstName} ${at.lastName}`,
    customerEmail: at.email || auth.email,
    customerPhone: at.phone,
    orderId,
    returnUrl: `${baseUrl}/activites/${String(e._id)}?paid=1`,
    cancelUrl: `${baseUrl}/activites/${String(e._id)}`,
    webhookUrl: `${baseUrl}/api/webhooks/payment`,
  });

  if (!r.success) return badRequest(r.error || "Erreur d'initialisation du paiement");

  at.orderId = orderId;
  at.paydunyaToken = r.token;
  await at.save();

  await logAudit(auth, "UPDATE", "events", { resourceId: String(params.id), attendeeId: at._id.toString(), action: "payment_initiated" });
  return ok({ paymentUrl: r.paymentUrl, orderId });
});
