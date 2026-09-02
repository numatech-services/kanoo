import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";

// --- Garde ton GET existant ---
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  await connectDB();
  const user = await UserModel.findById(auth.userId).select("-passwordHash").lean();
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  return NextResponse.json({ success: true, data: { user } });
}

// --- Ajoute le PATCH pour la modification ---
export async function PATCH(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

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

  } catch (error: any) {
    console.error("Erreur Update User: - route.ts:55", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise à jour du profil" }, 
      { status: 500 }
    );
  }
}