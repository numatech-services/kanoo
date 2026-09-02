import QRCode from "qrcode";
import { createPDFBuffer } from "./pdf";
import { buildIcs } from "./ics";
import { sendEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";
import { buildQrPayload } from "./ticketing";

export interface TicketInfo {
  eventTitle: string;
  start: Date;
  end?: Date;
  locationLabel: string;
  attendeeId: string;
  attendeeName: string;
  ticketTypeName?: string;
  amount?: number;
  ticketCode: string;
}

/** Billet PDF A4 avec QR code et code de secours. */
export async function buildTicketPdf(t: TicketInfo): Promise<Buffer> {
  const payload = buildQrPayload(t.attendeeId, t.ticketCode);
  const qrPng = await QRCode.toBuffer(payload, {
    margin: 1,
    width: 260,
    color: { dark: "#17130E", light: "#FFFFFF" },
  });

  return createPDFBuffer((doc) => {
    doc.rect(0, 0, doc.page.width, 92).fill("#17130E");
    doc.fill("#F5EEE1").fontSize(20).font("Helvetica-Bold").text("KANOO", 50, 34);
    doc.fill("#E9A45C").fontSize(11).font("Helvetica").text("BILLET / TICKET", 50, 62);

    doc.fillColor("#17130E").fontSize(22).font("Helvetica-Bold").text(t.eventTitle, 50, 130, { width: 300 });
    doc.moveDown(0.6);
    doc.fontSize(11).font("Helvetica").fillColor("#5A5245");
    doc.text(t.start.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" }), { width: 300 });
    doc.text(t.locationLabel, { width: 300 });

    // Séparateur de milliers en espace normale (la police PDF rend mal l'espace insécable).
    const money = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");
    doc.moveDown(1.2);
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#17130E").text(t.attendeeName, { width: 300 });
    if (t.ticketTypeName) {
      doc.fontSize(11).font("Helvetica").fillColor("#5A5245")
        .text(`${t.ticketTypeName}${t.amount ? " · " + money(t.amount) + " F" : ""}`, { width: 300 });
    }

    // QR + code de secours à droite.
    doc.image(qrPng, 380, 122, { width: 165 });
    doc.fontSize(9).font("Helvetica").fillColor("#847966").text("Code de secours", 380, 296, { width: 165, align: "center" });
    doc.fontSize(15).font("Helvetica-Bold").fillColor("#17130E").text(t.ticketCode, 380, 308, { width: 165, align: "center" });

    doc.fontSize(9).font("Helvetica").fillColor("#847966")
      .text("Présentez ce QR à l'entrée. Billet nominatif, non transférable.", 50, 420, { width: 495 });
  });
}

function ticketEmailHtml(t: TicketInfo): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#17130E;">
    <div style="background:#17130E;padding:22px 28px;border-radius:14px 14px 0 0;">
      <p style="color:#F5EEE1;font-weight:700;font-size:18px;margin:0;">Kanoo</p>
      <p style="color:#E9A45C;font-size:12px;margin:4px 0 0;letter-spacing:.08em;">VOTRE BILLET</p>
    </div>
    <div style="background:#FFFDF8;padding:26px 28px;border:1px solid #EAE1D0;border-top:none;">
      <h2 style="font-size:20px;margin:0 0 6px;color:#17130E;">${t.eventTitle}</h2>
      <p style="color:#5A5245;font-size:14px;margin:0 0 2px;">${t.start.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}</p>
      <p style="color:#5A5245;font-size:14px;margin:0 0 18px;">${t.locationLabel}</p>
      <p style="font-size:14px;margin:0 0 4px;"><b>${t.attendeeName}</b></p>
      ${t.ticketTypeName ? `<p style="color:#5A5245;font-size:13px;margin:0 0 18px;">${t.ticketTypeName}${t.amount ? " · " + t.amount.toLocaleString("fr-FR") + " F" : ""}</p>` : ""}
      <div style="background:#F6E7D3;border:1px solid #EDD3AF;border-radius:10px;padding:14px;text-align:center;margin:8px 0 16px;">
        <p style="font-size:12px;color:#8A4308;margin:0 0 4px;">Code de secours</p>
        <p style="font-size:22px;font-weight:700;letter-spacing:3px;margin:0;color:#17130E;">${t.ticketCode}</p>
      </div>
      <p style="color:#5A5245;font-size:13px;margin:0;">Votre billet (QR code) et l'invitation calendrier sont en pièces jointes. Présentez le QR à l'entrée.</p>
    </div>
    <div style="background:#F5EEE1;padding:14px 28px;border-radius:0 0 14px 14px;text-align:center;">
      <p style="color:#847966;font-size:11px;margin:0;">Kanoo · Niamey, Niger</p>
    </div>
  </div>`;
}

/** Envoie le billet par email (PDF + .ics en pièces jointes). Best-effort. */
export async function sendTicketEmail(to: string, t: TicketInfo, baseUrl: string): Promise<{ sent: boolean; error?: string }> {
  const pdf = await buildTicketPdf(t);
  const ics = buildIcs({
    uid: `${t.attendeeId}@kanoo`,
    title: t.eventTitle,
    location: t.locationLabel,
    start: t.start,
    end: t.end,
    url: baseUrl,
  });
  return sendEmail({
    to,
    subject: `Votre billet — ${t.eventTitle}`,
    html: ticketEmailHtml(t),
    attachments: [
      { filename: "billet.pdf", content: pdf, contentType: "application/pdf" },
      { filename: "evenement.ics", content: Buffer.from(ics, "utf-8"), contentType: "text/calendar" },
    ],
  });
}

/** Message WhatsApp du billet (le QR reste sur l'email/PDF ; ici les infos + code). */
export function ticketWhatsAppText(t: TicketInfo): string {
  return (
    `🎟️ *${t.eventTitle}*\n` +
    `🗓️ ${t.start.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}\n` +
    `📍 ${t.locationLabel}\n\n` +
    `Billet de *${t.attendeeName}*` +
    (t.ticketTypeName ? ` — ${t.ticketTypeName}` : "") +
    `\nCode d'entrée : *${t.ticketCode}*\n\n` +
    `Présentez ce code (ou le QR reçu par email) à l'entrée.\n— Kanoo`
  );
}

/** Envoie le billet par WhatsApp (best-effort, selon configuration). */
export async function sendTicketWhatsApp(phone: string, t: TicketInfo): Promise<{ sent: boolean; error?: string }> {
  return sendWhatsApp({ to: phone, text: ticketWhatsAppText(t) });
}
