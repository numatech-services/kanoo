import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { ingestEvents } from "@/lib/easypay-server";
import { MAX_BATCH } from "@/lib/easypay";
import { BusinessRuleError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/spot/events — ventes, annulations, recharges, mouvements de
 * stock et pré-commandes d'EasyPay. Scope spot:write. Corps : { events: [...] }
 * (100 au plus). Réponse 200 avec un résultat par événement : applied,
 * duplicate (déjà reçu : rien de plus n'est écrit), failed (refusé par une
 * règle de Kanoo, gardé et rejouable dans Kanoo : ne pas renvoyer) ou
 * rejected (illisible : à corriger à la source).
 */
export async function POST(req: NextRequest) {
  const a = await spotContext(req, "spot:write");
  if ("error" in a) return a.error;
  if (Number(req.headers.get("content-length") || 0) > 2_000_000) return NextResponse.json({ error: "Lot trop lourd (2 Mo au plus)." }, { status: 413 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.events)) return NextResponse.json({ error: "events : liste d'événements attendue." }, { status: 400 });
  if (body.events.length > MAX_BATCH) return NextResponse.json({ error: `${MAX_BATCH} événements au plus par lot.` }, { status: 400 });
  try {
    const results = await ingestEvents(a.ctx, body.events);
    return NextResponse.json({ success: true, data: { results }, api_version: "v1" });
  } catch (e) {
    // Clé dont l'auteur n'a plus accès : rien n'est écrit, à refaire avec une nouvelle clé.
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: "La personne qui a créé cette clé n'a plus accès à Kanoo : créez une nouvelle clé." }, { status: 403 });
    throw e;
  }
}
