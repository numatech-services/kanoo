import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_LOGO = 700_000; // ~500 Ko binaire en base64

/**
 * Identité de l'organisation (« Mon organisation »).
 *
 * Distincte de /api/company/branding, qui gère l'apparence des documents :
 * ici on édite les informations légales du tenant — nom, NIF, RCCM, adresse,
 * contacts — et le logo. L'écran correspondant était référencé dans les
 * réglages mais n'existait pas (lien mort vers /companies).
 */
const EDITABLE = ["name", "nif", "rccm", "address", "phone", "email"] as const;

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  // L'organisation est le document Tenant lui-même : son identifiant est _id
  // (filtrer sur un champ tenantId, qu'il n'a pas, ne trouvait jamais rien).
  const t = await TenantModel.findById(auth.tenantId)
    .select("name type nif rccm address phone email logo slug plan subscriptionStatus")
    .lean();
  if (!t) return notFound("Organisation introuvable");
  return ok(t);
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));

  const set: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (body[key] !== undefined) set[key] = String(body[key] ?? "").slice(0, 300);
  }
  if (typeof body.name === "string" && !body.name.trim()) {
    return badRequest("Le nom de l'organisation ne peut pas être vide.");
  }
  if (body.logo !== undefined) {
    const logo = String(body.logo || "");
    if (logo.length > MAX_LOGO) return badRequest("Logo trop lourd (500 Ko maximum). Réduisez l'image.");
    set.logo = logo || undefined;
  }

  const t = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: set }, { new: true, runValidators: true })
    .select("name type nif rccm address phone email logo").lean();
  if (!t) return notFound("Organisation introuvable");
  await logAudit(auth, "UPDATE", "companies", { metadata: { fields: Object.keys(set) } });
  return ok(t);
});
