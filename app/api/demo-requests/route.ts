import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Schema, model, models } from "mongoose";

const DemoRequestSchema = new Schema({ name: String, email: String, type: String, subject: String, message: String, createdAt: { type: Date, default: Date.now } });
const DemoRequestModel = models.DemoRequest || model("DemoRequest", DemoRequestSchema);

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    await DemoRequestModel.create(body);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // Silently OK (no info leakage)
  }
}
