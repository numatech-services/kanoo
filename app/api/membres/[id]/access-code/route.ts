import { NextRequest } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { MemberModel } from "@/models/Member";
import { sendEmail } from "@/lib/email";
import { sendSMS } from "@/lib/sms";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** Génère un code à 6 chiffres de façon cryptographique (non prévisible). */
function generateAccessCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * POST /api/membres/:id/access-code
 * Génère (ou régénère) le code d'accès portail adhérent et l'envoie par SMS + email
 */
export const POST = withAuth("membres", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const member = await MemberModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!member) return notFound();

  const code = generateAccessCode();
  member.accessCode = code;
  member.accessCodeGeneratedAt = new Date();
  await member.save();

  const name = `${member.firstName} ${member.lastName}`;
  const message = `Kanoo — Votre code d'accès au portail adhérent : ${code}. Connectez-vous sur ${process.env.APP_BASE_URL || "https://kanoo.ne"}/portail/adherent`;

  const results = { sms: false, email: false };

  // Envoi SMS si numéro disponible
  if (member.phone) {
    try {
      await sendSMS({ to: member.phone, message });
      results.sms = true;
      member.accessCodeSentAt = new Date();
      await member.save();
    } catch (e) {
      console.error("[AccessCode] SMS échoué:", e);
    }
  }

  // Envoi email si adresse disponible
  if (member.email) {
    try {
      await sendEmail({
        to: member.email,
        subject: "Votre code d'accès Kanoo — Espace adhérent",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <h2 style="color:#2F3E46;font-size:22px;margin-bottom:8px;">Bienvenue, ${member.firstName} !</h2>
            <p style="color:#6B705C;margin-bottom:24px;">Voici votre code d'accès personnel pour vous connecter à l'espace adhérent.</p>
            <div style="background:#F3F1EA;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
              <p style="font-size:13px;color:#6B705C;margin:0 0 8px;">Votre code d'accès</p>
              <p style="font-size:36px;font-weight:bold;color:#2F3E46;letter-spacing:8px;margin:0;">${code}</p>
            </div>
            <p style="color:#6B705C;font-size:13px;">Utilisez ce code avec votre email pour vous connecter :</p>
            <a href="${process.env.APP_BASE_URL || "https://kanoo.ne"}/portail/adherent/connexion"
               style="display:inline-block;background:#2F3E46;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:14px;margin-top:12px;">
               Accéder à mon espace →
            </a>
            <p style="color:#B4B2A9;font-size:11px;margin-top:24px;">Si vous n'avez pas demandé ce code, ignorez ce message.</p>
          </div>
        `,
      });
      results.email = true;
    } catch (e) {
      console.error("[AccessCode] Email échoué:", e);
    }
  }

  await logAudit(auth, "UPDATE", "membres", {
    resourceId: params.id,
    after: { action: "access_code_generated", sentSMS: results.sms, sentEmail: results.email },
  });

  return ok({
    message: `Code d'accès généré pour ${name}`,
    code: code,                    // Affiché une fois dans le dashboard admin
    sentSMS: results.sms,
    sentEmail: results.email,
    hasPhone: !!member.phone,
    hasEmail: !!member.email,
  });
});

/**
 * GET /api/membres/:id/access-code
 * Vérifie si un code a déjà été généré (sans révéler le code)
 */
export const GET = withAuth("membres", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const member = await MemberModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("accessCode accessCodeGeneratedAt accessCodeSentAt firstName lastName").lean();
  if (!member) return notFound();

  return ok({
    hasCode: !!(member as {accessCode?: string}).accessCode,
    generatedAt: (member as {accessCodeGeneratedAt?: Date}).accessCodeGeneratedAt || null,
    sentAt: (member as {accessCodeSentAt?: Date}).accessCodeSentAt || null,
  });
});
