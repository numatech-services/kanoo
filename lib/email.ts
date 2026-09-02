/**
 * Service d'envoi d'emails — Kanoo
 * Fournisseurs supportés : brevo | smtp | console
 *
 * Variables d'environnement :
 *   EMAIL_PROVIDER=brevo|smtp|console
 *   BREVO_API_KEY=xkeysib-...       (Brevo API key)
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS  (SMTP générique)
 *   EMAIL_FROM=noreply@kanoo.ne
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

const FROM_DEFAULT = process.env.EMAIL_FROM || "Kanoo <noreply@kanoo.ne>";
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "console";

// ─── Envoi via Brevo API (recommandé) ────────────────────────────────────────
async function sendViaBrevo(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY manquante dans .env.local");

  const toList = Array.isArray(payload.to)
    ? payload.to.map(e => ({ email: e }))
    : [{ email: payload.to }];

  const body = {
    sender: { email: FROM_DEFAULT.match(/<(.+)>/)?.[1] || FROM_DEFAULT, name: "Kanoo" },
    to: toList,
    subject: payload.subject,
    htmlContent: payload.html,
    textContent: payload.text,
  };
  if (payload.replyTo) Object.assign(body, { replyTo: { email: payload.replyTo } });
  if (payload.attachments?.length) {
    Object.assign(body, {
      attachment: payload.attachments.map((a) => ({ name: a.filename, content: a.content.toString("base64") })),
    });
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${err}`);
  }
}

// ─── Envoi via SMTP générique (nodemailer) ────────────────────────────────────
async function sendViaSMTP(payload: EmailPayload): Promise<void> {
  // Import dynamique pour éviter le chargement côté client
  const nodemailer = await import("nodemailer").catch(() => {
    throw new Error("nodemailer non installé. Exécuter : npm install nodemailer");
  });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: payload.from || FROM_DEFAULT,
    to: Array.isArray(payload.to) ? payload.to.join(", ") : payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

/**
 * Envoie un email via le fournisseur configuré.
 * Ne lève jamais d'exception — log l'erreur en cas d'échec.
 */
export async function sendEmail(payload: EmailPayload): Promise<{ sent: boolean; error?: string }> {
  const to = Array.isArray(payload.to) ? payload.to.join(", ") : payload.to;

  if (EMAIL_PROVIDER === "console" || !to) {
    console.log(`\n[Email CONSOLE] ──────────────────────────────`);
    console.log(`  TO      : ${to || "(vide)"}`);
    console.log(`  SUBJECT : ${payload.subject}`);
    if (payload.text) console.log(`  TEXT    : ${payload.text.slice(0, 150)}`);
    if (payload.attachments?.length) console.log(`  PJ      : ${payload.attachments.map((a) => a.filename).join(", ")}`);
    console.log(`──────────────────────────────────────────────\n`);
    return { sent: true };
  }

  try {
    if (EMAIL_PROVIDER === "brevo") {
      await sendViaBrevo(payload);
    } else if (EMAIL_PROVIDER === "smtp") {
      await sendViaSMTP(payload);
    } else {
      throw new Error(`EMAIL_PROVIDER inconnu : ${EMAIL_PROVIDER}`);
    }
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Email ERROR] ${payload.subject} → ${to} : ${message}`);
    return { sent: false, error: message };
  }
}

// ─── Templates réutilisables ──────────────────────────────────────────────────

const baseStyle = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#374151;`;

function emailWrapper(content: string): string {
  return `
    <div style="${baseStyle}">
      <div style="background:#2F3E46;padding:20px 28px;border-radius:12px 12px 0 0;">
        <p style="color:#fff;font-weight:600;font-size:18px;margin:0;">Kanoo</p>
      </div>
      <div style="background:#ffffff;padding:28px;border:1px solid #e5e7eb;border-top:none;">
        ${content}
      </div>
      <div style="background:#F3F1EA;padding:14px 28px;border-radius:0 0 12px 12px;text-align:center;">
        <p style="color:#9CA3AF;font-size:11px;margin:0;">Kanoo · Niamey, Niger · <a href="https://kanoo.ne" style="color:#9CA3AF;">kanoo.ne</a></p>
      </div>
    </div>`;
}

export function templateActivation(tenantName: string, token: string, baseUrl: string): EmailPayload {
  const link = `${baseUrl}/activer-compte?token=${token}`;
  return {
    to: "",
    subject: "Activez votre compte Kanoo — 30 jours offerts",
    html: emailWrapper(`
      <h2 style="color:#2F3E46;font-size:22px;margin:0 0 12px;">Bienvenue, ${tenantName} !</h2>
      <p>Votre organisation a bien été créée sur Kanoo. Cliquez ci-dessous pour activer votre compte et démarrer votre essai gratuit de <strong>30 jours</strong>.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:#2F3E46;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
          ✅ Activer mon compte →
        </a>
      </p>
      <p style="color:#6B7280;font-size:12px;">Ce lien expire dans 48h. Si vous n'avez pas créé de compte, ignorez cet email.</p>
      <p style="color:#6B7280;font-size:11px;word-break:break-all;">${link}</p>
    `),
    text: `Activez votre compte Kanoo : ${link}`,
  };
}

export function templateAccessCode(firstName: string, code: string, baseUrl: string): EmailPayload {
  return {
    to: "",
    subject: "Votre code d'accès — Espace adhérent Kanoo",
    html: emailWrapper(`
      <h2 style="color:#2F3E46;font-size:20px;margin:0 0 12px;">Bonjour ${firstName},</h2>
      <p>Voici votre code d'accès personnel pour l'espace adhérent :</p>
      <div style="background:#F3F1EA;border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
        <p style="color:#6B7280;font-size:12px;margin:0 0 6px;">CODE D'ACCÈS</p>
        <p style="font-size:38px;font-weight:700;color:#2F3E46;letter-spacing:10px;margin:0;font-family:monospace;">${code}</p>
      </div>
      <p style="text-align:center;">
        <a href="${baseUrl}/portail/adherent/connexion" style="background:#2F3E46;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">
          Accéder à mon espace →
        </a>
      </p>
    `),
    text: `Votre code d'accès Kanoo : ${code}. Connectez-vous sur ${baseUrl}/portail/adherent`,
  };
}

export function templateInvoiceReminder(invoiceNumber: string, amount: number, dueDate: Date, clientEmail: string): EmailPayload {
  return {
    to: clientEmail,
    subject: `Rappel — Facture ${invoiceNumber} en attente de règlement`,
    html: emailWrapper(`
      <h2 style="color:#2F3E46;font-size:20px;margin:0 0 12px;">Rappel de paiement</h2>
      <p>La facture <strong>${invoiceNumber}</strong> d'un montant de <strong style="color:#2F3E46;">${amount.toLocaleString("fr-FR")} XOF</strong> est en attente de règlement.</p>
      <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <p style="margin:0;color:#92400E;">⏰ Date d'échéance : <strong>${dueDate.toLocaleDateString("fr-FR")}</strong></p>
      </div>
      <p style="color:#6B7280;font-size:13px;">Merci de procéder au règlement dans les meilleurs délais. En cas de question, contactez notre équipe.</p>
    `),
  };
}

export function templatePasswordReset(resetLink: string): EmailPayload {
  return {
    to: "",
    subject: "Réinitialisation de votre mot de passe Kanoo",
    html: emailWrapper(`
      <h2 style="color:#2F3E46;font-size:20px;margin:0 0 12px;">Réinitialisation du mot de passe</h2>
      <p>Vous avez demandé une réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${resetLink}" style="background:#2F3E46;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;">
          Réinitialiser mon mot de passe
        </a>
      </p>
      <p style="color:#6B7280;font-size:12px;">Ce lien expire dans 2 heures. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
    `),
  };
}

export function templatePaymentConfirmation(tenantName: string, amount: number, plan: string, reference: string): EmailPayload {
  return {
    to: "",
    subject: `Kanoo — Confirmation de paiement ${reference}`,
    html: emailWrapper(`
      <h2 style="color:#2F3E46;font-size:20px;margin:0 0 12px;">✅ Paiement confirmé</h2>
      <p>Bonjour <strong>${tenantName}</strong>, votre abonnement Kanoo a bien été renouvelé.</p>
      <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:8px;padding:16px;margin:16px 0;">
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="color:#6B7280;padding:4px 0;">Plan</td><td style="text-align:right;font-weight:600;color:#2F3E46;">${plan}</td></tr>
          <tr><td style="color:#6B7280;padding:4px 0;">Montant</td><td style="text-align:right;font-weight:600;color:#2F3E46;">${amount.toLocaleString("fr-FR")} XOF</td></tr>
          <tr><td style="color:#6B7280;padding:4px 0;">Référence</td><td style="text-align:right;font-family:monospace;color:#2F3E46;">${reference}</td></tr>
        </table>
      </div>
      <p style="color:#6B7280;font-size:12px;">Conservez cet email comme justificatif de paiement.</p>
    `),
  };
}
