import { NextRequest } from "next/server";
import { withAuth, ok, forbidden, notFound, badRequest } from "@/lib/api-helpers";
import { isInternFor, INTERN_EXPORT_MESSAGE, authCan } from "@/lib/role-resources";
import { statementPdf } from "@/lib/statement-pdf";
import { currentPortalLink, createPortalLink } from "@/lib/client-portal";
import { sendEmail, emailWrapper } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * POST { from, to, email?, payLink? } — envoie le relevé au client, PDF en
 * pièce jointe et lien de paiement en ligne (portail). Le bouton « Envoyer »
 * ouvrait la messagerie de l'utilisateur, sans le PDF.
 */
export const POST = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  if (isInternFor(auth, "clients")) return forbidden(INTERN_EXPORT_MESSAGE);
  if (!authCan(auth, "invoices", "read")) return forbidden("Relevé réservé à la comptabilité et au gérant.");
  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const from = body.from ? new Date(body.from) : new Date(now.getFullYear(), 0, 1);
  const to = body.to ? new Date(body.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return badRequest("Période invalide.");
  const r = await statementPdf(auth.tenantId, String(params.id), from, to);
  if (!r) return notFound("Client introuvable");
  const dest = String(body.email || r.client.email || "").trim();
  if (!EMAIL.test(dest)) return badRequest("Adresse e-mail du client manquante ou invalide.");
  const link = body.payLink === false ? null
    : (await currentPortalLink(auth.tenantId, params.id)) ?? (authCan(auth, "clients", "update") ? (await createPortalLink(auth.tenantId, params.id))?.url ?? null : null);
  const period = `${from.toLocaleDateString("fr-FR")} au ${to.toLocaleDateString("fr-FR")}`;
  const text = `Bonjour,\n\nVeuillez trouver ci-joint votre relevé de compte du ${period}.\n\n${r.summary}\n\n`
    + (link && r.totals.closingBalance > 0 ? `Vous pouvez consulter vos factures et les régler en ligne (mobile money, carte) : ${link}\n\n` : "")
    + `Cordialement,\n${r.tenantName}`;
  const html = emailWrapper(text.split("\n\n").map(p => `<p>${esc(p).replace(/\n/g, "<br>").replace(link ? esc(link) : "\u0000", link ? `<a href="${esc(link)}">${esc(link)}</a>` : "")}</p>`).join(""));
  const res = await sendEmail({
    to: dest, subject: `Relevé de compte au ${to.toLocaleDateString("fr-FR")} — ${r.tenantName}`, html, text,
    attachments: [{ filename: r.filename, content: r.pdf, contentType: "application/pdf" }],
  });
  if (!res.sent) return badRequest(`Envoi impossible : ${res.error ?? "service d'e-mail indisponible"}.`);
  await logAudit(auth, "EXPORT", "clients", { resourceId: String(params.id), metadata: { document: "releve", sentTo: dest, from: from.toISOString(), to: to.toISOString(), payLink: !!link } });
  return ok({ sentTo: dest, payLink: !!link });
});
