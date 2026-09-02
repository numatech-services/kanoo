import { NextRequest, NextResponse } from "next/server";
import { generateCsrfToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const csrfToken = generateCsrfToken();
  const response = NextResponse.json({ csrfToken });
  response.cookies.set("csrf_token", csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
