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
    return NextResponse.json({ success: false, error: errorMessage(e) }, { status: 500 });
  }
}

// Création et modification : /api/superadmin/plans (superadministrateur).
