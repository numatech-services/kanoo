import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { MemberModel } from "@/models/Member";
import { SupplierModel } from "@/models/Supplier";
import { sign } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "portail_secret_change_me";

// POST /api/portail/auth — Connexion portail externe par email + code d'accès
export async function POST(req: NextRequest) {
  await connectDB();
  const { email, accessCode, type } = await req.json().catch(() => ({}));
  if (!email || !accessCode || !type) {
    return NextResponse.json({ error: "email, accessCode et type (adherent|fournisseur) sont requis" }, { status: 400 });
  }

  let entity;
  if (type === "adherent") {
    entity = await MemberModel.findOne({ email: email.toLowerCase(), accessCode, status: "active" });
  } else if (type === "fournisseur") {
    entity = await SupplierModel.findOne({ email: email.toLowerCase(), accessCode, isActive: true });
  }

  if (!entity) return NextResponse.json({ error: "Email ou code d'accès invalide" }, { status: 401 });

  const token = sign({ id: entity._id, tenantId: entity.tenantId, type, email }, JWT_SECRET, { expiresIn: "7d" });

  const res = NextResponse.json({ success: true, token });
  res.cookies.set("portail_token", token, { httpOnly: true, maxAge: 7 * 86400, path: "/" });
  return res;
}
