import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "./db";
import { getTokenFromRequest, verifyToken, TokenPayload } from "./auth";
import { canPerformAction } from "./role-resources";
import { UserRole } from "@/types";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}
export function noContent() {
  return new NextResponse(null, { status: 204 });
}
export function badRequest(message: string, errors?: Record<string, string>) {
  return NextResponse.json({ success: false, error: message, errors }, { status: 400 });
}
export function unauthorized(message = "Non authentifié") {
  return NextResponse.json({ success: false, error: message }, { status: 401 });
}
export function forbidden(message = "Accès interdit") {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}
export function notFound(message = "Ressource introuvable") {
  return NextResponse.json({ success: false, error: message }, { status: 404 });
}
export function conflict(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 409 });
}
export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erreur interne";
  console.error("[API Error]", error);
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

export interface PaginationParams { page: number; limit: number; skip: number; }

export function getPagination(req: NextRequest): PaginationParams {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginatedResponse<T>(data: T[], total: number, { page, limit }: PaginationParams) {
  return ok({ items: data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export function getAuthContext(req: NextRequest): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

export type RouteContext = { params: Promise<Record<string, string>> | Record<string, string> };

// Résout params (Next.js 15 les rend async, 14 synchrones)
export async function resolveParams(ctx: RouteContext): Promise<Record<string, string>> {
  if (!ctx?.params) return {};
  return ctx.params instanceof Promise ? await ctx.params : ctx.params;
}

/**
 * withAuth — wrapper universel pour toutes les routes API.
 * Authentification + RBAC + connexion DB + propagation params.
 */
export function withAuth(
  resource: string,
  action: "create" | "read" | "update" | "delete",
  handler: (req: NextRequest, auth: TokenPayload, params: Record<string, string>) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: RouteContext = { params: {} }): Promise<NextResponse> => {
    const auth = getAuthContext(req);
    if (!auth) return unauthorized();

    if (!canPerformAction(auth.role as UserRole, resource, action)) {
      return forbidden(`Action '${action}' sur '${resource}' non autorisée pour le rôle '${auth.role}'`);
    }

    try {
      await connectDB();
      const params = await resolveParams(ctx);
      return await handler(req, auth, params);
    } catch (err) {
      return serverError(err);
    }
  };
}

export function tenantFilter(auth: TokenPayload): { tenantId: string } {
  return { tenantId: auth.tenantId };
}

export function requireFields(body: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null || value === "") {
      return `Le champ '${field}' est obligatoire`;
    }
  }
  return null;
}
