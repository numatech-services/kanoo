import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/app-url";
import { connectDB } from "@/lib/db";
import { badRequest, conflict, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { UserModel } from "@/models/User";
import { generateSecureToken, hashPassword } from "@/lib/auth";
import { passwordErrors } from "@/lib/password-policy";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sendEmail, templateActivation } from "@/lib/email";

export const dynamic = "force-dynamic";

const TYPES = new Set(["pme", "association", "administration"]);

/**
 * POST /api/public/inscription — le point d'entrée du produit.
 *
 * Il n'existait pas : la page /souscrire appelait /api/superadmin/tenants, une
 * route qui exige d'être… superadmin. Le bouton « Démarrer gratuitement » de la
 * page d'accueil menait donc à un 401 pour cent pour cent des visiteurs. Aucune
 * inscription publique n'a jamais pu aboutir.
 *
 * Choix de conception :
 * - **Le compte naît en `pending_activation`** et le lien d'activation part par
 *   courriel. Répondre 401 à la connexion tant que l'adresse n'est pas prouvée
 *   ferme la porte aux inscriptions avec l'adresse d'autrui.
 * - **La réponse ne contient jamais le jeton d'activation** — contrairement à
 *   la route superadmin, où l'appelant est l'opérateur de la plateforme. Ici,
 *   le jeton dans la réponse dispenserait de contrôler l'adresse.
 * - **La limite de débit est par IP et serrée** : l'inscription écrit en base
 *   et envoie un courriel — deux choses qu'un robot adore faire en boucle.
 * - Un courriel déjà pris répond en conflit explicite : c'est nécessaire à
 *   l'utilisateur légitime, et l'énumération est freinée par la limite d'IP.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip") || "unknown";
    const limit = await consumeRateLimit("public-signup", ip, 5, 60 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de tentatives d'inscription. Réessayez dans une heure." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const type = String(body.type || "");
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword || "");
    const firstName = String(body.adminFirstName || "").trim();
    const lastName = String(body.adminLastName || "").trim();

    if (name.length < 2 || name.length > 120) return badRequest("Nom de l'organisation requis (2 à 120 caractères).");
    if (!TYPES.has(type)) return badRequest("Type d'organisation inconnu.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 190) {
      return badRequest("Adresse e-mail invalide.");
    }

    const problems = passwordErrors(adminPassword, {
      email: adminEmail, firstName, lastName, tenantName: name,
    });
    if (problems.length > 0) return badRequest(problems.join(" "));

    await connectDB();

    // L'unicité du courriel administrateur se contrôle sur TOUTES les
    // organisations : c'est l'identifiant de connexion.
    const emailTaken = await UserModel.exists({ email: adminEmail });
    if (emailTaken) {
      return conflict("Un compte existe déjà avec cette adresse. Connectez-vous, ou utilisez « Mot de passe oublié ».");
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40) || "org";
    let slug = baseSlug;
    let attempt = 0;
    while (await TenantModel.exists({ slug })) slug = `${baseSlug}-${++attempt}`;

    const activationToken = generateSecureToken();
    const tenant = await TenantModel.create({
      name,
      slug,
      type,
      email: String(body.email || adminEmail).trim().toLowerCase(),
      phone: body.phone ? String(body.phone).slice(0, 30) : undefined,
      plan: ["starter", "pro", "business"].includes(String(body.plan)) ? body.plan : "starter",
      planModules: ["*"],
      // L'essai ne démarre qu'à l'activation : le compter dès l'inscription
      // ferait perdre des jours d'essai à qui active le lendemain.
      subscriptionStatus: "pending_activation",
      activationToken,
      activationTokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const adminRole = type === "association" ? "asso_president"
      : type === "administration" ? "admin_ordonnateur"
      : "pme_admin";

    await UserModel.create({
      tenantId: tenant._id,
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      firstName: firstName || "Admin",
      lastName: lastName || name,
      role: adminRole,
      isActive: true,
    });

    const baseUrl = appBaseUrl();
    await sendEmail({ ...templateActivation(name, activationToken, baseUrl), to: adminEmail });

    return NextResponse.json({
      success: true,
      data: {
        message: `Compte créé. Un lien d'activation vient d'être envoyé à ${adminEmail} — il est valable 48 heures.`,
        // Jamais le jeton : il prouve le contrôle de l'adresse, la réponse
        // HTTP ne le prouve pas.
      },
    }, { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
