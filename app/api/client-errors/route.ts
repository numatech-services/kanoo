import { NextRequest, NextResponse } from "next/server";
import { recordError } from "@/lib/error-log";
import { consumeRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY = 8_000;

/**
 * POST /api/client-errors — erreurs JavaScript et violations CSP remontées par
 * le navigateur (components/shared/ErrorReporter.tsx, via sendBeacon).
 *
 * Route publique (une erreur peut survenir sur la page de connexion) mais
 * bornée : même origine exigée, 30 rapports par minute et par adresse, corps
 * plafonné. Elle n'écrit que dans le journal des erreurs et ne renvoie rien.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const host = req.headers.get("host") || "";
  try {
    if (!host || new URL(origin).host !== host) return new NextResponse(null, { status: 403 });
  } catch {
    return new NextResponse(null, { status: 403 });
  }
  const limit = await consumeRateLimit("client-errors", clientIp(req), 30, 60_000);
  if (!limit.allowed) return new NextResponse(null, { status: 429 });

  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return new NextResponse(null, { status: 400 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }

  const source = body.kind === "csp" ? "csp" : "client";
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const message = str(body.message, 1000);
  if (!message) return new NextResponse(null, { status: 400 });

  await recordError({
    source, message,
    stack: str(body.stack, 4000),
    // Chemin seulement : jamais de paramètres de requête (jetons de portail…).
    url: str(body.url, 500)?.replace(/[?#].*$/, ""),
    ref: str(body.digest, 64),
    userAgent: req.headers.get("user-agent")?.slice(0, 300),
  });
  return new NextResponse(null, { status: 204 });
}
