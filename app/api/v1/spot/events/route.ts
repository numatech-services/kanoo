import { NextRequest, NextResponse } from "next/server";
import { spotContext } from "@/lib/api-v1-middleware";
import { ingestEvents, ingestV1 } from "@/lib/easypay-server";
import { MAX_BATCH } from "@/lib/easypay";
import { isV1Body, planV1 } from "@/lib/easypay-v1";
import { readRaw, v1Context, unknownSite, invalid } from "@/lib/easypay-v1-server";
import { BusinessRuleError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const KEY_OWNER_GONE = "La personne qui a créé cette clé n'a plus accès à Kanoo : créez une nouvelle clé.";

/**
 * POST /api/v1/spot/events — activité de la caisse EasyPay. Deux formes :
 *
 *  - contrat v1 (docs/EASYPAY-KANOO-CONTRAT-V1.md) : UN événement signé
 *    (`spec_version`, `event_id`, `sequence`…). Réponses du §8 : 200
 *    accepted / duplicate / ignored, 401 signature, 403 restaurant, 422 corps ;
 *  - ancien lot { events: [...] } (100 au plus), scope spot:write, un résultat
 *    par événement : applied, duplicate, failed (gardé, rejouable dans Kanoo)
 *    ou rejected (illisible).
 */
export async function POST(req: NextRequest) {
  const read = await readRaw(req);
  if ("error" in read) return read.error;
  const body = read.body as { events?: unknown } | null;

  if (isV1Body(body)) {
    const a = await v1Context(req, read.raw);
    if ("error" in a) return a.error;
    const plan = planV1(body);
    if (plan.kind !== "invalid" && plan.env.siteId !== a.siteId) return unknownSite();
    try {
      const r = await ingestV1(a.ctx, plan, body);
      return NextResponse.json(r.body, { status: r.status });
    } catch (e) {
      if (e instanceof BusinessRuleError) return NextResponse.json({ error: "key_owner_inactive", message: KEY_OWNER_GONE }, { status: 403 });
      throw e;
    }
  }

  const a = await spotContext(req, "spot:write");
  if ("error" in a) return a.error;
  if (!body || !Array.isArray(body.events)) return read.body === null ? invalid("JSON illisible.") : NextResponse.json({ error: "events : liste d'événements attendue." }, { status: 400 });
  if (body.events.length > MAX_BATCH) return NextResponse.json({ error: `${MAX_BATCH} événements au plus par lot.` }, { status: 400 });
  try {
    const results = await ingestEvents(a.ctx, body.events);
    return NextResponse.json({ success: true, data: { results }, api_version: "v1" });
  } catch (e) {
    // Clé dont l'auteur n'a plus accès : rien n'est écrit, à refaire avec une nouvelle clé.
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: KEY_OWNER_GONE }, { status: 403 });
    throw e;
  }
}
