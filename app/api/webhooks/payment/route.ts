import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verifyPaydunyaPayment } from "@/lib/paydunya";
import { TenantModel } from "@/models/Tenant";
import { UserModel } from "@/models/User";
import { sendEmail, templatePaymentConfirmation } from "@/lib/email";
import { AttendeeModel } from "@/models/Attendee";
import { EventModel } from "@/models/Event";
import { sendTicketEmail, sendTicketWhatsApp } from "@/lib/ticket-delivery";

/**
 * POST /api/webhooks/payment
 * Webhook PayDunya — appelé après un paiement réussi ou échoué
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = body.token || body.invoice_token;

    if (!token) return NextResponse.json({ error: "Token manquant" }, { status: 400 });

    const payment = await verifyPaydunyaPayment(token);

    if (!payment.paid) {
      console.log(`[Webhook] Paiement non complété : token=${token} status=${payment.status}`);
      return NextResponse.json({ received: true, paid: false });
    }

    await connectDB();

    // Extraire tenantId depuis orderId (format: NMP-{tenantId}-{timestamp})
    const orderId = payment.orderId || "";
    const parts = orderId.split("-");

    // ── Paiement d'un billet d'activité (orderId = EVT-<attendeeId>-<ts>) ──
    if (orderId.startsWith("EVT-")) {
      const attendeeId = parts[1];
      const attendee = await AttendeeModel.findById(attendeeId);
      if (!attendee) return NextResponse.json({ error: "Billet inconnu" }, { status: 404 });
      if (attendee.status === "paid" || attendee.status === "present") {
        return NextResponse.json({ received: true, paid: true, alreadyProcessed: true });
      }
      attendee.status = "paid";
      attendee.paymentRef = token;
      await attendee.save();

      // Livraison du billet après paiement (best-effort).
      try {
        const ev = (await EventModel.findById(attendee.eventId).lean()) as
          | { title: string; startAt: string | Date; endAt?: string | Date; locationType: string; address?: string; meetingLink?: string }
          | null;
        if (ev) {
          const baseUrl = process.env.APP_BASE_URL || "https://kanoo.ne";
          const locationLabel = ev.locationType === "online" ? (ev.meetingLink || "En ligne") : (ev.address || "Lieu à préciser");
          const info = {
            eventTitle: ev.title, start: new Date(ev.startAt), end: ev.endAt ? new Date(ev.endAt) : undefined,
            locationLabel, attendeeId: attendee._id.toString(), attendeeName: `${attendee.firstName} ${attendee.lastName}`,
            ticketTypeName: attendee.ticketTypeName, amount: attendee.amount, ticketCode: attendee.ticketCode,
          };
          if (attendee.email) await sendTicketEmail(attendee.email, info, baseUrl);
          if (attendee.phone) await sendTicketWhatsApp(attendee.phone, info);
        }
      } catch (e) {
        console.error("[Webhook] envoi billet échoué", e);
      }
      return NextResponse.json({ received: true, paid: true });
    }

    const tenantId = parts.length >= 2 ? parts[1] : null;

    if (!tenantId) {
      console.error(`[Webhook] orderId invalide : ${orderId}`);
      return NextResponse.json({ error: "orderId invalide" }, { status: 400 });
    }

    // Charger l'organisation et la tentative de paiement correspondante.
    const tenantDoc = (await TenantModel.findById(tenantId)) as
      | (Record<string, unknown> & { paymentAttempts?: Array<{ orderId: string; amount?: number; status?: string }> })
      | null;
    if (!tenantDoc) {
      console.error(`[Webhook] organisation introuvable : ${tenantId}`);
      return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
    }

    const attempt = (tenantDoc.paymentAttempts || []).find((a) => a.orderId === orderId);
    if (!attempt) {
      console.error(`[Webhook] tentative inconnue pour orderId=${orderId}`);
      return NextResponse.json({ error: "Tentative de paiement inconnue" }, { status: 400 });
    }

    // Idempotence : une tentative déjà traitée n'est jamais rejouée.
    if (attempt.status === "completed") {
      return NextResponse.json({ received: true, paid: true, alreadyProcessed: true });
    }

    // Intégrité : le montant réglé doit couvrir le montant attendu.
    const paidAmount = Number(payment.amount ?? 0);
    const expectedAmount = Number(attempt.amount ?? 0);
    if (expectedAmount > 0 && paidAmount < expectedAmount) {
      console.error(`[Webhook] montant insuffisant orderId=${orderId} payé=${paidAmount} attendu=${expectedAmount}`);
      return NextResponse.json({ error: "Montant insuffisant" }, { status: 400 });
    }

    // Activer l'abonnement + marquer la tentative traitée, de façon atomique
    // (le filtre status ≠ completed garantit l'idempotence en cas de course).
    const now = new Date();
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await TenantModel.updateOne(
      { _id: tenantId, "paymentAttempts.orderId": orderId, "paymentAttempts.status": { $ne: "completed" } },
      {
        $set: {
          subscriptionStatus: "active",
          subscriptionActivatedAt: now,
          subscriptionNextBilling: nextBilling,
          "paymentAttempts.$.status": "completed",
          "paymentAttempts.$.completedAt": now,
        },
      }
    );

    // Notifier l'admin du tenant
    const tenant = await TenantModel.findById(tenantId).lean() as { name: string; email?: string } | null;
    const admin = await UserModel.findOne({ tenantId, role: { $in: ["admin", "pme_admin", "asso_president", "admin_maire"] } }).lean() as { email?: string } | null;

    const emailTo = tenant?.email || admin?.email;
    if (emailTo && tenant) {
      const emailPayload = templatePaymentConfirmation(
        tenant.name,
        payment.amount || 0,
        "Abonnement",
        orderId
      );
      await sendEmail({ ...emailPayload, to: emailTo });
    }

    console.log(`[Webhook] ✅ Paiement confirmé — tenant=${tenantId} montant=${payment.amount} ref=${orderId}`);
    return NextResponse.json({ received: true, paid: true, tenantId });

  } catch (err) {
    console.error("[Webhook] Erreur:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}

// GET : verification de santé du webhook (PayDunya peut envoyer un GET pour vérifier)
export async function GET() {
  return NextResponse.json({ ok: true, service: "Kanoo Payment Webhook" });
}
