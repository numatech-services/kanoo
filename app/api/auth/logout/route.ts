import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true, message: "Déconnexion réussie" });
  response.cookies.delete("auth_token");
  response.cookies.delete("csrf_token");
  return response;
}
