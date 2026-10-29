import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Plan } from "@/models/Plan";
import { errorMessage } from "@/lib/errors";

export async function GET() {
  try {
    await connectDB();
    const plans = await Plan.find({}).sort({ priceMonthly: 1 });
    return NextResponse.json({ success: true, data: plans });
  } catch (e) {
    console.error("[public/plans]", errorMessage(e));
    return NextResponse.json({ success: false, error: "Offres momentanément indisponibles." }, { status: 500 });
  }
}

// Création et modification : /api/superadmin/plans (superadministrateur).
