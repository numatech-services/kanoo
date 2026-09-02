import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { MemberModel } from "@/models/Member";
import { SupplierModel } from "@/models/Supplier";
import {
  signPortalToken, setPortalCookie, verifyAccessCode, hashAccessCode,
} from "@/lib/portal-auth";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Un code d'accès est le seul facteur de cette authentification : sans plafond,
// il se parcourt hors ligne. Deux limites, comme sur la connexion applicative.
const IP_MAX = 20;
const IP_WINDOW_MS = 60_000;
const ACCOUNT_MAX = 5;
const ACCOUNT_WINDOW_MS = 15 * 60_000;

/** Réponse unique quel que soit l'échec : ne pas révéler si l'email existe. */
function refuse() {
  return NextResponse.json({ error: "Email ou code d'accès invalide" }, { status: 401 });
}

// POST /api/portail/auth — Connexion portail externe par email + code d'accès
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const byIp = rateLimit("portal:ip", ip, IP_MAX, IP_WINDOW_MS);
  if (!byIp.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessayez dans ${byIp.retryAfter} secondes.` },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfter) } }
    );
  }

  const { email, accessCode, type } = await req.json().catch(() => ({}));
  if (!email || !accessCode || !type) {
    return NextResponse.json(
      { error: "email, accessCode et type (adherent|fournisseur) sont requis" },
      { status: 400 }
    );
  }
  if (type !== "adherent" && type !== "fournisseur") {
    return NextResponse.json({ error: "type invalide" }, { status: 400 });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const accountKey = `${type}:${normalizedEmail}`;

  const byAccount = rateLimit("portal:account", accountKey, ACCOUNT_MAX, ACCOUNT_WINDOW_MS);
  if (!byAccount.allowed) {
    return NextResponse.json(
      {
        error: `Accès temporairement verrouillé après plusieurs échecs. Réessayez dans ${Math.ceil(byAccount.retryAfter / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(byAccount.retryAfter) } }
    );
  }

  await connectDB();

  // Le code n'est plus dans le filtre : il est haché, donc on charge d'abord
  // l'enregistrement par email puis on compare l'empreinte.
  // `select: false` sur les deux schémas : il faut les redemander explicitement.
  const entity = type === "adherent"
    ? await MemberModel.findOne({ email: normalizedEmail, status: "active" })
        .select("+accessCodeHash +accessCode")
    : await SupplierModel.findOne({ email: normalizedEmail, isActive: true })
        .select("+accessCodeHash");

  if (!entity) return refuse();

  const submitted = String(accessCode).trim();
  const { valid, needsUpgrade } = await verifyAccessCode(
    submitted,
    entity.accessCodeHash,
    // Champ hérité, présent uniquement sur les enregistrements antérieurs.
    (entity as unknown as { accessCode?: string }).accessCode
  );
  if (!valid) return refuse();

  // Migration transparente : le premier usage réussi d'un code hérité le hache
  // et efface la valeur en clair.
  if (needsUpgrade) {
    entity.accessCodeHash = await hashAccessCode(submitted);
    entity.set("accessCode", undefined);
    await entity.save();
  }

  resetRateLimit("portal:account", accountKey);

  const token = signPortalToken({
    id: entity._id.toString(),
    tenantId: entity.tenantId.toString(),
    type,
    email: normalizedEmail,
  });

  // Le jeton n'est plus renvoyé dans le corps : il vit dans un cookie httpOnly,
  // hors de portée d'un script injecté dans la page du portail.
  const res = NextResponse.json({ success: true });
  setPortalCookie(res, token);
  return res;
}
