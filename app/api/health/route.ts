import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — sonde de santé PUBLIQUE (pour outils de monitoring).
 * Ne renvoie aucune donnée métier : seulement l'état de l'app et de la base,
 * avec la latence d'un ping Mongo. 200 si tout va bien, 503 sinon.
 */
export async function GET() {
  const started = Date.now();
  try {
    await connectDB();
    // Ping léger : prouve que la base répond réellement, pas seulement que la
    // connexion est ouverte.
    await mongoose.connection.db?.admin().ping();
    return NextResponse.json({
      status: "ok",
      db: "up",
      dbLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "error", db: "down", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
