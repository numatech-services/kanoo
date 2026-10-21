import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Schema, model, models } from "mongoose";
import { consumeRateLimit } from "@/lib/rate-limit";

const DemoRequestSchema = new Schema({
  name: String, email: String, type: String, subject: String, message: String,
  createdAt: { type: Date, default: Date.now },
});
const DemoRequestModel = models.DemoRequest || model("DemoRequest", DemoRequestSchema);

/**
 * POST /api/demo-requests — formulaire public de demande de démo / contact.
 *
 * Endpoint anonyme (le middleware doit l'autoriser). Trois protections, parce
 * qu'un endpoint public qui écrit en base est une cible :
 *  - limite de débit par IP (anti-spam) ;
 *  - liste blanche de champs (l'ancienne version passait `body` brut à create,
 *    ouvrant l'injection de champs arbitraires et de charges démesurées) ;
 *  - bornes de taille sur chaque champ.
 * La réponse reste toujours { success: true } : ne rien révéler à un robot.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = await consumeRateLimit("demo-request", ip, 5, 60 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de demandes. Réessayez plus tard." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

    const name = str(body.name, 120);
    const email = str(body.email, 190);
    const message = str(body.message, 4000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
      // Champs minimaux invalides : on répond OK sans écrire (pas de fuite,
      // pas de ligne vide en base).
      return NextResponse.json({ success: true });
    }

    await connectDB();
    // Liste blanche explicite : jamais `body` en entier.
    await DemoRequestModel.create({
      name, email, message,
      type: str(body.organizationType ?? body.type, 40),
      subject: str(body.subject, 200),
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // Silencieux : aucune info à un robot.
  }
}
