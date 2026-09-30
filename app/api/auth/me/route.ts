import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { verifyCsrf, CSRF_MESSAGES } from "@/lib/csrf";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { effectiveRoles, accessibleResourcesForRoles } from "@/lib/role-resources";
import { UserRole } from "@/types";
import { toLevels } from "@/lib/session";

// --- Garde ton GET existant ---
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  await connectDB();
  const user = await UserModel.findById(auth.userId).select("-passwordHash").lean();
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  // Marque de l'organisation, pour habiller l'interface (barre latérale, thème
  // d'espace, accent). Un superadmin n'est rattaché à aucune organisation.
  let tenant: { name?: string; logo?: string; type?: string; primaryColor?: string } | null = null;
  if (auth.tenantId) {
    const t = await TenantModel.findById(auth.tenantId)
      .select("name logo type branding.primaryColor")
      .lean<{ name?: string; logo?: string; type?: string; branding?: { primaryColor?: string } } | null>();
    if (t) tenant = { name: t.name, logo: t.logo, type: t.type, primaryColor: t.branding?.primaryColor };
  }

  // Ressources auxquelles l'utilisateur a droit (selon ses rôles + liste
  // individuelle). Le front s'en sert pour n'afficher que ce qui le concerne
  // (ex. masquer le volet financier ISIC à un opérateur d'impression).
  // Calculé depuis la BASE (rôles, niveaux, liste individuelle) : un changement
  // de rôle ou de niveau se reflète dans le menu sans attendre une reconnexion.
  const u = user as { role?: string; roles?: string[]; roleLevels?: Record<string, string>; allowedResources?: string[] };
  const roles = effectiveRoles((u.role ?? auth.role) as UserRole, (u.roles ?? auth.roles) as UserRole[] | undefined);
  const resources = accessibleResourcesForRoles(roles, u.allowedResources ?? auth.allowedResources, toLevels(u.roleLevels));

  return NextResponse.json({ success: true, data: { user, tenant, resources } });
}

// --- Ajoute le PATCH pour la modification ---
export async function PATCH(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    // CSRF : harmonisé avec le reste des mutations. Une requête par cookie doit
    // présenter le jeton double-submit ; une requête par Bearer en est exemptée
    // (verifyCsrf le gère), comme partout ailleurs.
    const verdict = verifyCsrf(req);
    if (verdict !== "ok") return NextResponse.json({ error: CSRF_MESSAGES[verdict] }, { status: 403 });

    const body = await req.json();
    
    // Sécurité : On ne permet de modifier que ces champs précis
    const { firstName, lastName, phone } = body;

    await connectDB();

    const updatedUser = await UserModel.findByIdAndUpdate(
      auth.userId,
      { 
        $set: { 
          firstName, 
          lastName, 
          phone 
        } 
      },
      { 
        new: true,           // Retourne le document modifié
        runValidators: true  // Vérifie les règles du Schema (required, trim, etc.)
      }
    ).select("-passwordHash");

    if (!updatedUser) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

  return NextResponse.json({ 
    success: true, 
    message: "Profil mis à jour", 
    data: { user: updatedUser } 
  });

  } catch (error) {
    console.error("Erreur Update User: - route.ts:55", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise à jour du profil" }, 
      { status: 500 }
    );
  }
}