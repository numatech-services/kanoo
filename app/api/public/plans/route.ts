import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db"; // Vérifie que ton fichier s'appelle bien mongodb.ts
import { Plan } from "@/models/Plan";

export async function GET() {
  try {
    await connectDB(); // Utilisation du nom correct
    const plans = await Plan.find({}).sort({ priceMonthly: 1 });
    return NextResponse.json({ success: true, data: plans });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const body = await req.json();
    const plan = await Plan.create(body);
    return NextResponse.json({ success: true, data: plan });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const body = await req.json();
    const { _id, ...updateData } = body;
    const plan = await Plan.findByIdAndUpdate(_id, updateData, { new: true });
    return NextResponse.json({ success: true, data: plan });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
  }
}